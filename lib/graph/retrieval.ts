/**
 * Citation retrieval: the one place that decides what context a call may draw
 * on. Runs identically over any GraphStore.
 *
 * It returns ranked candidate subgraphs with citations - never prose - and an
 * explicit list of what it excluded and why, so the judge console can show
 * the policy filter doing real work.
 */
import type { GraphStore } from "./store";
import { SPEAKABLE_AS_FACT, type EdgeType, type GraphEdge, type GraphNode, type MediaSpan, type NodeType, type Provenance, type SourceClass } from "./types";

/**
 * Only topical edges are walked. Walking SPOKEN_BY or CONTRIBUTED_BY would put everything she or her
 * family ever said two hops from every topic: a memory archive to browse, which is exactly what Recall
 * is not (AGENTS.md section 14).
 */
const TRAVERSABLE: ReadonlySet<EdgeType> = new Set(["ABOUT", "DEPICTS", "EVIDENCE_FOR", "RELATED_TO"]);

/** Node types that can be offered as context for a topic: what was said about it, who and where it involves, and photos of it. */
const CANDIDATE_TYPES: ReadonlySet<NodeType> = new Set(["Artifact", "EpisodicClaim", "PreferenceExpertise", "Person", "Place", "Event"]);

const CLASS_RANK: Record<SourceClass, number> = {
  prior_claim_with_source: 0,
  recall_call: 1,
  discovery_answer: 2,
  family_contribution: 3,
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
  /** Rule 13 travels with the citation: whoever speaks from it can see whether these are her words. */
  patient_confirmed: boolean;
}

export interface CandidateSubgraph {
  root_id: string;
  root_type: NodeType;
  label: string;
  hops: number;
  /** Shortest path from the topic to the root, as node and edge ids. */
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
  topic_id: string;
  policy_id: string;
  audience: string;
  allowed_sources: readonly SourceClass[];
  approved_authors?: readonly string[];
  max_hops: number;
  now_iso: string;
}

/** A stated tie between two people in reach of the topic, with the word that was actually used for it ("daughter"). */
export interface RelationFact {
  edge_id: string;
  from: string;
  to: string;
  relation: string;
  said_as: string | null;
}

export interface RetrievalResult {
  candidates: CandidateSubgraph[];
  relations: RelationFact[];
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
    patient_confirmed: p.patient_confirmed,
  };
}

interface Reached {
  node: GraphNode;
  hops: number;
  pathNodes: string[];
  pathEdges: string[];
}

async function walk(store: GraphStore, startId: string, maxHops: number, mayFollow: (edge: GraphEdge) => Promise<boolean>): Promise<Reached[]> {
  const start = await store.getNode(startId);
  if (!start) throw new Error(`retrieval: topic "${startId}" is not in the graph`);
  const seen = new Map<string, Reached>([[startId, { node: start, hops: 0, pathNodes: [startId], pathEdges: [] }]]);
  let frontier: Reached[] = [seen.get(startId)!];
  for (let hop = 1; hop <= maxHops; hop++) {
    const next: Reached[] = [];
    for (const at of frontier) {
      // An unconfirmed edge is not a path: a guess that two things are related must not make one reachable from the other.
      const edges: GraphEdge[] = (await store.edgesOf(at.node.id)).filter((e) => TRAVERSABLE.has(e.type) && SPEAKABLE_AS_FACT.has(e.prov.status));
      for (const edge of edges) {
        // Nor is an edge from a source this call may not use: what cannot be said cannot be the way to something else either.
        if (!(await mayFollow(edge))) continue;
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

/** Shared eligibility check: scaffold material must obey the same edge policy as traversal. */
export async function contextExclusion(store: GraphStore, params: Pick<RetrievalParams, "allowed_sources" | "approved_authors" | "now_iso" | "audience" | "policy_id">, p: Provenance, artifactId = p.source_id): Promise<ExclusionReason | null> {
  if (!SPEAKABLE_AS_FACT.has(p.status)) return "not_confirmed";
  if (!params.allowed_sources.includes(p.source_class)) return "source_class_not_allowed";
  if (params.approved_authors && ["family_contribution", "discovery_answer", "joint_setup"].includes(p.source_class) && !params.approved_authors.includes(p.author)) return "source_class_not_allowed";
  if (p.expires_at !== null && p.expires_at <= params.now_iso) return "expired";
  if (!p.audience_scope.includes(params.audience)) return "audience_out_of_scope";
  const permitted = (await store.edgesOf(artifactId)).some((e) => e.type === "PERMITTED_IN" && e.to === params.policy_id);
  return permitted ? null : "artifact_not_permitted_by_policy";
}

export async function retrieveCandidates(store: GraphStore, params: RetrievalParams): Promise<RetrievalResult> {
  const whyNot = (p: Provenance, artifactId: string) => contextExclusion(store, params, p, artifactId);

  const reached = (await walk(store, params.topic_id, params.max_hops, async (e) => (await whyNot(e.prov, e.prov.source_id)) === null)).filter((r) => CANDIDATE_TYPES.has(r.node.type));
  const excluded: Exclusion[] = [];
  const kept: Reached[] = [];

  for (const r of reached) {
    const reason = await whyNot(r.node.prov, backingArtifactId(r.node));
    if (reason) excluded.push({ node_id: r.node.id, reason });
    else kept.push(r);
  }

  // A claim that has been replaced stays replaced, even if what replaced it cannot itself be used on this call
  // (expired, or for another audience): setting the newer account aside must not bring the older one back.
  const supersededIds = new Set(reached.filter((r) => SPEAKABLE_AS_FACT.has(r.node.prov.status)).flatMap((r) => r.node.prov.supersedes));
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

  // Ties between the people in reach, as they were stated. Same filters as nodes: confirmed, allowed, unexpired.
  const people = new Set(candidates.filter((c) => c.root_type === "Person").map((c) => c.root_id));
  const relations: RelationFact[] = [];
  for (const personId of [...people].sort()) {
    for (const e of await store.edgesOf(personId)) {
      if (e.type !== "RELATED_TO" || typeof e.props.relation !== "string") continue;
      if (!people.has(e.from) || !people.has(e.to) || relations.some((r) => r.edge_id === e.id)) continue;
      if ((await whyNot(e.prov, e.prov.source_id)) !== null) continue;
      relations.push({ edge_id: e.id, from: e.from, to: e.to, relation: e.props.relation, said_as: typeof e.props.said_as === "string" ? e.props.said_as : null });
    }
  }
  relations.sort((a, b) => (a.edge_id < b.edge_id ? -1 : 1));

  excluded.sort((a, b) => (a.node_id < b.node_id ? -1 : 1));
  return { candidates, relations, excluded };
}
