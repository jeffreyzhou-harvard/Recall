/** Persistent graph for one household. Node's built-in SQLite; never imported by the offline demo. */
import { DatabaseSync } from "node:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { LadybugGraphStore } from "@/lib/graph/ladybug-store";
import { loadInto } from "@/lib/graph/store";
import { assertErasable, byId, withConfirmation, type GraphStore } from "@/lib/graph/store";
import type { Confirmation, ErasableNodeType, GraphData, GraphEdge, GraphNode, NodeOf, NodeType, Provenance } from "@/lib/graph/types";

export class SqliteGraphStore implements GraphStore {
  private index: LadybugGraphStore | null = null;
  private indexHash = "";
  private indexQueue: Promise<unknown> = Promise.resolve();
  /** SQLite commits evidence and audio together; Ladybug executes graph reads over that committed snapshot.
   * The index is disposable and never a second authority for consent or confirmations. */
  withReadSnapshot<T>(read: (snapshot: GraphStore) => Promise<T>): Promise<T> {
    if (!this.nativeReads) return read(this);
    const next = this.indexQueue.then(async () => {
      const data = await this.atomic(() => this.snapshot());
      const hash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
      if (hash !== this.indexHash) {
        const replacement = await LadybugGraphStore.open();
        try { await loadInto(replacement, data); }
        catch (error) { await replacement.close(); throw error; }
        const previous = this.index;
        this.index = replacement; this.indexHash = hash;
        await previous?.close();
      }
      return read(this.index!);
    });
    this.indexQueue = next.catch(() => undefined);
    return next;
  }
  private readonly db: DatabaseSync;
  private queue: Promise<unknown> = Promise.resolve();
  private transaction = new AsyncLocalStorage<{ active: boolean }>();
  private enqueue<T>(work: () => T | Promise<T>): Promise<T> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => undefined);
    return next;
  }
  /** Only the transaction's own async chain may use its connection before commit. */
  private access<T>(work: () => T): Promise<T> {
    return this.transaction.getStore()?.active ? Promise.resolve().then(work) : this.enqueue(work);
  }
  atomic<T>(work: () => Promise<T>): Promise<T> {
    if (this.transaction.getStore()?.active) return work();
    return this.enqueue(async () => {
      this.db.exec("BEGIN IMMEDIATE");
      const owner = { active: true };
      try {
        const result = await this.transaction.run(owner, work);
        this.db.exec("COMMIT"); return result;
      } catch (error) { this.db.exec("ROLLBACK"); throw error; }
      finally { owner.active = false; }
    });
  }
  constructor(path: string, private readonly household: string, private readonly nativeReads = false) {
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
  async getNode(id: string) { return this.access(() => this.node(id)); }
  async getEdge(id: string) { return this.access(() => this.edge(id)); }
  async nodesOfType<T extends NodeType>(type: T): Promise<Array<NodeOf<T>>> {
    return this.access(() => this.db.prepare("SELECT data FROM graph_nodes WHERE household=? AND type=? ORDER BY id").all(this.household, type).map((r) => JSON.parse(String(r.data)) as NodeOf<T>));
  }
  async edgesOf(id: string): Promise<GraphEdge[]> {
    return this.access(() => this.db.prepare("SELECT data FROM graph_edges WHERE household=? AND (src=? OR dst=?) ORDER BY id").all(this.household, id, id).map((r) => JSON.parse(String(r.data)) as GraphEdge));
  }
  async putNode(node: GraphNode): Promise<void> {
    await this.access(() => { this.db.prepare("INSERT INTO graph_nodes VALUES (?,?,?,?)").run(this.household, node.id, node.type, JSON.stringify(node)); });
  }
  async putEdge(edge: GraphEdge): Promise<void> {
    await this.access(() => {
      if (!this.node(edge.from) || !this.node(edge.to)) throw new Error("The edge references a missing node");
      this.db.prepare("INSERT INTO graph_edges VALUES (?,?,?,?,?)").run(this.household, edge.id, edge.from, edge.to, JSON.stringify(edge));
    });
  }
  async confirm(id: string, confirmation: Confirmation): Promise<Provenance> {
    return this.atomic(async () => {
      const node = this.node(id);
      const target = node ?? this.edge(id);
      if (!target || !this.node(confirmation.source_id)) throw new Error("Confirmation requires a target and a source");
      target.prov = withConfirmation(target.prov, confirmation);
      this.db.prepare(`UPDATE ${node ? "graph_nodes" : "graph_edges"} SET data=? WHERE household=? AND id=?`).run(JSON.stringify(target), this.household, id);
      return target.prov;
    });
  }
  async removeNodesOfType(type: ErasableNodeType): Promise<number> {
    assertErasable(type);
    return this.atomic(async () => {
      const rows = this.db.prepare("SELECT id FROM graph_nodes WHERE household=? AND type=?").all(this.household, type);
      for (const row of rows) {
        this.db.prepare("DELETE FROM graph_edges WHERE household=? AND (src=? OR dst=?)").run(this.household, String(row.id), String(row.id));
        this.db.prepare("DELETE FROM graph_nodes WHERE household=? AND id=?").run(this.household, String(row.id));
      }
      return rows.length;
    });
  }
  async snapshot(): Promise<GraphData> {
    return this.access(() => ({
      nodes: this.db.prepare("SELECT data FROM graph_nodes WHERE household=?").all(this.household).map((r) => JSON.parse(String(r.data)) as GraphNode).sort(byId),
      edges: this.db.prepare("SELECT data FROM graph_edges WHERE household=?").all(this.household).map((r) => JSON.parse(String(r.data)) as GraphEdge).sort(byId),
    }));
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
  async closeIndex(): Promise<void> { await this.indexQueue; await this.index?.close(); this.index = null; this.indexHash = ""; }
  close(): void { this.db.close(); void this.closeIndex(); }
}
