/**
 * View selectors for the judged sandbox. Pure functions of a recording and a
 * moment in time; the panes render what these return and decide nothing
 * themselves.
 *
 *   gates             what had to pass before and during the call
 *   live session      call stage, one cue card at a time, human-readable trace
 *   receipt           the per-session receipt and the provenance receipt
 *
 * What these never return: model confidence, a clinical label, a score, or any
 * analytic about her (AGENTS.md section 10, information hierarchy). The fields
 * do not exist, so a pane cannot show them. None of this is a family surface:
 * the family side reads through lib/family/projection only.
 */
import type { ProvenanceReceipt } from "@/lib/provenance/receipt";
import { CALL_PHASE, type CallPhase, type RecallState } from "@/lib/state/machine";
import type { ToolName, ToolOutput } from "@/lib/tools";
import { stateAt, type SessionRecording } from "./recording";

// --- gates ----------------------------------------------------------------------

export type GateStatus = "pending" | "passed" | "stopped";
export interface GateView {
  gate: "call_policy" | "evidence" | "store_confirmation" | "share_confirmation";
  label: string;
  status: GateStatus;
}

const GATE_TOOLS: Array<{ gate: GateView["gate"]; label: string; tool: ToolName; passed: (output: unknown) => boolean }> = [
  { gate: "call_policy", label: "Within what she and her family agreed", tool: "place_recall_call", passed: (o) => (o as { decision: string }).decision === "granted" },
  { gate: "evidence", label: "Only permitted, current evidence", tool: "verify_claim_support", passed: () => true },
  { gate: "store_confirmation", label: "She said to remember it, in her own voice", tool: "confirm_and_store", passed: (o) => (o as { step: string; decision?: string }).step === "commit" || (o as { decision?: string }).decision === "yes" },
  { gate: "share_confirmation", label: "She chose whether to share it", tool: "confirm_share", passed: () => true },
];

export function gatesView(recording: SessionRecording, atIso?: string): GateView[] {
  const seen = recording.tool_log.filter((c) => atIso === undefined || c.started_at <= atIso);
  return GATE_TOOLS.map(({ gate, label, tool, passed }): GateView => {
    const call = [...seen].reverse().find((c) => c.tool === tool);
    if (!call) return { gate, label, status: "pending" };
    return { gate, label, status: call.error === null && passed(call.output) ? "passed" : "stopped" };
  });
}

// --- live session view ------------------------------------------------------------

export interface TraceCard {
  seq: number;
  at: string;
  /** Human-readable: "Topic selected", "Cue given", "Recalled", "Remembered - added to the graph". */
  label: string;
  /** Small monospace label for judges. Null when no tool caused the transition. */
  tool: ToolName | null;
  citations: string[];
}

/** One cue card at a time, matching the active ladder rung. Never a carousel (section 10, accessibility). */
export interface CueCard {
  rung: number;
  script_id: string;
  text: string;
  /** What the card may show beside the words: the cited facts, by id. */
  citations: string[];
}

export interface LiveSessionView {
  state: RecallState;
  call_phase: CallPhase | null;
  /** Recall's status in plain speech, for the call stage. Null when Recall is the one talking or the call is over. */
  status_line: string | null;
  /** "With Susan now" and the one familiar topic, named at all times. */
  headline: { topic: string; spoken_as: string } | null;
  recall_said: { script_id: string; text: string } | null;
  cue: CueCard | null;
  trace_cards: TraceCard[];
}

const STATUS_LINE: Partial<Record<RecallState, string>> = {
  asking: "I'm listening",
  reanchored: "I'm listening",
  recalled: "I'm listening",
  lost: "Let's make this easier",
  confirming: "Want me to remember that?",
  confirmed: "Would you like me to share it?",
};

export function liveSessionView(recording: SessionRecording, atIso?: string): LiveSessionView {
  const machine = stateAt(recording, atIso);
  const spoken = recording.spoken.filter((s) => atIso === undefined || s.at <= atIso);
  const said = spoken.at(-1) ?? null;
  const lastRung = spoken.filter((s) => s.rung !== null).at(-1) ?? null;
  const inCall = CALL_PHASE[machine.state] !== undefined;
  const toolBySeq = new Map(recording.tool_log.map((c) => [c.seq, c.tool]));
  const citationsOf = (promptId: string): string[] => [...new Set(recording.prompts.find((p) => p.prompt_id === promptId)?.segments.flatMap((s) => s.citation_ids) ?? [])];
  return {
    state: machine.state,
    call_phase: CALL_PHASE[machine.state] ?? null,
    status_line: STATUS_LINE[machine.state] ?? null,
    headline: recording.topic && machine.state !== "idle" ? { topic: recording.topic.label, spoken_as: recording.topic.spoken_as } : null,
    recall_said: said ? { script_id: said.script_id, text: said.text } : null,
    // A cue belongs to the call. Once it ends, the stage clears rather than leaving the last card up.
    cue: lastRung && inCall ? { rung: lastRung.rung!, script_id: lastRung.script_id, text: lastRung.text, citations: citationsOf(lastRung.prompt_id) } : null,
    trace_cards: machine.trace
      .filter((t) => t.accepted)
      .map((t) => ({ seq: t.seq, at: t.at, label: t.label, tool: t.tool_call_seq ? (toolBySeq.get(t.tool_call_seq) ?? null) : null, citations: t.citations })),
  };
}

// --- receipt and provenance ---------------------------------------------------------

export interface ReceiptView {
  outcome: RecallState;
  /** The contribution card: her words, exactly, once she confirmed them. Null when nothing was stored. */
  contribution: { speaker_id: string; literal_transcript: string; provenance_rows: string[] } | null;
  /** One session, observable facts only. */
  support: ToolOutput<"build_caregiver_receipt"> | null;
  provenance: ProvenanceReceipt | null;
}

export function receiptView(recording: SessionRecording): ReceiptView {
  const p = recording.provenance_receipt;
  const c = recording.contribution;
  const pauses = p ? (p.edits.silence_trims === 1 ? "1 pause" : `${p.edits.silence_trims} pauses`) : "";
  return {
    outcome: recording.final_state,
    contribution:
      p && c
        ? {
            speaker_id: c.speaker_id,
            literal_transcript: c.literal_transcript,
            provenance_rows: ["Source: live call", `Edited: ${pauses} trimmed, ${p.edits.generated_first_person_words} words generated`, "Confirmed by her voice", ...(p.shared ? ["Share confirmed by her voice"] : [])],
          }
        : null,
    support: recording.caregiver_receipt,
    provenance: p,
  };
}
