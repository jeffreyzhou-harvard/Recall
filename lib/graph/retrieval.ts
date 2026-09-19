/**
 * Citation retrieval: the one place that decides what context a call may draw
 * on. Runs identically over any GraphStore.
 *
 * It returns ranked candidate subgraphs with citations - never prose - and an
 * explicit list of what it excluded and why, so the judge console can show
 * the policy filter doing real work.
 */
import type { GraphStore } from "./store";
import { SPEAKABLE_AS_FACT, type EdgeType, type GraphEdge, type GraphNode, type MediaSpan, type NodeType, type SourceClass } from "./types";

/**
 * Only topical edges are walked. Walking SPOKEN_BY or ADDRESSED_TO would put
 * everything Mom ever said two hops from every ask, which is a memory archive
 * - exactly what Relay is not (AGENTS.md section 14).
 */
const TRAVERSABLE: ReadonlySet<EdgeType> = new Set(["ABOUT", "DEPICTS", "EVIDENCE_FOR", "RELATED_TO"]);

/** Node types that can be offered as context. Topics and events are connective tissue, not evidence. */
const CANDIDATE_TYPES: ReadonlySet<NodeType> = new Set(["Artifact", "EpisodicClaim", "PreferenceExpertise"]);

const CLASS_RANK: Record<SourceClass, number> = {
  current_ask: 0,
  ask_artifact: 1,
  prior_claim_with_source: 2,
  discovery_answer: 3,
  joint_setup: 4,
  public_reference: 5,
  photo_library: 6,
  session_audit: 7,
};

export interface Citation {
  node_id: string;
  source_id: string;
  source_class: SourceClass;
  asset_id: string | null;
  media_hash: string | null;
  span: MediaSpan | null;
  author: string;
  observed_at: string;
}

export interface CandidateSubgraph {
  root_id: string;
  root_type: NodeType;
  label: string;
  hops: number;
  /** Shortest path from the ask to the root, as node and edge ids. */
  path_node_ids: string[];
  path_edge_ids: string[];
  citations: Citation[];
  rank: number;
}

export type ExclusionReason =
  | "not_confirmed"
  | "source_class_not_allowed"
  | "expired"
  | "audience_out_of_scope"
  | "artifact_not_permitted_by_policy"
  | "superseded";

export interface Exclusion {
  node_id: string;
  reason: ExclusionReason;
}

export interface RetrievalParams {
  ask_id: string;
  policy_id: string;
  audience: string;
  allowed_sources: readonly SourceClass[];
  max_hops: number;
  now_iso: string;
}

export interface RetrievalResult {
  candidates: CandidateSubgraph[];
  excluded: Exclusion[];
}

export function citationOf(node: GraphNode): Citation {
  const p = node.prov;
  return {
    node_id: node.id,
    source_id: p.source_id,
    source_class: p.source_class,
    asset_id: p.asset_id,
    media_hash: p.media_hash,
    span: p.span,
    author: p.author,
    observed_at: p.observed_at,
  };
}

interface Reached {
  node: GraphNode;
  hops: number;
  pathNodes: string[];
  pathEdges: string[];
}

async function walk(store: GraphStore, startId: string, maxHops: number): Promise<Reached[]> {
  const start = await store.getNode(startId);
  if (!start) throw new Error(`retrieval: ask "${startId}" is not in the graph`);
  const seen = new Map<string, Reached>([[startId, { node: start, hops: 0, pathNodes: [startId], pathEdges: [] }]]);
  let frontier: Reached[] = [seen.get(startId)!];
  for (let hop = 1; hop <= maxHops; hop++) {
    const next: Reached[] = [];
    for (const at of frontier) {
      // An unconfirmed edge is not a path: a guess that two things are related must not make one reachable from the other.
      const edges: GraphEdge[] = (await store.edgesOf(at.node.id)).filter((e) => TRAVERSABLE.has(e.type) && SPEAKABLE_AS_FACT.has(e.prov.status));
      for (const edge of edges) {
        const otherId = edge.from === at.node.id ? edge.to : edge.from;
        if (seen.has(otherId)) continue;
        const other = await store.getNode(otherId);
        if (!other) continue;
        const reached: Reached = {
          node: other,
          hops: hop,
          pathNodes: [...at.pathNodes, otherId],
          pathEdges: [...at.pathEdges, edge.id],
        };
        seen.set(otherId, reached);
        next.push(reached);
      }
    }
    frontier = next;
  }
  seen.delete(startId);
  return [...seen.values()];
}

/** The artifact a candidate ultimately rests on: itself if it is one, else its source. */
function backingArtifactId(node: GraphNode): string {
  return node.type === "Artifact" ? node.id : node.prov.source_id;
}

export async function retrieveCandidates(store: GraphStore, params: RetrievalParams): Promise<RetrievalResult> {
  // The ask's own message is the question, not context for it; `inspect_request` already returns it.
  const reached = (await walk(store, params.ask_id, params.max_hops)).filter(
    (r) => CANDIDATE_TYPES.has(r.node.type) && r.node.prov.source_class !== "current_ask",
  );
  const allowed = new Set(params.allowed_sources);
  const excluded: Exclusion[] = [];
  const kept: Reached[] = [];

  for (const r of reached) {
    const p = r.node.prov;
    let reason: ExclusionReason | null = null;
    // First, always: an observation or an inference is not context, whatever the policy allows.
    if (!SPEAKABLE_AS_FACT.has(p.status)) reason = "not_confirmed";
    else if (!allowed.has(p.source_class)) reason = "source_class_not_allowed";
    else if (p.expires_at !== null && p.expires_at <= params.now_iso) reason = "expired";
    else if (!p.audience_scope.includes(params.audience)) reason = "audience_out_of_scope";
    else {
      const artifactEdges = await store.edgesOf(backingArtifactId(r.node));
      const permitted = artifactEdges.some((e) => e.type === "PERMITTED_IN" && e.to === params.policy_id);
      if (!permitted) reason = "artifact_not_permitted_by_policy";
    }
    if (reason) excluded.push({ node_id: r.node.id, reason });
    else kept.push(r);
  }

  const supersededIds = new Set(kept.flatMap((r) => r.node.prov.supersedes));
  const live = kept.filter((r) => {
    if (!supersededIds.has(r.node.id)) return true;
    excluded.push({ node_id: r.node.id, reason: "superseded" });
    return false;
  });

  live.sort(
    (a, b) =>
      a.hops - b.hops ||
      CLASS_RANK[a.node.prov.source_class] - CLASS_RANK[b.node.prov.source_class] ||
      (a.node.id < b.node.id ? -1 : 1),
  );

  const candidates: CandidateSubgraph[] = [];
  for (const [i, r] of live.entries()) {
    const citations = [citationOf(r.node)];
    const artifactId = backingArtifactId(r.node);
    if (artifactId !== r.node.id) {
      const artifact = await store.getNode(artifactId);
      if (artifact) citations.push(citationOf(artifact));
    }
    candidates.push({
      root_id: r.node.id,
      root_type: r.node.type,
      label: r.node.label,
      hops: r.hops,
      path_node_ids: r.pathNodes,
      path_edge_ids: r.pathEdges,
      citations,
      rank: i + 1,
    });
  }

  excluded.sort((a, b) => (a.node_id < b.node_id ? -1 : 1));
  return { candidates, excluded };
}
