/** Display metadata only. No graph claims or private words. */
export type SessionSummary = {
  id: string; date: string; topicId: string; topicName: string; outcome: "unaided" | "cue" | "recognition" | "unreached";
  recentCalls: number; unaidedCalls: number | null;
};

/**
 * Every per-topic record sentence opens with "{topic} - " so that it stands on its own, which it
 * has to do under a comparison heading. Where the topic name is already beside the sentence, drop
 * the prefix rather than say the name three times. The wording itself still comes from family-copy.
 */
export function withoutTopic(text: string, topic: string): string {
  const rest = text.startsWith(topic + " - ") ? text.slice(topic.length + 3) : "";
  return rest ? rest[0]!.toUpperCase() + rest.slice(1) : text;
}

export function sessionSupport(outcome: SessionSummary["outcome"]) {
  return outcome === "unaided" ? "This topic was recalled without a cue."
    : outcome === "cue" ? "Recall offered a cue during this conversation."
    : outcome === "recognition" ? "Recall offered a recognition prompt during this conversation." : "This topic was not reached in this call.";
}
