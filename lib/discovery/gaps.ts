/**
 * Knowledge gaps: what the graph shows Relay does not know yet.
 *
 *   evidence -> graph -> knowledge gap -> question -> answer -> richer graph -> better gap
 *
 * Deterministic and graph-guided: a gap is a shape in the graph (a recurring
 * face with no name; a named person with no stated tie to her), not a topic a
 * model thought would be interesting. The more the graph holds, the more
 * specific the next gap gets - which is why the family's work goes down as
 * Relay's context goes up.
 *
 * NEVER A TEST. A gap is something Relay does not know. Once she has said who
 * someone is, that fact is never a gap again, so Relay has no way to ask
 * "who is this?" to check whether she still remembers. Nothing about how a
 * question went - which rung, how long, whether she answered - is an input
 * here or is stored anywhere (see answers.ts): there is no longitudinal signal
 * to build a memory score from. "Retrieve when possible. Recognize when
 * necessary. Never turn remembering into a test."
 */
import { relationOf } from "@/lib/graph/relations";
import type { GraphStore } from "@/lib/graph/store";
import { SPEAKABLE_AS_FACT, type ClusterNode, type GraphEdge, type GraphNode, type NodeType } from "@/lib/graph/types";

export type GapKind =
  /** A recurring face, place, time, or theme nobody has named. */
  | "unidentified"
  /** A named person with no stated tie to her. */
  | "how_related"
  /** A named person who recurs, and no story of hers about them yet. An invitation, not a question with an answer. */
  | "tell_me_about"
  /**
   * The family told Relay who this is; she has not said so herself. Inviting her to is an act of
   * authorship, not a quiz - but only a family can judge that, so it is off unless the joint setup
   * turned it on, and it is asked at most until she has confirmed it once.
   */
  | "invite_her_word";

export interface Gap {
  gap_id: string;
  kind: GapKind;
  /** The cluster the question is about, and the photos to look at. */
  cluster_id: string;
  photo_count: number;
  /** What kind of thing the answer names. */
  expects: NodeType;
  /** Already-confirmed people who appear in these same photos: real context for the question. */
  together_with: Array<{ person_id: string; name: string; shared_photos: number }>;
  /** The confirmed identification, when there is one. */
  identified_as: { node_id: string; name: string; edge_id: string } | null;
}

const EXPECTS: Record<ClusterNode["props"]["kind"], NodeType> = { face: "Person", place: "Place", time: "Event", theme: "Activity" };
const KIND_ORDER: Record<GapKind, number> = { unidentified: 0, how_related: 1, invite_her_word: 2, tell_me_about: 3 };

export interface GapOptions {
  participant_id: string;
  invite_her_confirmation: boolean;
  /** Gaps already raised in this sitting. Session state only; never persisted. */
  asked_this_session?: ReadonlySet<string>;
  /** A person must recur at least this often before Relay invites a story about them. */
  story_min_photos?: number;
}

const live = (e: GraphEdge): boolean => SPEAKABLE_AS_FACT.has(e.prov.status);
const displayName = (n: GraphNode): string => (n.type === "Person" ? n.props.display_name : n.label);

export async function findGaps(graph: GraphStore, options: GapOptions): Promise<Gap[]> {
  const clusters = await graph.nodesOfType("Cluster");
  const photosOf = new Map<string, Set<string>>();
  const identity = new Map<string, { node: GraphNode; edge: GraphEdge }>();

  for (const c of clusters) {
    const edges = await graph.edgesOf(c.id);
    photosOf.set(c.id, new Set(edges.filter((e) => e.type === "DEPICTS" && e.to === c.id).map((e) => e.from)));
    const named = edges.find((e) => e.type === "IDENTIFIED_AS" && e.from === c.id && live(e));
    const node = named ? await graph.getNode(named.to) : null;
    if (named && node) identity.set(c.id, { node, edge: named });
  }

  const shared = (a: string, b: string): number => [...(photosOf.get(a) ?? [])].filter((p) => photosOf.get(b)?.has(p)).length;
  const knownPeople = clusters.filter((c) => c.props.kind === "face" && identity.has(c.id));

  const gaps: Gap[] = [];
  for (const c of clusters) {
    const who = identity.get(c.id) ?? null;
    const together = knownPeople
      .filter((k) => k.id !== c.id)
      .map((k) => ({ person_id: identity.get(k.id)!.node.id, name: displayName(identity.get(k.id)!.node), shared_photos: shared(c.id, k.id) }))
      .filter((t) => t.shared_photos > 0 && t.person_id !== options.participant_id)
      .sort((a, b) => b.shared_photos - a.shared_photos || (a.person_id < b.person_id ? -1 : 1));
    const base = {
      cluster_id: c.id,
      photo_count: c.props.photo_count,
      expects: EXPECTS[c.props.kind],
      together_with: together,
      identified_as: who ? { node_id: who.node.id, name: displayName(who.node), edge_id: who.edge.id } : null,
    };
    const add = (kind: GapKind): void => void gaps.push({ gap_id: `${kind}:${c.id}`, kind, ...base });

    if (!who) {
      add("unidentified");
      continue;
    }
    if (who.node.type !== "Person" || who.node.id === options.participant_id) continue;

    if (options.invite_her_confirmation && who.edge.prov.status === "family_confirmed") add("invite_her_word");

    const ties = (await graph.edgesOf(who.node.id)).filter((e) => relationOf(e) !== null && live(e));
    const tiedToHer = ties.some((e) => e.from === options.participant_id || e.to === options.participant_id);
    if (!tiedToHer) add("how_related");

    const hasStory = (await graph.edgesOf(who.node.id)).some((e) => e.type === "ABOUT" && e.to === who.node.id && e.from.startsWith("story:"));
    if (tiedToHer && !hasStory && c.props.photo_count >= (options.story_min_photos ?? 5)) add("tell_me_about");
  }

  const asked = options.asked_this_session ?? new Set<string>();
  return gaps
    .filter((g) => !asked.has(g.gap_id))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.photo_count - a.photo_count || (a.gap_id < b.gap_id ? -1 : 1));
}

/** "Identify 3 anchors": the most present unnamed things. Naming these unlocks the most follow-on questions. */
export const anchors = (gaps: readonly Gap[], count = 3): Gap[] => gaps.filter((g) => g.kind === "unidentified").slice(0, count);
