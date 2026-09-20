/** Display metadata only. No graph claims or private words. */
export type SessionSummary = {
  id: string; date: string; topicId: string; topicName: string; outcome: "unaided" | "cue" | "recognition" | "unreached";
  recentCalls: number; unaidedCalls: number | null;
};

export function sessionSupport(outcome: SessionSummary["outcome"]) {
  return outcome === "unaided" ? "This topic was recalled without a cue."
    : outcome === "cue" ? "Recall offered a cue during this conversation."
    : outcome === "recognition" ? "Recall offered a recognition prompt during this conversation." : "This topic was not reached in this call.";
}
