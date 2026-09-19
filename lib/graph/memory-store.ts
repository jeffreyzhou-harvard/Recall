import { assertErasable, assertSourced, byId, withConfirmation, type GraphStore } from "./store";
import type { Confirmation, ErasableNodeType, GraphData, GraphEdge, GraphNode, NodeOf, NodeType, Provenance } from "./types";

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

  async getEdge(id: string): Promise<GraphEdge | null> {
    const edge = this.edges.get(id);
    return edge ? structuredClone(edge) : null;
  }

  async edgesOf(id: string): Promise<GraphEdge[]> {
    const ids = this.touching.get(id);
    if (!ids) return [];
    return [...ids].map((eid) => structuredClone(this.edges.get(eid)!)).sort(byId);
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

  async confirm(targetId: string, confirmation: Confirmation): Promise<Provenance> {
    assertSourced(confirmation);
    const target = this.nodes.get(targetId) ?? this.edges.get(targetId);
    if (!target) throw new Error(`MemoryGraphStore: nothing with id "${targetId}" to confirm`);
    if (!this.nodes.has(confirmation.source_id)) throw new Error(`MemoryGraphStore: confirmation source "${confirmation.source_id}" is not in the graph`);
    target.prov = withConfirmation(target.prov, confirmation);
    return structuredClone(target.prov);
  }

  async removeNodesOfType(type: ErasableNodeType): Promise<number> {
    assertErasable(type);
    const gone = [...this.nodes.values()].filter((n) => n.type === type).map((n) => n.id);
    for (const id of gone) {
      for (const edgeId of this.touching.get(id) ?? []) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;
        this.edges.delete(edgeId);
        this.touching.get(edge.from === id ? edge.to : edge.from)?.delete(edgeId);
      }
      this.touching.delete(id);
      this.nodes.delete(id);
    }
    return gone.length;
  }

  async snapshot(): Promise<GraphData> {
    return {
      nodes: [...this.nodes.values()].map((n) => structuredClone(n)).sort(byId),
      edges: [...this.edges.values()].map((e) => structuredClone(e)).sort(byId),
    };
  }
}
