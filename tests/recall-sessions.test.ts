import { describe, expect, it } from "vitest";
import data from "@/fixtures/recall-preview.json";
import timeline from "@/fixtures/preview/session-timeline.json";
import thresholds from "@/fixtures/preview/record-thresholds.json";
import { sessionSummaries } from "@/lib/recall-preview/sessions";

describe("caregiver waveform projection", () => {
  it("uses only a topic's history up to the selected call", () => {
    const sessions = sessionSummaries(data.topics, timeline, thresholds);
    expect(sessions.find((session) => session.id === "sample-05")).toMatchObject({ recentCalls: 3, unaidedCalls: 2 });
    expect(sessions.at(-1)).toMatchObject({ recentCalls: 8, unaidedCalls: 6 });
    expect(sessions.find((session) => session.id === "sample-17")).toMatchObject({ recentCalls: 8, unaidedCalls: 5 });
  });
  it("leaves insufficient history unmeasured, never zero", () => {
    const sessions = sessionSummaries(data.topics, timeline, thresholds);
    expect(sessions.filter((session) => session.recentCalls < 3).every((session) => session.unaidedCalls === null)).toBe(true);
  });
  it("excludes patient words and malformed references", () => {
    const sessions = sessionSummaries(data.topics, [...timeline, { id: "missing", date: "2026-09-20", topicId: "unknown", historyIndex: 0 }, { id: "negative", date: "2026-09-20", topicId: "cape-may", historyIndex: -1 }], thresholds);
    expect(sessions).toHaveLength(timeline.length);
    expect(Object.keys(sessions[0]!).sort()).toEqual(["id", "date", "topicId", "topicName", "outcome", "recentCalls", "unaidedCalls"].sort());
    expect(JSON.stringify(sessions)).not.toContain("We went to Cape May");
  });
  it("caps each topic window without pooling topics", () => {
    const topics = [{ id: "a", name: "A", history: [...Array<string>(10).fill("unaided"), "cue"] }, { id: "b", name: "B", history: ["cue", "cue", "cue"] }];
    expect(sessionSummaries(topics, [{ id: "a", date: "2026-09-19", topicId: "a", historyIndex: 10 }], thresholds)[0]).toMatchObject({ recentCalls: 8, unaidedCalls: 7 });
    expect(sessionSummaries([], [], thresholds)).toEqual([]);
  });
});
