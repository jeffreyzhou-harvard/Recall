/** UI prototype only. Never passed to live capture, graph, or publishing services. */
export type Outcome = "unaided" | "cue" | "recognition";
export type PreviewLine = { id: string; speaker: string; text: string; rung: number };
export type PreviewTopic = {
  id: string; name: string; shortName: string; invitation: string; source: string;
  lines: PreviewLine[]; contributionLineId: string; history: string[];
};
export type PreviewData = {
  kind: string; person: string; familyMember: string; date: string; topics: PreviewTopic[];
};
export type PreviewMemory = {
  id: string; topicId: string; text: string; sourceLineId: string;
  sourceKind: "scripted_preview"; sharedWith: string | null; date: string;
};
export type PreviewState = {
  topicId: string;
  phase: "incoming" | "conversation" | "remember" | "share" | "finished" | "stopped";
  lineIndex: number;
  paused: boolean;
  memories: PreviewMemory[];
  outcomes: Record<string, Outcome[]>;
  result: "shared" | "private" | "not_stored" | null;
};
export type PreviewAction =
  | { type: "answer" }
  | { type: "advance" }
  | { type: "pause" }
  | { type: "remember"; answer: boolean }
  | { type: "share"; answer: boolean }
  | { type: "stop" }
  | { type: "prepare"; topicId: string };

export function initialPreview(data: PreviewData): PreviewState {
  return { topicId: data.topics[0]?.id ?? "", phase: "incoming", lineIndex: 0,
    paused: false, memories: [], outcomes: {}, result: null };
}

export function reducePreview(state: PreviewState, action: PreviewAction, data: PreviewData): PreviewState {
  const topic = data.topics.find((item) => item.id === state.topicId);
  const rung = Math.max(0, ...(topic?.lines.map((line) => line.rung) ?? []));
  const outcome: Outcome = rung <= 1 ? "unaided" : rung < 4 ? "cue" : "recognition";
  // Preparing is an explicit prototype reset, never an automatic follow-up call.
  if (action.type === "prepare") {
    if (!data.topics.some((item) => item.id === action.topicId && item.lines.length)) return state;
    return { ...state, topicId: action.topicId, phase: "incoming", lineIndex: 0, paused: false, result: null };
  }
  if (!topic || state.phase === "finished" || state.phase === "stopped") return state;
  if (action.type === "stop") return { ...state, phase: "stopped", result: null, paused: false };
  if (action.type === "answer" && state.phase === "incoming") return { ...state, phase: "conversation" };
  if (action.type === "pause" && state.phase === "conversation") return { ...state, paused: !state.paused };
  if (action.type === "advance" && state.phase === "conversation") {
    return state.lineIndex < topic.lines.length - 1
      ? { ...state, lineIndex: state.lineIndex + 1 }
      : { ...state, phase: "remember", paused: false };
  }
  if (action.type === "remember" && state.phase === "remember") {
    return action.answer ? { ...state, phase: "share" }
      : { ...state, phase: "finished", result: "not_stored", outcomes: { ...state.outcomes, [topic.id]: [outcome] } };
  }
  if (action.type === "share" && state.phase === "share") {
    const contribution = topic.lines.find((line) => line.id === topic.contributionLineId && line.speaker === data.person);
    if (!contribution) return { ...state, phase: "finished", result: "not_stored" };
    const memory: PreviewMemory = {
      id: `preview-${topic.id}`, topicId: topic.id, text: contribution.text,
      sourceLineId: contribution.id, sourceKind: "scripted_preview",
      sharedWith: action.answer ? data.familyMember : null, date: data.date,
    };
    // Both choices have resolved. Until this point there is no graph mutation.
    // Replaying the same sample replaces it instead of inventing another call.
    return { ...state, phase: "finished", result: action.answer ? "shared" : "private",
      memories: [...state.memories.filter((item) => item.id !== memory.id), memory],
      outcomes: { ...state.outcomes, [topic.id]: [outcome] } };
  }
  return state;
}

export type RecordThresholds = { window: number; comparisonWindow: number; minimumCalls: number; difference: number; summaryTopicMinimum: number };
export function topicRecord(history: readonly string[], thresholds: RecordThresholds) {
  const recent = history.slice(-thresholds.window);
  const count = (values: readonly string[], outcome: Outcome) => values.filter((item) => item === outcome).length;
  const n = thresholds.comparisonWindow;
  const latest = count(recent.slice(-n), "unaided");
  const earlier = count(recent.slice(-n * 2, -n), "unaided");
  return {
    total: recent.length, enough: recent.length >= thresholds.minimumCalls,
    unaided: count(recent, "unaided"), cue: count(recent, "cue"), recognition: count(recent, "recognition"),
    change: recent.length >= n * 2 && Math.abs(latest - earlier) >= thresholds.difference ? { latest, earlier } : null,
  };
}

/** The family projection deliberately excludes private memories, transcripts and graph edges. */
export function familyShares(state: PreviewState, member: string) {
  return state.memories.filter((memory) => memory.sharedWith === member)
    .map(({ text, date, sourceLineId, sourceKind, topicId }) => ({ text, date, sourceLineId, sourceKind, topicId }));
}
