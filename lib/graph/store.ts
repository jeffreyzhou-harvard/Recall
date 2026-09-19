/**
 * The graph store boundary.
 *
 * Two implementations sit behind this interface:
 *   - MemoryGraphStore: browser-safe, zero I/O. The judged path uses this, so
 *     the 90-second demo never touches a database, disk, or network.
 *   - LadybugGraphStore: embedded LadybugDB (Cypher) persistence for scripts, tests,
 *     and the optional live side demo. Node only.
 *
 * Stores expose primitives only. Retrieval semantics (hops, policy filtering,
 * ranking) live once in ./retrieval.ts and run identically over either store;
 * a parity test holds the two to the same answers.
 */
import { statusAfter, type Confirmation, type CurrentAskNode, type GraphData, type GraphEdge, type GraphNode, type NodeOf, type NodeType, type Provenance } from "./types";

export function assertSourced(c: Confirmation): void {
  if (!c.source_id) throw new Error("a confirmation needs a source: the artifact holding the person's own words");
}

/** Shared by both stores so they cannot drift: validate, append, recompute. */
export function withConfirmation(prov: Provenance, c: Confirmation): Provenance {
  assertSourced(c);
  return { ...prov, status: statusAfter(prov.status, c), confirmations: [...prov.confirmations, c] };
}

/** Newest forward first; id breaks a tie so the choice is deterministic. */
export const newestAskFirst = (a: CurrentAskNode, b: CurrentAskNode): number =>
  a.props.received_at === b.props.received_at ? (a.id < b.id ? -1 : 1) : a.props.received_at > b.props.received_at ? -1 : 1;

export interface GraphStore {
  getNode(id: string): Promise<GraphNode | null>;
  getEdge(id: string): Promise<GraphEdge | null>;
  /** Every edge touching `id`, in either direction, ordered by edge id. */
  edgesOf(id: string): Promise<GraphEdge[]>;
  /** The most recently forwarded ask for a thread. A new forward replaces the one before it as "current". */
  findCurrentAsk(threadId: string): Promise<CurrentAskNode | null>;
  /** Every node of one type, ordered by id. Intake uses this to match an ask against known topics and events. */
  nodesOfType<T extends NodeType>(type: T): Promise<Array<NodeOf<T>>>;
  putNode(node: GraphNode): Promise<void>;
  putEdge(edge: GraphEdge): Promise<void>;
  /**
   * The one thing that may change after a node or edge is written: a person confirming or disputing
   * it. The confirmation is appended with its source and the status follows from it (`statusAfter`).
   * Nothing else about the fact can be edited, and nothing can remove a confirmation.
   */
  confirm(targetId: string, confirmation: Confirmation): Promise<Provenance>;
  /** Whole graph, ordered by id. For the judge view and for parity tests. */
  snapshot(): Promise<GraphData>;
}

export async function loadInto(store: GraphStore, data: GraphData): Promise<void> {
  for (const node of data.nodes) await store.putNode(node);
  for (const edge of data.edges) await store.putEdge(edge);
}

export const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
