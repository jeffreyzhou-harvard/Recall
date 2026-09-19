/** AGENTS.md section 12.1: the golden path, idle to delivered, on fixtures alone. */
import { beforeAll, describe, expect, it } from "vitest";
import { runJudgedPath, type FixtureRun } from "@/fixtures/harness";
import { MAIN_LINE } from "@/lib/state/machine";
import { replay, visitedStates } from "@/lib/state/reducer";
import { ENFORCED_SEQUENCE, type ToolName } from "@/lib/tools";

let run: FixtureRun;

beforeAll(async () => {
  run = await runJudgedPath();
});

describe("golden path", () => {
  it("walks the documented main line exactly, idle to delivered", () => {
    expect(visitedStates(replay(run.recording.trace))).toEqual([...MAIN_LINE]);
    expect(run.recording.final_state).toBe("delivered");
  });

  it("emits a trace entry for every transition, and rejects nothing", () => {
    const { trace } = run.recording;
    expect(trace.every((t) => t.accepted)).toBe(true);
    expect(trace.map((t) => t.seq)).toEqual(trace.map((_, i) => i + 1));
    for (const state of MAIN_LINE.slice(1)) {
      expect(trace.some((t) => t.to === state), `no trace entry enters "${state}"`).toBe(true);
    }
    expect(trace.every((t) => t.label.length > 0)).toBe(true);
  });

  it("says the three scripted lines, verbatim, in order", () => {
    // Exactly these three and nothing else: the fixed-script lines were prepared but never said.
    expect(run.ctx.session.spoken.map((s) => s.text)).toEqual([
      "Anika wants your help with Diwali dessert.",
      "Kheer or halwa. Anika sent this photo.",
      "Want me to send that to Anika?",
    ]);
  });

  it("retrieves only Anika's one current photo plus the one source-backed prior claim", () => {
    const retrieval = run.runtime.log.find((c) => c.tool === "query_context_graph")!.output as {
      candidates: Array<{ root_id: string }>;
      excluded: Array<{ node_id: string; reason: string }>;
    };
    expect(retrieval.candidates.map((c) => c.root_id).sort()).toEqual(["artifact:photo:fwd-diwali-dessert:photo-desserts", "claim:cardamom-last"]);
    expect(retrieval.excluded).toEqual([{ node_id: "pref:mom-festival-desserts", reason: "source_class_not_allowed" }]);
  });

  it("chooses the least support that answers what she asked, and records what it passed over", () => {
    const pick = run.runtime.log.find((c) => c.tool === "select_scaffold")!.output as {
      scaffold_id: string;
      rejected: Array<{ scaffold_id: string; reason: string }>;
    };
    expect(pick.scaffold_id).toBe("restate_options");
    expect(pick.rejected.map((r) => r.scaffold_id)).toEqual(["repeat", "name_asker", "source_backed_cue"]);
    expect(pick.rejected.at(-1)!.reason).toMatch(/held in reserve/);
  });

  it("delivers her exact words to the original thread and nowhere else", () => {
    const cards = run.bridge.voiceCards();
    expect(cards).toHaveLength(1);
    expect(cards[0]!.thread_id).toBe("artifact:thread-family");
    expect(cards[0]!.literal_transcript).toBe("Make the kheer. Your grandfather always added cardamom last.");
    expect(cards[0]!.provenance_rows).toEqual([
      "Source: live call",
      "Edited: 3 pauses trimmed, 0 words generated",
      "Approved by Mom's voice",
    ]);
  });

  it("builds the caregiver receipt with three observable outcomes and no score", () => {
    const receipt = run.recording.caregiver_receipt!;
    expect(receipt.lines.map((l) => `${l.dimension}: ${l.text}`)).toEqual([
      "social: Mom answered Anika directly.",
      "emotional: One re-anchor, no correction or distress escalation.",
      "intellectual: She chose and added original family knowledge.",
    ]);
    expect(receipt.lines.every((l) => l.citations.length > 0)).toBe(true);
    expect(receipt.artifact_metrics).toEqual({ her_words_pct: 100, generated_first_person_words: 0, silence_trims: 3 });
    expect(receipt.scaffolds_logged).toBe(1);
    expect(receipt.family_notice).toBeNull();
  });

  it("never calls a tool before the step it depends on, and uses all twelve", () => {
    // Recall speaks first, so the brief is rendered before any reply can be assessed: the enforced
    // sequence is a dependency order, not a first-appearance order. Each tool's prerequisite is
    // the step that must already have succeeded for the call to be legitimate.
    const REQUIRES: Partial<Record<ToolName, ToolName>> = {
      resolve_identity_and_relationships: "inspect_request",
      get_access_policy: "resolve_identity_and_relationships",
      query_context_graph: "get_access_policy",
      verify_claim_support: "query_context_graph",
      render_prompt: "verify_claim_support",
      assess_conversation_state: "render_prompt",
      select_scaffold: "assess_conversation_state",
      capture_exact_contribution: "assess_conversation_state",
      request_assent: "capture_exact_contribution",
      publish_contribution: "request_assent",
      build_caregiver_receipt: "publish_contribution",
    };
    const done = new Set<ToolName>();
    for (const call of run.runtime.log) {
      const needs = REQUIRES[call.tool];
      if (needs) expect(done.has(needs), `${call.tool} (call ${call.seq}) ran before ${needs}`).toBe(true);
      done.add(call.tool);
    }
    expect([...done].sort()).toEqual([...ENFORCED_SEQUENCE].sort());
    expect(run.runtime.log.at(-1)!.tool).toBe("build_caregiver_receipt");
    for (const call of run.runtime.log) {
      expect(call.error).toBeNull();
      expect(call.output).not.toBeNull();
      expect(call.latency_ms).toBeGreaterThan(0);
    }
    const publish = run.runtime.log.find((c) => c.tool === "publish_contribution")!;
    expect(publish.state_transition).toEqual({ from: "assented", to: "delivered" });
    expect(publish.policy_decision).toBe("token_valid");
  });

  it("keeps accessibility telemetry only: latency, thread-loss events, which scaffold fired", () => {
    expect(Object.keys(run.ctx.session.telemetry).sort()).toEqual(["response_latencies_ms", "scaffolds_fired", "thread_loss_events"]);
    expect(run.ctx.session.telemetry.thread_loss_events).toBe(1);
    expect(run.ctx.session.telemetry.scaffolds_fired).toEqual(["restate_options"]);
  });
});
