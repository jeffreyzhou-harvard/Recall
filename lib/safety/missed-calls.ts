/**
 * Missed-call tiering (AGENTS.md rule 15). Scheduler-level, never inside the
 * call reducer and never through `check_safety_phrases` or
 * `assess_conversation_state`. The streak is the count of trailing scheduled
 * attempts that rang and were never answered. The graph does not overwrite
 * nodes, so this is read from Session records, not written onto AccessPolicy.
 */
import type { SafetyThresholds } from "@/lib/family/copy";
import { NOT_ANSWERED } from "@/lib/graph/types";
import type { GraphStore } from "@/lib/graph/store";

export const MISSED_CALLS_CATEGORY = "missed_calls";

export interface MissedCallState {
  streak: number;
  last_attempt_at: string | null;
}

/** Consecutive `not_answered` sessions at the end of the record. A later connected call (any other outcome) resets the count. */
export async function readMissedCallState(graph: GraphStore): Promise<MissedCallState> {
  const sessions = (await graph.nodesOfType("Session")).slice().sort((a, b) => (a.props.started_at < b.props.started_at ? -1 : a.props.started_at > b.props.started_at ? 1 : a.id < b.id ? -1 : 1));
  let streak = 0;
  let last: string | null = null;
  for (const s of sessions) {
    if (s.props.outcome === NOT_ANSWERED) {
      streak += 1;
      last = s.props.started_at;
    } else {
      streak = 0;
      last = null;
    }
  }
  return { streak, last_attempt_at: last };
}

export function noticeVisible(state: MissedCallState, thresholds: SafetyThresholds): boolean {
  return state.streak >= thresholds.missed_call_notice_threshold;
}

export function shouldFireMissedCallAlert(state: MissedCallState, thresholds: SafetyThresholds, thisAttemptWasMiss: boolean): boolean {
  return thisAttemptWasMiss && state.streak >= thresholds.missed_call_alert_threshold;
}
