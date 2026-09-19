import { describe, expect, it } from "vitest";
import data from "@/fixtures/recall-preview.json";
import thresholds from "@/fixtures/preview/record-thresholds.json";
import { familyShares, initialPreview, reducePreview, topicRecord, type PreviewAction, type PreviewState } from "@/lib/recall-preview/model";

const reduce = (state: PreviewState, action: PreviewAction) => reducePreview(state, action, data);
function heardConversation() {
  let state = reduce(initialPreview(data), { type: "answer" });
  for (const _line of data.topics[0]!.lines) state = reduce(state, { type: "advance" });
  return state;
}

describe("isolated recall frontend preview", () => {
  it("does not store words before both separate decisions resolve", () => {
    const asking = heardConversation();
    expect(asking.phase).toBe("remember");
    expect(asking.memories).toEqual([]);
    const sharing = reduce(asking, { type: "remember", answer: true });
    expect(sharing.phase).toBe("share");
    expect(sharing.memories).toEqual([]);
    const done = reduce(sharing, { type: "share", answer: true });
    expect(done.memories[0]).toMatchObject({ text: "We went to Cape May every summer.", sourceLineId: "CAPE-08", sourceKind: "scripted_preview", sharedWith: "Maya" });
    expect(done.outcomes["cape-may"]).toEqual(["cue"]);
  });

  it("retains a completed call outcome, but no words, when storage is declined", () => {
    const done = reduce(heardConversation(), { type: "remember", answer: false });
    expect(done.result).toBe("not_stored");
    expect(done.memories).toEqual([]);
    expect(done.outcomes["cape-may"]).toEqual(["cue"]);
    expect(familyShares(done, "Maya")).toEqual([]);
  });

  it("stores privately when sharing is declined and projects no private text", () => {
    const done = reduce(reduce(heardConversation(), { type: "remember", answer: true }), { type: "share", answer: false });
    expect(done.memories).toHaveLength(1);
    expect(done.result).toBe("private");
    expect(familyShares(done, "Maya")).toEqual([]);
  });

  it("only projects shares to the exact selected member", () => {
    const done = reduce(reduce(heardConversation(), { type: "remember", answer: true }), { type: "share", answer: true });
    expect(familyShares(done, "Maya")).toHaveLength(1);
    expect(familyShares(done, "Anika")).toEqual([]);
    expect(familyShares(done, "Maya")[0]).not.toHaveProperty("memories");
  });

  it.each(["incoming", "conversation", "remember", "share"] as const)("stops from %s without a new memory and ignores delayed actions", (phase) => {
    const stopped = reduce({ ...heardConversation(), phase }, { type: "stop" });
    expect(stopped.phase).toBe("stopped");
    expect(stopped.memories).toEqual([]);
    for (const action of [{ type: "answer" }, { type: "advance" }, { type: "remember", answer: true }, { type: "share", answer: true }] as PreviewAction[]) {
      expect(reduce(stopped, action)).toBe(stopped);
    }
  });

  it("ignores out-of-order confirmation and duplicate submission", () => {
    const initial = initialPreview(data);
    expect(reduce(initial, { type: "share", answer: true })).toBe(initial);
    const done = reduce(reduce(heardConversation(), { type: "remember", answer: true }), { type: "share", answer: true });
    expect(reduce(done, { type: "share", answer: true })).toBe(done);
  });

  it("requires an explicit preview reset to leave a terminal state", () => {
    const stopped = reduce(initialPreview(data), { type: "stop" });
    expect(reduce(stopped, { type: "prepare", topicId: "missing" })).toBe(stopped);
    expect(reduce(stopped, { type: "prepare", topicId: "lincoln" })).toMatchObject({ phase: "incoming", topicId: "lincoln" });
  });

  it("does not invent another call when a sample is replayed", () => {
    let state = reduce(reduce(heardConversation(), { type: "remember", answer: true }), { type: "share", answer: true });
    state = reduce(state, { type: "prepare", topicId: "cape-may" });
    state = reduce(state, { type: "answer" });
    for (const _line of data.topics[0]!.lines) state = reduce(state, { type: "advance" });
    state = reduce(reduce(state, { type: "remember", answer: true }), { type: "share", answer: true });
    expect(state.memories).toHaveLength(1);
    expect(state.outcomes["cape-may"]).toHaveLength(1);
  });
});

describe("neutral topic record", () => {
  it("uses the specified sample counts and topic-specific threshold", () => {
    expect(topicRecord(data.topics[0]!.history, thresholds)).toMatchObject({ total: 8, unaided: 6, cue: 2, recognition: 0, change: null });
    expect(topicRecord(data.topics[1]!.history, thresholds)).toMatchObject({ total: 8, unaided: 5, cue: 2, recognition: 1, change: { latest: 1, earlier: 4 } });
    expect(topicRecord(data.topics[2]!.history, thresholds).enough).toBe(false);
  });

  it("keeps only the last eight calls and requires a difference of at least three", () => {
    expect(topicRecord(["cue", ...Array<string>(8).fill("unaided")], thresholds)).toMatchObject({ total: 8, unaided: 8, change: null });
    expect(topicRecord(["unaided", "unaided", "unaided", "unaided", "cue", "cue", "unaided", "unaided"], thresholds).change).toBe(null);
    expect(topicRecord(["cue", "cue", "cue", "unaided", "unaided", "unaided", "unaided", "unaided"], thresholds).change).toEqual({ latest: 4, earlier: 1 });
  });

  it("does not display comparisons before eight calls", () => {
    expect(topicRecord(["cue", "cue", "cue", "unaided", "unaided", "unaided", "unaided"], thresholds).change).toBe(null);
    expect(topicRecord(["cue", "cue", "unaided"], thresholds).enough).toBe(true);
  });
});
