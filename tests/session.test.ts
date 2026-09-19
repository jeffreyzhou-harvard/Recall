/**
 * Session recordings and the view selectors behind the Relay web experience
 * (product flow spec: D request intake, E live session view, F receipt and
 * provenance). One reducer drives every pane: the views are the trace,
 * re-reduced to a moment in time.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { runFixture, runJudgedPath, type FixtureRun } from "@/fixtures/harness";
import { callTimeToIso, stateAt } from "@/lib/session/recording";
import { intakeView, liveSessionView, receiptView } from "@/lib/session/view";
import { replay } from "@/lib/state/reducer";
import { BLOCKED_TOPIC_FORWARD, goldenTurn, unclearAssentCall } from "./fixtures";

let run: FixtureRun;
beforeAll(async () => {
  run = await runJudgedPath();
});

/** The moment a given point in the call audio corresponds to on the trace's clock. */
const at = (callMs: number): string => callTimeToIso(run.recording, callMs)!;

describe("recording", () => {
  it("is plain data: it survives JSON, so it can be stored or sent to the browser as is", () => {
    expect(JSON.parse(JSON.stringify(run.recording))).toEqual(run.recording);
  });

  it("replays exactly: re-reducing the trace rebuilds the machine the run ended with", () => {
    const rebuilt = replay(run.recording.trace);
    expect(rebuilt.state).toBe(run.recording.final_state);
    expect(rebuilt.trace).toEqual(run.recording.trace);
    expect(rebuilt.context).toMatchObject({ ask_id: "ask:fwd-diwali-dessert", lost_signals: 1, scaffolds_used: ["restate_options"], family_notice: null });
  });

  it("can be scrubbed: the state at any moment is the trace re-reduced up to it", () => {
    expect(stateAt(run.recording, run.recording.started_at).state).toBe("idle");
    expect(stateAt(run.recording, at(goldenTurn("r1").end_ms)).state).toBe("following");
    expect(stateAt(run.recording, at(goldenTurn("p1").end_ms + 100)).state).toBe("lost");
    expect(stateAt(run.recording, at(goldenTurn("r2").end_ms)).state).toBe("reanchored");
    expect(stateAt(run.recording, at(goldenTurn("pb1").end_ms)).state).toBe("playback");
    expect(stateAt(run.recording).state).toBe("delivered");
  });

  it("summarizes the ask in display terms taken from the graph", () => {
    expect(run.recording.ask).toMatchObject({
      text: "Mom, which should I make for Diwali?",
      asker: { name: "Anika" },
      person: { name: "Mom" },
      about: "Diwali dessert",
      options: [{ label: "kheer" }, { label: "halwa" }],
    });
    expect(run.recording.ask!.photos).toHaveLength(1);
  });
});

describe("request intake view", () => {
  it("shows each gate passing in order as the run unfolds", () => {
    const statuses = (iso?: string) => Object.fromEntries(intakeView(run.recording, iso).gates.map((g) => [g.gate, g.status]));
    expect(statuses(run.recording.started_at)).toEqual({ identity_and_audience: "pending", access_policy: "pending", evidence: "pending", assent: "pending" });
    expect(statuses(at(0))).toEqual({ identity_and_audience: "passed", access_policy: "passed", evidence: "passed", assent: "pending" });
    expect(statuses()).toEqual({ identity_and_audience: "passed", access_policy: "passed", evidence: "passed", assent: "passed" });
  });

  it("shows where a run stopped", async () => {
    const denied = await runFixture({ forward: BLOCKED_TOPIC_FORWARD, transcript: null });
    expect(intakeView(denied.recording).gates.map((g) => g.status)).toEqual(["passed", "stopped", "pending", "pending"]);
    const unclear = await runFixture({ transcript: unclearAssentCall() });
    expect(intakeView(unclear.recording).gates.map((g) => g.status)).toEqual(["passed", "passed", "passed", "stopped"]);
  });
});

describe("live session view", () => {
  it("names the one familiar person and what is being asked, at all times", () => {
    expect(liveSessionView(run.recording, at(5000)).headline).toEqual({ person: "Mom", asker: "Anika", about: "Diwali dessert" });
  });

  it("shows one cue at a time, following what Relay just said", () => {
    const cueAt = (ms: number) => liveSessionView(run.recording, at(ms)).cue?.kind ?? null;
    expect(cueAt(goldenTurn("r1").end_ms)).toBe("photo");
    expect(cueAt(goldenTurn("r2").end_ms)).toBe("choices");
    expect(cueAt(goldenTurn("r3").end_ms)).toBe("approval");
    expect(liveSessionView(run.recording).cue).toBeNull(); // the call is over: the stage clears
    const choices = liveSessionView(run.recording, at(goldenTurn("r2").end_ms)).cue;
    expect(choices).toMatchObject({ kind: "choices", options: [{ label: "kheer" }, { label: "halwa" }] });
  });

  it("speaks its status in plain words, never in diagnostic ones", () => {
    const line = (ms: number) => liveSessionView(run.recording, at(ms)).status_line;
    expect(line(goldenTurn("r1").end_ms)).toBe("I'm listening");
    expect(line(goldenTurn("p1").end_ms + 100)).toBe("Let's make this easier");
    expect(line(goldenTurn("pb1").end_ms)).toBe("Would you like me to share that?");
  });

  it("builds human-readable trace cards, with the tool as a small label for judges", () => {
    const cards = liveSessionView(run.recording).trace_cards;
    expect(cards.map((c) => c.label)).toEqual([
      "Ask received", "Ask verified", "Call connected", "Ask shared", "Thread unclear", "Re-anchored",
      "Answer heard", "Her exact words captured", "Played back for approval", "Voice approval received", "Delivered to the family thread",
    ]);
    expect(cards.find((c) => c.label === "Ask verified")!.tool).toBe("get_access_policy");
    expect(cards.find((c) => c.label === "Thread unclear")!.tool).toBe("assess_conversation_state");
    expect(cards.find((c) => c.label === "Call connected")!.tool).toBeNull();
  });

  it("has no field for confidence, a clinical label, or any analytic about her", () => {
    const keys = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (keys.add(k), walk(x));
    };
    walk([liveSessionView(run.recording), intakeView(run.recording)]);
    expect([...keys].filter((k) => /confidence|score|rating|diagnos|cognit|mood|emotion|decline|risk|severity/i.test(k))).toEqual([]);
  });
});

describe("receipt and provenance view", () => {
  it("shows source, trims, assent, and destination for what was delivered", () => {
    const view = receiptView(run.recording);
    expect(view.outcome).toBe("delivered");
    expect(view.delivered!.card.literal_transcript).toBe("Make the kheer. Your grandfather always added cardamom last.");
    expect(view.provenance).toMatchObject({
      edits: { silence_trims: 3, disfluency_trims: 0, generated_first_person_words: 0 },
      delivered_to: ["artifact:thread-family"],
      final_line: "Access changed. Authorship didn't.",
    });
    expect(view.support_receipt_sent_to).toEqual(["person:anika"]);
    expect(view.family_notice).toBeNull();
  });

  it("shows the notice instead, and no provenance, when nothing was sent", async () => {
    const view = receiptView((await runFixture({ transcript: unclearAssentCall() })).recording);
    expect(view).toMatchObject({ outcome: "not_sent", delivered: null, provenance: null, support_receipt_sent_to: [] });
    expect(view.family_notice!.notice).toBe("not_this_time");
  });
});
