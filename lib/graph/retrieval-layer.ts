/**
 * The retrieval layer (AGENTS.md section 6.3): which specific cue actually got
 * her to a memory, per topic.
 *
 * It stores, per topic and per cue, a rung, whether she reached the memory
 * after it, and when - one RetrievalRecord per use, so an "effectiveness count"
 * is a count of records and can never drift from what happened.
 *
 * It answers exactly one question: once the ladder has ALREADY decided a rung
 * is warranted, which candidate cue to reach for. It never decides whether to
 * climb, it is never a trend or a score, and nothing on the family side can
 * read it: `FamilyView` has no method that touches a RetrievalRecord.
 */
import type { GraphStore } from "./store";

export interface CueHint {
  cue_id: string;
  effective: number;
  ineffective: number;
  last_used_at: string;
}

export async function cueHints(graph: GraphStore, topicId: string): Promise<CueHint[]> {
  const hints = new Map<string, CueHint>();
  for (const r of await graph.nodesOfType("RetrievalRecord")) {
    if (r.props.topic_id !== topicId) continue;
    const h = hints.get(r.props.cue_id) ?? { cue_id: r.props.cue_id, effective: 0, ineffective: 0, last_used_at: r.props.used_at };
    if (r.props.effective) h.effective++;
    else h.ineffective++;
    if (r.props.used_at > h.last_used_at) h.last_used_at = r.props.used_at;
    hints.set(r.props.cue_id, h);
  }
  return [...hints.values()].sort((a, b) => (a.cue_id < b.cue_id ? -1 : 1));
}

/**
 * Order candidate cues: ones that have helped her before first (most often first), ones never tried next,
 * ones that have only ever not helped last. Ties break on the cue's id, so the order is always the same.
 * With no hints at all this is plain id order: "no cue preference".
 */
export function preferCues<T extends { cue_id: string }>(candidates: readonly T[], hints: readonly CueHint[]): T[] {
  const by = new Map(hints.map((h) => [h.cue_id, h]));
  const tier = (c: T): number => {
    const h = by.get(c.cue_id);
    if (!h) return 1;
    return h.effective > 0 ? 0 : 2;
  };
  return [...candidates].sort((a, b) => tier(a) - tier(b) || (by.get(b.cue_id)?.effective ?? 0) - (by.get(a.cue_id)?.effective ?? 0) || (a.cue_id < b.cue_id ? -1 : a.cue_id > b.cue_id ? 1 : 0));
}

/** Her caregiver can clear either layer at any time, each on its own (section 6.3). Returns how many records went. */
export const clearRetrievalLayer = (graph: GraphStore): Promise<number> => graph.removeNodesOfType("RetrievalRecord");
export const clearTopicRecord = (graph: GraphStore): Promise<number> => graph.removeNodesOfType("TopicOutcome");
