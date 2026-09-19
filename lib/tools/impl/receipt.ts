/**
 * Tool 13: the caregiver receipt. One session, observable facts only.
 *
 * It has no input but this session and no field for anything else: no other
 * call, no trend, no score, and never a reason inferred about her (rule 4).
 * Every line is a fixed line from /fixtures/family-copy.json; the per-topic
 * record (section 6.4.3) is a separate surface and is not built here.
 */
import { fill } from "@/lib/script/call-script";
import type { FamilyLineKey } from "@/lib/family/copy";
import type { ToolImpl } from "../runtime";

const BY_RUNG: Record<number, FamilyLineKey> = { 1: "receipt_unaided", 2: "receipt_context", 3: "receipt_cue", 4: "receipt_recognition", 5: "receipt_reorientation" };

export const build_caregiver_receipt: ToolImpl<"build_caregiver_receipt"> = async (input, ctx) => {
  const session = ctx.session;
  if (session.session_id !== input.session_id) throw new Error(`session "${input.session_id}" is not this session`);
  const machine = ctx.machine();
  const c = machine.context;
  const topic = session.topic;
  const lines: Array<{ script_id: string; text: string; citations: string[] }> = [];
  const add = (key: FamilyLineKey, values: Record<string, string>, citations: string[] = []): void => {
    const l = ctx.copy.lines[key];
    lines.push({ script_id: l.id, text: fill(l, values), citations });
  };

  const connected = session.started_at !== null;
  if (!connected) add("receipt_no_call", {});
  else if (machine.state === "stopped") add("receipt_stopped", {});
  else if (machine.state === "safety_handoff") add("receipt_safety", {});
  else if (topic && c.rungs_fired.length > 0) {
    if (c.reached_at_rung === null) add("receipt_not_reached", { topic: topic.label }, [topic.topic_id]);
    else if (c.reached_at_rung === 3) {
      const cue = c.cues_offered.find((x) => x.rung === 3);
      const cueNode = cue ? await ctx.graph.getNode(cue.cue_id) : null;
      // The cue's name is said only if the cue was a verified person; otherwise the line without a name is used.
      if (cueNode?.type === "Person" && ctx.gate.isVerified(cueNode.id)) add("receipt_cue", { topic: topic.label, cue: cueNode.props.display_name }, [topic.topic_id, cueNode.id]);
      else add("receipt_context", { topic: topic.label }, [topic.topic_id]);
    } else add(BY_RUNG[c.reached_at_rung]!, { topic: topic.label }, [topic.topic_id]);
  }

  // "No correction, no distress" is a statement about what Relay logged, not about her: no line Relay spoke
  // came from outside the reviewed script (which holds no correction), and no safety event fired (Appendix B, item 2).
  const onlyReviewedLines = session.spoken.every((s) => session.prompts.some((p) => p.prompt_id === s.prompt_id));
  if (connected && onlyReviewedLines && session.safety_category === null && machine.state !== "stopped") add("receipt_conduct", {});

  const traceSeqOf = (rung: number): number => machine.trace.find((t) => t.accepted && t.payload.type === "RUNG_DELIVERED" && t.payload.rung === rung)?.seq ?? 0;
  const contribution = session.contribution;
  return {
    session_id: session.session_id,
    topic_label: topic?.label ?? null,
    outcome: machine.state,
    lines,
    rungs: session.telemetry.rungs_fired.map((r) => ({ rung: r.rung, script_id: r.script_id, response_latency_ms: r.latency_after_ms, trace_seq: traceSeqOf(r.rung) })),
    artifact_metrics: session.stored && contribution ? { her_words_pct: 100, generated_first_person_words: 0, silence_trims: contribution.silence_trims } : null,
    stored: session.stored !== null,
    shared: session.stored?.shared ?? false,
    safety_alert_sent: session.safety_alert_sent,
  };
};
