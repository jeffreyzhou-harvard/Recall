/**
 * A session recording: everything one recall call produced, in a form that can
 * be stored, sent to the browser, and scrubbed through.
 *
 * The orchestrator runs a whole session in one go. The live session view needs
 * to show it unfolding against the call audio. Because the reducer is pure and
 * the trace carries every event's payload and timestamp, "the state at time t"
 * is simply the trace re-reduced up to t - so the view can never show a state
 * the machine was not actually in.
 *
 * This is the judge console's and the operator's record. None of it is a
 * family surface: the family side reads only through lib/family/projection.
 */
import { buildProvLog, buildProvenanceReceipt, type ProvenanceReceipt } from "@/lib/provenance/receipt";
import type { SealedProvLog } from "@/lib/provenance/prov-log";
import type { RecallState } from "@/lib/state/machine";
import { replay, type MachineState, type TraceEntry } from "@/lib/state/reducer";
import type { SessionRecord, ToolCallRecord, ToolOutput } from "@/lib/tools";

export interface SessionRecording {
  session_id: string;
  person_id: string;
  started_at: string;
  ended_at: string;
  final_state: RecallState;
  topic: SessionRecord["topic"];
  /** Present once she answered. `connected_at` anchors call-relative audio time to the trace's clock. */
  call: { asset_id: string; connected_at: string } | null;
  trace: TraceEntry[];
  tool_log: ToolCallRecord[];
  spoken: SessionRecord["spoken"];
  prompts: SessionRecord["prompts"];
  /** The contribution she confirmed, or null. Unconfirmed contributions are dropped at call end and never appear here. */
  contribution: SessionRecord["contribution"];
  /** Category only, if the safety handoff fired (rule 8). */
  safety_category: string | null;
  unconfirmed_audio_discarded: boolean;
  caregiver_receipt: ToolOutput<"build_caregiver_receipt"> | null;
  provenance_receipt: ProvenanceReceipt | null;
  prov: SealedProvLog;
}

export async function buildRecording(input: {
  person_id: string;
  started_at: string;
  ended_at: string;
  machine: MachineState;
  session: SessionRecord;
  tool_log: readonly ToolCallRecord[];
  receipt: ToolOutput<"build_caregiver_receipt"> | null;
}): Promise<SessionRecording> {
  const { machine, session } = input;
  const sealed = await buildProvLog(session, input.tool_log, input.person_id).seal();
  const connected = machine.trace.find((t) => t.accepted && t.event === "CALL_CONNECTED");
  const c = machine.context;
  const updates = c.rungs_fired.length > 0 && machine.state !== "stopped" && machine.state !== "safety_handoff" ? c.cues_offered.map((cue) => ({ topic_label: c.topic_label ?? "", cue_id: cue.cue_id, rung: cue.rung, effective: c.reached_at_rung === cue.rung })) : [];
  return {
    session_id: session.session_id,
    person_id: input.person_id,
    started_at: input.started_at,
    ended_at: input.ended_at,
    final_state: machine.state,
    topic: session.topic,
    call: connected && session.call_asset_id ? { asset_id: session.call_asset_id, connected_at: connected.at } : null,
    trace: machine.trace,
    tool_log: [...input.tool_log],
    spoken: session.spoken,
    prompts: session.prompts,
    contribution: session.contribution,
    safety_category: session.safety_category,
    unconfirmed_audio_discarded: session.unconfirmed_audio_discarded,
    caregiver_receipt: input.receipt,
    provenance_receipt: buildProvenanceReceipt(session, updates, sealed),
    prov: sealed,
  };
}

/** The machine as it stood at a moment in the recording. Omit `atIso` for the final state. */
export const stateAt = (recording: SessionRecording, atIso?: string): MachineState => replay(recording.trace, atIso);

/** Convert a position in the call audio to the trace's clock, for scrubbing the view against the waveform. */
export function callTimeToIso(recording: SessionRecording, callMs: number): string | null {
  if (!recording.call) return null;
  return new Date(Date.parse(recording.call.connected_at) + callMs).toISOString();
}
