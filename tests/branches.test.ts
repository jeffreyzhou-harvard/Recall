/**
 * AGENTS.md section 12.3 and the product flow spec's stop nodes: every way a
 * run can end other than delivery. Each branch differs from the judged path by
 * data alone - one overridden part of the harness. Nothing in /lib knows which
 * branch it is in.
 */
import { describe, expect, it } from "vitest";
import { runFixture, type FixtureOptions } from "@/fixtures/harness";
import { NOTICE_TEXT } from "@/lib/bridge/thread-bridge";
import type { RelayState } from "@/lib/state/machine";
import { replay, visitedStates } from "@/lib/state/reducer";
import { BLOCKED_TOPIC_FORWARD, CONFLICTING_CLAIMS, CONFLICT_MANIFEST, THREAD, assentReplyCall, diwaliForward, doubleLostCall, toolTimeoutCall, unclearAssentCall } from "./fixtures";

const TO_REANCHORED: RelayState[] = ["idle", "ask_received", "policy_passed", "connected", "following", "lost", "reanchored"];

const BRANCHES: Array<{ name: string; options: FixtureOptions; path: RelayState[]; notice: "clarify" | "not_this_time" | null }> = [
  { name: "judged path", options: {}, path: [...TO_REANCHORED, "contributed", "playback", "assented", "delivered"], notice: null },
  { name: "policy denies the topic (spec Y: no call placed)", options: { forward: BLOCKED_TOPIC_FORWARD, transcript: null }, path: ["idle", "ask_received", "blocked"], notice: "not_this_time" },
  { name: "audience not verified (spec X: stop safely, ask family to clarify)", options: { forward: diwaliForward({ requested_audience: "person:anika" }), transcript: null }, path: ["idle", "ask_received", "blocked"], notice: "clarify" },
  { name: "remembered claims conflict", options: { overlays: [CONFLICTING_CLAIMS], manifest: CONFLICT_MANIFEST }, path: [...TO_REANCHORED, "contributed", "playback", "assented", "delivered"], notice: null },
  { name: "assent unclear (spec W: nothing is sent)", options: { transcript: unclearAssentCall() }, path: [...TO_REANCHORED, "contributed", "playback", "not_sent"], notice: "not_this_time" },
  { name: "two lost-thread signals (spec Z: close kindly)", options: { transcript: doubleLostCall() }, path: [...TO_REANCHORED, "wrapped_up"], notice: "not_this_time" },
  { name: "tool timeout mid-call", options: { transcript: toolTimeoutCall(), faults: [{ tool: "select_scaffold", on_call: 1, kind: "timeout" }] }, path: ["idle", "ask_received", "policy_passed", "connected", "following", "lost", "fallback", "closed_kindly"], notice: "not_this_time" },
];

describe.each(BRANCHES)("$name", ({ options, path, notice }) => {
  it("ends where it must, and the family's thread gets exactly the right thing", async () => {
    const run = await runFixture(options);
    expect(visitedStates(replay(run.recording.trace))).toEqual(path);
    expect(run.recording.trace.filter((t) => !t.accepted)).toEqual([]);

    const delivered = path.at(-1) === "delivered";
    const kinds = run.recording.messages.map((m) => m.kind);
    expect(kinds).toEqual(delivered ? ["voice_contribution", "support_receipt"] : ["family_notice"]);
    const posted = run.recording.messages.find((m) => m.kind === "family_notice");
    expect(posted ? { notice: posted.notice, text: posted.text, to: posted.to } : null).toEqual(
      notice ? { notice, text: NOTICE_TEXT[notice], to: { thread_id: THREAD } } : null,
    );
    expect(run.recording.caregiver_receipt!.family_notice?.notice ?? null).toBe(notice);
  });
});

describe("policy denial", () => {
  it("never places the call and never touches the graph", async () => {
    const run = await runFixture({ forward: BLOCKED_TOPIC_FORWARD, transcript: null });
    const tools = run.runtime.log.map((c) => c.tool);
    expect(tools).toEqual(["inspect_request", "resolve_identity_and_relationships", "get_access_policy", "build_caregiver_receipt"]);
    expect(run.recording.spoken).toEqual([]);
    expect(run.recording.call).toBeNull();
    expect(run.runtime.log.find((c) => c.tool === "get_access_policy")!.policy_decision).toBe("denied:topic_blocked");
  });
});

describe("conflicting claims", () => {
  it("falls back to the current ask only and never speaks a remembered fact", async () => {
    const run = await runFixture({ overlays: [CONFLICTING_CLAIMS], manifest: CONFLICT_MANIFEST });
    expect(replay(run.recording.trace).context.evidence_mode).toBe("current_ask_only");
    const support = run.runtime.log.find((c) => c.tool === "verify_claim_support")!.output as {
      verified: Array<{ claim_id: string }>;
      rejected: Array<{ claim_id: string; reason: string }>;
      conflicts: unknown[];
    };
    expect(support.conflicts).toHaveLength(1);
    expect(support.verified.map((v) => v.claim_id).filter((id) => id.startsWith("claim:"))).toEqual([]);
    expect(support.rejected.filter((r) => r.claim_id.startsWith("claim:")).map((r) => r.reason)).toEqual(["contradicted", "contradicted"]);
    // The current ask still works, and with no verified prior claim the receipt says nothing about family knowledge.
    expect(support.verified.map((v) => v.claim_id)).toContain("artifact:photo:fwd-diwali-dessert:photo-desserts");
    expect(run.recording.caregiver_receipt!.lines.find((l) => l.dimension === "intellectual")!.text).toBe("She chose.");
  });
});

describe("unclear assent", () => {
  it("sends nothing and discards the unapproved audio", async () => {
    const run = await runFixture({ transcript: unclearAssentCall() });
    expect(run.runtime.log.map((c) => c.tool)).not.toContain("publish_contribution");
    expect((run.runtime.log.find((c) => c.tool === "request_assent")!.output as { decision: string }).decision).toBe("unclear");
    expect(run.bridge.voiceCards()).toEqual([]);
    expect(run.ctx.session).toMatchObject({ contribution: null, assent: null, unapproved_audio_discarded: true });
    // Nothing she did not approve reaches the audit layer of the graph.
    const { nodes } = await run.graph.snapshot();
    expect(nodes.filter((n) => n.type === "Contribution" || n.type === "Assent")).toEqual([]);
    expect(run.recording.provenance_receipt).toBeNull();
  });
});

describe("assent that is not a clean yes", () => {
  const decisionFor = async (reply: string): Promise<string> => {
    const run = await runFixture({ transcript: assentReplyCall(reply) });
    expect(run.bridge.voiceCards()).toEqual([]);
    return (run.runtime.log.find((c) => c.tool === "request_assent")!.output as { decision: string }).decision;
  };

  it("treats a yes followed by a refusal as unclear, wherever the refusal falls", async () => {
    for (const reply of ["Yes, not now.", "Yes. Stop.", "Yeah, nope.", "Okay, do not send it."]) {
      expect(await decisionFor(reply), reply).toBe("unclear");
    }
  });

  it("publishes on nothing but a clean yes: no list of refusal words could ever be complete", async () => {
    // Every one of these opens with a yes-word, contains no "no", and is not a yes. The last asks for a different audience.
    for (const reply of ["Okay, never mind.", "Yes, cancel that.", "Sure, but change it first.", "Okay, let me think about it.", "Yeah, actually delete it.", "Sure, send it to Rohan instead."]) {
      expect(await decisionFor(reply), reply).toBe("unclear");
    }
  });

  it("still hears the ordinary ways of saying yes", async () => {
    for (const reply of ["Yes.", "Yes please.", "Yeah, send it.", "Okay, go ahead.", "Sure, please do. Thank you."]) {
      const run = await runFixture({ transcript: assentReplyCall(reply) });
      expect((run.runtime.log.find((c) => c.tool === "request_assent")!.output as { decision: string }).decision, reply).toBe("yes");
      expect(run.recording.final_state, reply).toBe("delivered");
    }
  });

  it("does not take politeness alone for a yes", async () => {
    for (const reply of ["Thank you.", "Please.", "It."]) expect(await decisionFor(reply), reply).toBe("unclear");
  });

  it("hears a refusal that does not open the reply", async () => {
    expect(await decisionFor("Please don't.")).toBe("no");
    expect(await decisionFor("Hmm, no.")).toBe("no");
  });
});

describe("two lost-thread signals", () => {
  it("wraps up gently", async () => {
    const run = await runFixture({ transcript: doubleLostCall() });
    expect(replay(run.recording.trace).context.lost_signals).toBe(2);
    expect(run.recording.spoken.at(-1)!.text).toBe("That's alright. We can come back to this another time.");
  });
});

describe("tool timeout", () => {
  it("restates the question exactly once, then closes kindly", async () => {
    const run = await runFixture({ transcript: toolTimeoutCall(), faults: [{ tool: "select_scaffold", on_call: 1, kind: "timeout" }] });
    const events = run.recording.trace.filter((t) => t.accepted).map((t) => t.event);
    expect(events.slice(-3)).toEqual(["TOOL_TIMEOUT", "FIXED_RESTATEMENT_DELIVERED", "CALL_CLOSED"]);
    const brief = "Anika wants your help with Diwali dessert.";
    expect(run.recording.spoken.map((s) => s.text)).toEqual([brief, brief, "Thank you. We'll talk again soon."]);
  });
});

describe("what the family is told when nothing was delivered", () => {
  it("is one of two fixed sentences, neither of which says anything about her", () => {
    expect(Object.values(NOTICE_TEXT)).toHaveLength(2);
    for (const text of Object.values(NOTICE_TEXT)) expect(text).not.toMatch(/\b(she|her|mom|confus|forgot|memory|unwell|tired|upset)\b/i);
  });
});
