/**
 * View selectors for the Relay web experience. Pure functions of a recording
 * and a moment in time; the panes render what these return and decide nothing
 * themselves.
 *
 * Three surfaces (product flow spec):
 *   request intake        current ask, audience, artifacts, and the gates
 *   live session view     call stage, one cue at a time, human-readable trace
 *   receipt & provenance  source, trims, assent, destination
 *
 * What these never return: model confidence, a clinical label, a score, or any
 * analytic about her (AGENTS.md section 10, information hierarchy). The fields
 * do not exist, so a pane cannot show them.
 */
import type { PostedMessage } from "@/lib/bridge/thread-bridge";
import type { ProvenanceReceipt } from "@/lib/provenance/receipt";
import { CALL_PHASE, type CallPhase, type RelayState } from "@/lib/state/machine";
import type { PromptKind, ToolName, ToolOutput } from "@/lib/tools";
import { stateAt, type AskSummary, type SessionRecording } from "./recording";

// --- request intake -----------------------------------------------------------

export type GateStatus = "pending" | "passed" | "stopped";
export interface GateView {
  gate: "identity_and_audience" | "access_policy" | "evidence" | "assent";
  label: string;
  status: GateStatus;
}

export interface IntakeView {
  ask: AskSummary | null;
  gates: GateView[];
}

const GATE_TOOLS: Array<{ gate: GateView["gate"]; label: string; tool: ToolName; passed: (output: unknown) => boolean }> = [
  { gate: "identity_and_audience", label: "People and audience verified", tool: "resolve_identity_and_relationships", passed: (o) => (o as { verified: boolean }).verified },
  { gate: "access_policy", label: "Family's policy permits this ask", tool: "get_access_policy", passed: (o) => (o as { decision: string }).decision === "granted" },
  { gate: "evidence", label: "Only permitted, current evidence", tool: "verify_claim_support", passed: () => true },
  { gate: "assent", label: "Approved in her own voice", tool: "request_assent", passed: (o) => (o as { decision: string }).decision === "yes" },
];

export function intakeView(recording: SessionRecording, atIso?: string): IntakeView {
  const seen = recording.tool_log.filter((c) => atIso === undefined || c.started_at <= atIso);
  const gates = GATE_TOOLS.map(({ gate, label, tool, passed }): GateView => {
    const call = [...seen].reverse().find((c) => c.tool === tool);
    if (!call) return { gate, label, status: "pending" };
    return { gate, label, status: call.error === null && passed(call.output) ? "passed" : "stopped" };
  });
  return { ask: seen.some((c) => c.tool === "inspect_request" && c.error === null) ? recording.ask : null, gates };
}

// --- live session view ----------------------------------------------------------

/** One cue at a time, never a carousel (AGENTS.md section 10, accessibility). */
export type Cue =
  | { kind: "photo"; photos: AskSummary["photos"] }
  | { kind: "asker"; asker: AskSummary["asker"] }
  | { kind: "choices"; options: AskSummary["options"]; photos: AskSummary["photos"] }
  | { kind: "her_own_clip"; play_original: NonNullable<ToolOutput<"render_prompt">["play_original"]> }
  | { kind: "approval"; asker: AskSummary["asker"] };

export interface TraceCard {
  seq: number;
  at: string;
  /** Human-readable: "Ask verified", "Thread unclear", "Re-anchored", "Voice approval received". */
  label: string;
  /** Small monospace label for judges. Null when no tool caused the transition. */
  tool: ToolName | null;
  citations: string[];
}

export interface LiveSessionView {
  state: RelayState;
  call_phase: CallPhase | null;
  /** Relay's status in plain speech, for the call stage. Null when Relay is the one talking or the call is over. */
  status_line: string | null;
  /** "With Mom now" / "Anika is asking about Diwali dessert" - the one familiar person, named at all times. */
  headline: { person: string; asker: string; about: string | null } | null;
  /** What Relay most recently said, if anything. */
  relay_said: { kind: PromptKind; text: string } | null;
  cue: Cue | null;
  trace_cards: TraceCard[];
}

const STATUS_LINE: Partial<Record<RelayState, string>> = {
  following: "I'm listening",
  reanchored: "I'm listening",
  lost: "Let's make this easier",
  contributed: "Would you like me to share that?",
  playback: "Would you like me to share that?",
};

function cueFor(kind: PromptKind, recording: SessionRecording, promptId: string): Cue | null {
  const ask = recording.ask;
  if (!ask) return null;
  switch (kind) {
    case "brief":
    case "repeat":
      return ask.photos.length > 0 ? { kind: "photo", photos: ask.photos } : null;
    case "name_asker":
      return { kind: "asker", asker: ask.asker };
    case "restate_options":
      return { kind: "choices", options: ask.options, photos: ask.photos };
    case "source_backed_cue": {
      const clip = recording.prompts.find((p) => p.prompt_id === promptId)?.play_original;
      return clip ? { kind: "her_own_clip", play_original: clip } : null;
    }
    case "confirm_send":
      return { kind: "approval", asker: ask.asker };
    default:
      return null;
  }
}

export function liveSessionView(recording: SessionRecording, atIso?: string): LiveSessionView {
  const machine = stateAt(recording, atIso);
  const said = recording.spoken.filter((s) => atIso === undefined || s.at <= atIso).at(-1) ?? null;
  const inCall = CALL_PHASE[machine.state] !== undefined;
  const toolBySeq = new Map(recording.tool_log.map((c) => [c.seq, c.tool]));
  return {
    state: machine.state,
    call_phase: CALL_PHASE[machine.state] ?? null,
    status_line: STATUS_LINE[machine.state] ?? null,
    headline: recording.ask ? { person: recording.ask.person.name, asker: recording.ask.asker.name, about: recording.ask.about } : null,
    relay_said: said ? { kind: said.kind, text: said.text } : null,
    // A cue belongs to the call. Once it ends, the stage clears rather than leaving the last card up.
    cue: said && inCall ? cueFor(said.kind, recording, said.prompt_id) : null,
    trace_cards: machine.trace
      .filter((t) => t.accepted)
      .map((t) => ({ seq: t.seq, at: t.at, label: t.label, tool: t.tool_call_seq ? (toolBySeq.get(t.tool_call_seq) ?? null) : null, citations: t.citations })),
  };
}

// --- receipt and provenance -------------------------------------------------------

export interface ReceiptView {
  outcome: RelayState;
  /** The voice card, exactly as it landed in the family's thread. Null when nothing was delivered. */
  delivered: Extract<PostedMessage, { kind: "voice_contribution" }> | null;
  /** The fixed notice the thread got instead, when nothing was delivered. */
  family_notice: Extract<PostedMessage, { kind: "family_notice" }> | null;
  /** Who was sent the non-clinical support receipt. */
  support_receipt_sent_to: string[];
  support: ToolOutput<"build_caregiver_receipt"> | null;
  provenance: ProvenanceReceipt | null;
}

export function receiptView(recording: SessionRecording): ReceiptView {
  const of = <K extends PostedMessage["kind"]>(kind: K) =>
    recording.messages.filter((m): m is Extract<PostedMessage, { kind: K }> => m.kind === kind);
  return {
    outcome: recording.final_state,
    delivered: of("voice_contribution")[0] ?? null,
    family_notice: of("family_notice")[0] ?? null,
    support_receipt_sent_to: of("support_receipt").map((m) => m.to.person_id),
    support: recording.caregiver_receipt,
    provenance: recording.provenance_receipt,
  };
}
