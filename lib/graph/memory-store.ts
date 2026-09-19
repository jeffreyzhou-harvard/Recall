import { byId, newestAskFirst, type GraphStore } from "./store";
import type { CurrentAskNode, GraphData, GraphEdge, GraphNode, NodeOf, NodeType } from "./types";

/** In-memory graph store. No I/O of any kind; safe in the browser and offline. */
export class MemoryGraphStore implements GraphStore {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();
  private readonly touching = new Map<string, Set<string>>();

  static from(data: GraphData): MemoryGraphStore {
    const store = new MemoryGraphStore();
    for (const n of data.nodes) store.insertNode(n);
    for (const e of data.edges) store.insertEdge(e);
    return store;
  }

  private insertNode(node: GraphNode): void {
    if (this.nodes.has(node.id)) throw new Error(`MemoryGraphStore: node "${node.id}" is already in the graph; nodes are never overwritten`);
    this.nodes.set(node.id, structuredClone(node));
  }

  private insertEdge(edge: GraphEdge): void {
    if (this.edges.has(edge.id)) throw new Error(`MemoryGraphStore: edge "${edge.id}" is already in the graph; edges are never overwritten`);
    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) {
      throw new Error(`MemoryGraphStore: edge "${edge.id}" references a node that is not in the graph`);
    }
    this.edges.set(edge.id, structuredClone(edge));
    for (const end of [edge.from, edge.to]) {
      let set = this.touching.get(end);
      if (!set) this.touching.set(end, (set = new Set()));
      set.add(edge.id);
    }
  }

  async getNode(id: string): Promise<GraphNode | null> {
    const node = this.nodes.get(id);
    return node ? structuredClone(node) : null;
  }

  async edgesOf(id: string): Promise<GraphEdge[]> {
    const ids = this.touching.get(id);
    if (!ids) return [];
    return [...ids].map((eid) => structuredClone(this.edges.get(eid)!)).sort(byId);
  }

  async findCurrentAsk(threadId: string): Promise<CurrentAskNode | null> {
    const asks = [...this.nodes.values()]
      .filter((n): n is CurrentAskNode => n.type === "CurrentAsk" && n.props.thread_id === threadId)
      .sort(newestAskFirst);
    return asks[0] ? structuredClone(asks[0]) : null;
  }

  async nodesOfType<T extends NodeType>(type: T): Promise<Array<NodeOf<T>>> {
    return [...this.nodes.values()]
      .filter((n): n is NodeOf<T> => n.type === type)
      .map((n) => structuredClone(n))
      .sort(byId);
  }

  async putNode(node: GraphNode): Promise<void> {
    this.insertNode(node);
  }

  async putEdge(edge: GraphEdge): Promise<void> {
    this.insertEdge(edge);
  }

  async snapshot(): Promise<GraphData> {
    return {
      nodes: [...this.nodes.values()].map((n) => structuredClone(n)).sort(byId),
      edges: [...this.edges.values()].map((e) => structuredClone(e)).sort(byId),
    };
  }
}
