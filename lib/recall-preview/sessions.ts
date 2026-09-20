import { topicRecord, type PreviewTopic, type RecordThresholds } from "./model";

export type SessionReference = { id: string; date: string; topicId: string; historyIndex: number };
export { sessionSupport, type SessionSummary } from "@/lib/family/session-summary";
import type { SessionSummary } from "@/lib/family/session-summary";

/** Only event metadata enters the waveform. No memory, claim, transcript or sharing state. */
export function sessionSummaries(
  topics: readonly Pick<PreviewTopic, "id" | "name" | "history">[],
  references: readonly SessionReference[],
  thresholds: RecordThresholds,
): SessionSummary[] {
  return references.flatMap<SessionSummary>((reference) => {
    const topic = topics.find((item) => item.id === reference.topicId);
    if (!topic || !Number.isInteger(reference.historyIndex) || reference.historyIndex < 0) return [];
    const outcome = topic.history[reference.historyIndex];
    if (outcome !== "unaided" && outcome !== "cue" && outcome !== "recognition") return [];
    // A historical peak never uses future calls, or another topic's observations.
    const record = topicRecord(topic.history.slice(0, reference.historyIndex + 1), thresholds);
    return [{ id: reference.id, date: reference.date, topicId: topic.id, topicName: topic.name,
      outcome, recentCalls: record.total, unaidedCalls: record.enough ? record.unaided : null }];
  }).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
