/**
 * A session recording: everything one run produced, in a form that can be
 * stored, sent to the browser, and scrubbed through.
 *
 * The orchestrator runs a whole session in one go. The live session view needs
 * to show it unfolding against the call audio. Because the reducer is pure and
 * the trace carries every event's payload and timestamp, "the state at time t"
 * is simply the trace re-reduced up to t - so the view can never show a state
 * the machine was not actually in.
 */
import type { PostedMessage } from "@/lib/bridge/thread-bridge";
import type { GraphStore } from "@/lib/graph/store";
import { buildProvLog, buildProvenanceReceipt, type ProvenanceReceipt } from "@/lib/provenance/receipt";
import type { SealedProvLog } from "@/lib/provenance/prov-log";
import type { RelayState } from "@/lib/state/machine";
import { replay, type MachineState, type TraceEntry } from "@/lib/state/reducer";
import type { SessionRecord, ToolCallRecord, ToolOutput } from "@/lib/tools";

/** The ask in display terms. Names and labels come from the graph; nothing here is inferred. */
export interface AskSummary {
  ask_id: string;
  forward_id: string;
  thread_id: string;
  text: string;
  asker: { id: string; name: string };
  person: { id: string; name: string };
  /** "Diwali dessert": the occasion and subject the brief cites, or null when the ask named neither. */
  about: string | null;
  options: Array<{ topic_id: string; label: string }>;
  photos: Array<{ artifact_id: string; asset_id: string | null; alt: string | null }>;
  audience: string;
}

export interface SessionRecording {
  session_id: string;
  thread_id: string;
  started_at: string;
  ended_at: string;
  final_state: RelayState;
  ask: AskSummary | null;
  /** Present once the call was placed. `connected_at` anchors call-relative audio time to the trace's clock. */
  call: { asset_id: string; connected_at: string } | null;
  trace: TraceEntry[];
  tool_log: ToolCallRecord[];
  spoken: SessionRecord["spoken"];
  prompts: SessionRecord["prompts"];
  /** Everything that reached the family, in order: the voice card, a notice, the support receipt. */
  messages: PostedMessage[];
  /** Anything that should have reached them and did not, because a live transport failed. Empty on the judged path. */
  delivery_failures: string[];
  caregiver_receipt: ToolOutput<"build_caregiver_receipt"> | null;
  provenance_receipt: ProvenanceReceipt | null;
  prov: SealedProvLog;
}

async function summarizeAsk(session: SessionRecord, graph: GraphStore): Promise<AskSummary | null> {
  const ask = session.ask;
  if (!ask) return null;
  const label = async (id: string): Promise<string> => (await graph.getNode(id))?.label ?? id;
  const subjects = ask.topic_ids.filter((t) => !ask.option_topic_ids.includes(t));
  const aboutParts = await Promise.all([...ask.event_ids, ...subjects].map(label));
  return {
    ask_id: ask.ask_id,
    forward_id: ask.forward_id,
    thread_id: ask.thread_id,
    text: ask.text,
    asker: { id: ask.asker_id, name: await label(ask.asker_id) },
    person: { id: ask.addressee_id, name: await label(ask.addressee_id) },
    about: aboutParts.length > 0 ? aboutParts.join(" ") : null,
    options: await Promise.all(ask.option_topic_ids.map(async (topic_id) => ({ topic_id, label: await label(topic_id) }))),
    photos: ask.artifacts.filter((a) => a.kind === "photo").map(({ artifact_id, asset_id, alt }) => ({ artifact_id, asset_id, alt })),
    audience: ask.requested_audience,
  };
}

export async function buildRecording(input: {
  thread_id: string;
  started_at: string;
  ended_at: string;
  machine: MachineState;
  session: SessionRecord;
  tool_log: readonly ToolCallRecord[];
  messages: PostedMessage[];
  receipt: ToolOutput<"build_caregiver_receipt"> | null;
  graph: GraphStore;
}): Promise<SessionRecording> {
  const { machine, session } = input;
  const sealed = await buildProvLog(session, input.tool_log).seal();
  const connected = machine.trace.find((t) => t.accepted && t.event === "CALL_CONNECTED");
  const cards = input.messages.flatMap((m) => (m.kind === "voice_contribution" ? [m.card] : []));
  return {
    session_id: session.session_id,
    thread_id: input.thread_id,
    started_at: input.started_at,
    ended_at: input.ended_at,
    final_state: machine.state,
    ask: await summarizeAsk(session, input.graph),
    call: connected && session.call_asset_id ? { asset_id: session.call_asset_id, connected_at: connected.at } : null,
    trace: machine.trace,
    tool_log: [...input.tool_log],
    spoken: session.spoken,
    prompts: session.prompts,
    messages: input.messages,
    delivery_failures: session.delivery_failures,
    caregiver_receipt: input.receipt,
    provenance_receipt: buildProvenanceReceipt(session, cards, sealed),
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
