/** Persistent graph for one household. Node's built-in SQLite; never imported by the offline demo. */
import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { assertErasable, byId, withConfirmation, type GraphStore } from "@/lib/graph/store";
import type { Confirmation, ErasableNodeType, GraphData, GraphEdge, GraphNode, NodeOf, NodeType, Provenance } from "@/lib/graph/types";

export class SqliteGraphStore implements GraphStore {
  private readonly db: DatabaseSync;
  private queue: Promise<unknown> = Promise.resolve();
  atomic<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      this.db.exec("BEGIN IMMEDIATE");
      try { const result = await work(); this.db.exec("COMMIT"); return result; }
      catch (error) { this.db.exec("ROLLBACK"); throw error; }
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
  constructor(path: string, private readonly household: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS graph_nodes (household TEXT NOT NULL, id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(household,id));
      CREATE TABLE IF NOT EXISTS graph_edges (household TEXT NOT NULL, id TEXT NOT NULL, src TEXT NOT NULL, dst TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(household,id));`);
  }
  private node(id: string): GraphNode | null {
    const row = this.db.prepare("SELECT data FROM graph_nodes WHERE household=? AND id=?").get(this.household, id);
    return row ? JSON.parse(String(row.data)) as GraphNode : null;
  }
  private edge(id: string): GraphEdge | null {
    const row = this.db.prepare("SELECT data FROM graph_edges WHERE household=? AND id=?").get(this.household, id);
    return row ? JSON.parse(String(row.data)) as GraphEdge : null;
  }
  async getNode(id: string) { return this.node(id); }
  async getEdge(id: string) { return this.edge(id); }
  async nodesOfType<T extends NodeType>(type: T): Promise<Array<NodeOf<T>>> {
    return this.db.prepare("SELECT data FROM graph_nodes WHERE household=? AND type=? ORDER BY id").all(this.household, type).map((r) => JSON.parse(String(r.data)) as NodeOf<T>);
  }
  async edgesOf(id: string): Promise<GraphEdge[]> {
    return this.db.prepare("SELECT data FROM graph_edges WHERE household=? AND (src=? OR dst=?) ORDER BY id").all(this.household, id, id).map((r) => JSON.parse(String(r.data)) as GraphEdge);
  }
  async putNode(node: GraphNode): Promise<void> {
    this.db.prepare("INSERT INTO graph_nodes VALUES (?,?,?,?)").run(this.household, node.id, node.type, JSON.stringify(node));
  }
  async putEdge(edge: GraphEdge): Promise<void> {
    if (!this.node(edge.from) || !this.node(edge.to)) throw new Error("The edge references a missing node");
    this.db.prepare("INSERT INTO graph_edges VALUES (?,?,?,?,?)").run(this.household, edge.id, edge.from, edge.to, JSON.stringify(edge));
  }
  async confirm(id: string, confirmation: Confirmation): Promise<Provenance> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const node = this.node(id);
      const target = node ?? this.edge(id);
      if (!target || !this.node(confirmation.source_id)) throw new Error("Confirmation requires a target and a source");
      target.prov = withConfirmation(target.prov, confirmation);
      this.db.prepare(`UPDATE ${node ? "graph_nodes" : "graph_edges"} SET data=? WHERE household=? AND id=?`).run(JSON.stringify(target), this.household, id);
      this.db.exec("COMMIT");
      return target.prov;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  async removeNodesOfType(type: ErasableNodeType): Promise<number> {
    assertErasable(type);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.db.prepare("SELECT id FROM graph_nodes WHERE household=? AND type=?").all(this.household, type);
      for (const row of rows) {
        this.db.prepare("DELETE FROM graph_edges WHERE household=? AND (src=? OR dst=?)").run(this.household, String(row.id), String(row.id));
        this.db.prepare("DELETE FROM graph_nodes WHERE household=? AND id=?").run(this.household, String(row.id));
      }
      this.db.exec("COMMIT");
      return rows.length;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  async snapshot(): Promise<GraphData> {
    return {
      nodes: this.db.prepare("SELECT data FROM graph_nodes WHERE household=?").all(this.household).map((r) => JSON.parse(String(r.data)) as GraphNode).sort(byId),
      edges: this.db.prepare("SELECT data FROM graph_edges WHERE household=?").all(this.household).map((r) => JSON.parse(String(r.data)) as GraphEdge).sort(byId),
    };
  }
  /** Seed identities once; add later approved people without overwriting existing evidence. */
  async seed(data: GraphData): Promise<void> {
    await this.atomic(async () => {
      for (const node of data.nodes) if (!this.node(node.id)) this.db.prepare("INSERT INTO graph_nodes VALUES (?,?,?,?)").run(this.household, node.id, node.type, JSON.stringify(node));
      for (const edge of data.edges) if (!this.edge(edge.id)) this.db.prepare("INSERT INTO graph_edges VALUES (?,?,?,?,?)").run(this.household, edge.id, edge.from, edge.to, JSON.stringify(edge));
    });
  }
  /** Private media uses this connection so audio receipts and graph claims commit together. */
  mediaDatabase(): DatabaseSync { return this.db; }
  close(): void { this.db.close(); }
}
