/**
 * LadybugDB-backed graph store (embedded property graph, Cypher, MIT).
 *
 * Node only - this file imports a native addon. Never import it from a client
 * component or from anything on the judged path; use MemoryGraphStore there.
 *
 * Every node table shares one column layout. Type-specific fields and the full
 * provenance record travel as JSON strings so a node round-trips exactly; the
 * columns policy queries filter on (source_class, expires_at, layer) are real
 * columns so Cypher can use them.
 */
import { createRequire } from "node:module";
import { byId, newestAskFirst, type GraphStore } from "./store";
import {
  EDGE_SIGNATURES,
  EDGE_TYPES,
  NODE_LAYER,
  NODE_TYPES,
  type CurrentAskNode,
  type EdgeType,
  type GraphData,
  type GraphEdge,
  type GraphNode,
  type NodeOf,
  type NodeType,
  type SourceClass,
} from "./types";

type Row = Record<string, unknown>;
interface LbugResult {
  getAll(): Promise<Row[]>;
}
interface LbugConnection {
  query(q: string): Promise<LbugResult>;
  prepare(q: string): Promise<unknown>;
  execute(ps: unknown, params: Record<string, unknown>): Promise<LbugResult>;
  close?(): Promise<void> | void;
}
interface LbugModule {
  Database: new (path: string) => { close?(): Promise<void> | void };
  Connection: new (db: unknown) => LbugConnection;
  VERSION: string;
}

const NODE_COLUMNS =
  "id STRING, label STRING, layer INT64, props STRING, prov STRING, source_class STRING, expires_at STRING, thread_id STRING, PRIMARY KEY(id)";

/** DDL derived from the same tables the seed validator uses, so the schemas cannot drift apart. */
export function schemaDdl(): string[] {
  const nodes = NODE_TYPES.map((t) => `CREATE NODE TABLE ${t}(${NODE_COLUMNS})`);
  const rels = EDGE_TYPES.map((t) => {
    const pairs = EDGE_SIGNATURES[t].map(([from, to]) => `FROM ${from} TO ${to}`).join(", ");
    return `CREATE REL TABLE ${t}(${pairs}, id STRING, props STRING, prov STRING, source_class STRING)`;
  });
  return [...nodes, ...rels];
}

export class LadybugGraphStore implements GraphStore {
  private constructor(
    private readonly db: { close?(): Promise<void> | void },
    private readonly conn: LbugConnection,
    readonly engineVersion: string,
  ) {}

  /** `path` is a database directory, or ":memory:" for a throwaway in-process graph. */
  static async open(path = ":memory:"): Promise<LadybugGraphStore> {
    const lbug = createRequire(import.meta.url)("@ladybugdb/core") as LbugModule;
    const db = new lbug.Database(path);
    const store = new LadybugGraphStore(db, new lbug.Connection(db), lbug.VERSION);
    for (const ddl of schemaDdl()) await store.conn.query(ddl);
    return store;
  }

  private async run(query: string, params: Record<string, unknown>): Promise<Row[]> {
    const prepared = await this.conn.prepare(query);
    return (await this.conn.execute(prepared, params)).getAll();
  }

  private async nodeTypeOf(id: string): Promise<NodeType | null> {
    const rows = await this.run("MATCH (n) WHERE n.id = $id RETURN label(n) AS type", { id });
    return (rows[0]?.type as NodeType | undefined) ?? null;
  }

  private static toNode(row: Row): GraphNode {
    return {
      id: row.id,
      type: row.type,
      label: row.label,
      props: JSON.parse(row.props as string),
      prov: JSON.parse(row.prov as string),
    } as GraphNode;
  }

  async getNode(id: string): Promise<GraphNode | null> {
    const rows = await this.run(
      "MATCH (n) WHERE n.id = $id RETURN n.id AS id, label(n) AS type, n.label AS label, n.props AS props, n.prov AS prov",
      { id },
    );
    return rows[0] ? LadybugGraphStore.toNode(rows[0]) : null;
  }

  async edgesOf(id: string): Promise<GraphEdge[]> {
    const rows = await this.run(
      "MATCH (a)-[r]->(b) WHERE a.id = $id OR b.id = $id " +
        "RETURN r.id AS id, label(r) AS type, a.id AS src, b.id AS dst, r.props AS props, r.prov AS prov",
      { id },
    );
    return rows
      .map((r) => ({
        id: r.id as string,
        type: r.type as EdgeType,
        from: r.src as string,
        to: r.dst as string,
        props: JSON.parse(r.props as string),
        prov: JSON.parse(r.prov as string),
      }))
      .sort(byId);
  }

  async findCurrentAsk(threadId: string): Promise<CurrentAskNode | null> {
    const rows = await this.run(
      "MATCH (n:CurrentAsk) WHERE n.thread_id = $thread " +
        "RETURN n.id AS id, label(n) AS type, n.label AS label, n.props AS props, n.prov AS prov ORDER BY n.id",
      { thread: threadId },
    );
    const asks = rows.map((r) => LadybugGraphStore.toNode(r) as CurrentAskNode).sort(newestAskFirst);
    return asks[0] ?? null;
  }

  async nodesOfType<T extends NodeType>(type: T): Promise<Array<NodeOf<T>>> {
    // `type` is one of the twelve table names, never user input.
    const rows = await this.run(
      `MATCH (n:${type}) RETURN n.id AS id, label(n) AS type, n.label AS label, n.props AS props, n.prov AS prov`,
      {},
    );
    return rows.map((r) => LadybugGraphStore.toNode(r) as NodeOf<T>).sort(byId);
  }

  async putNode(node: GraphNode): Promise<void> {
    await this.run(
      `CREATE (:${node.type} {id:$id, label:$label, layer:$layer, props:$props, prov:$prov, source_class:$source_class, expires_at:$expires_at, thread_id:$thread_id})`,
      {
        id: node.id,
        label: node.label,
        layer: NODE_LAYER[node.type],
        props: JSON.stringify(node.props),
        prov: JSON.stringify(node.prov),
        source_class: node.prov.source_class,
        expires_at: node.prov.expires_at ?? "",
        thread_id: node.type === "CurrentAsk" ? node.props.thread_id : "",
      },
    );
  }

  async putEdge(edge: GraphEdge): Promise<void> {
    const [fromType, toType] = await Promise.all([this.nodeTypeOf(edge.from), this.nodeTypeOf(edge.to)]);
    if (!fromType || !toType) {
      throw new Error(`LadybugGraphStore: edge "${edge.id}" references a node that is not in the graph`);
    }
    await this.run(
      `MATCH (a:${fromType} {id:$from}), (b:${toType} {id:$to}) ` +
        `CREATE (a)-[:${edge.type} {id:$id, props:$props, prov:$prov, source_class:$source_class}]->(b)`,
      {
        from: edge.from,
        to: edge.to,
        id: edge.id,
        props: JSON.stringify(edge.props),
        prov: JSON.stringify(edge.prov),
        source_class: edge.prov.source_class,
      },
    );
  }

  async snapshot(): Promise<GraphData> {
    const nodeRows = await this.run(
      "MATCH (n) RETURN n.id AS id, label(n) AS type, n.label AS label, n.props AS props, n.prov AS prov",
      {},
    );
    const edgeRows = await this.run(
      "MATCH (a)-[r]->(b) RETURN r.id AS id, label(r) AS type, a.id AS src, b.id AS dst, r.props AS props, r.prov AS prov",
      {},
    );
    return {
      nodes: nodeRows.map(LadybugGraphStore.toNode).sort(byId),
      edges: edgeRows
        .map((r) => ({
          id: r.id as string,
          type: r.type as EdgeType,
          from: r.src as string,
          to: r.dst as string,
          props: JSON.parse(r.props as string),
          prov: JSON.parse(r.prov as string),
        }))
        .sort(byId),
    };
  }

  /**
   * Native Cypher form of the core citation query: prior claims within two
   * topical hops of an ask, restricted to allowed source classes and unexpired
   * evidence. The parity test holds this to the same answer as retrieval.ts.
   */
  async claimIdsForAsk(askId: string, allowed: readonly SourceClass[], nowIso: string): Promise<string[]> {
    const rows = await this.run(
      "MATCH (a:CurrentAsk {id:$ask})-[:ABOUT]->(t:Topic)<-[:ABOUT]-(c:EpisodicClaim) " +
        "WHERE c.source_class IN $allowed AND (c.expires_at = '' OR c.expires_at > $now) " +
        "RETURN DISTINCT c.id AS id ORDER BY id",
      { ask: askId, allowed: [...allowed], now: nowIso },
    );
    return rows.map((r) => r.id as string);
  }

  async close(): Promise<void> {
    await this.conn.close?.();
    await this.db.close?.();
  }
}
