/**
 * The provenance receipt (the 82-90s beat) and the PROV-style log behind it,
 * both derived from a finished run. Nothing here is authored: every field is
 * read from the session, the tool log, or the asset manifest.
 *
 *   original waveform, literal transcript, source links, silence trims,
 *   0 generated first-person words, assent audio + timestamp + content hash,
 *   delivered only to the original thread.
 */
import { RELAY_AGENT_ID, type MediaSpan } from "@/lib/graph/types";
import type { SessionRecord, ToolCallRecord, VoiceCard } from "@/lib/tools";
import { ProvLog, type SealedProvLog } from "./prov-log";

export const THESIS_LINE = "Access changed. Authorship didn't.";

export interface ProvenanceReceipt {
  session_id: string;
  waveform: { asset_id: string; sha256: string; kept: MediaSpan[] };
  literal_transcript: string;
  source_links: string[];
  edits: { silence_trims: number; disfluency_trims: number; generated_first_person_words: 0 };
  her_words_pct: 100;
  assent: { assent_id: string; recorded_at: string; audio_span: MediaSpan | null; audio_sha256: string; assent_hash: string };
  content_hash: string;
  delivered_to: string[];
  delivered_at: string;
  scaffolds_logged: number;
  prov_head: string;
  final_line: typeof THESIS_LINE;
}

/** PROV-style log of a run: who did what, using which evidence, producing which artifact. */
export function buildProvLog(session: SessionRecord, toolLog: readonly ToolCallRecord[]): ProvLog {
  const log = new ProvLog();
  const ask = session.ask;
  const start = toolLog[0]?.started_at ?? "";
  log.agent(RELAY_AGENT_ID, "software", start, { label: "Relay" });
  if (!ask) return log;

  log.agent(ask.asker_id, "person", start);
  log.agent(ask.addressee_id, "person", start);
  log.entity(ask.ask_id, "relay:CurrentAsk", ask.received_at, { thread_id: ask.thread_id });
  log.relate("wasAttributedTo", ask.ask_id, ask.asker_id, ask.received_at);

  for (const call of toolLog) {
    const id = `activity:${call.seq}:${call.tool}`;
    log.activity(id, `relay:${call.tool}`, call.started_at, {
      latency_ms: call.latency_ms,
      policy_decision: call.policy_decision,
      error: call.error?.name ?? null,
    });
    log.relate("wasAssociatedWith", id, RELAY_AGENT_ID, call.started_at);
    for (const source of call.source_ids) log.relate("used", id, source, call.started_at);
  }
  const activityFor = (tool: string): string | null => {
    const call = [...toolLog].reverse().find((c) => c.tool === tool && c.error === null);
    return call ? `activity:${call.seq}:${call.tool}` : null;
  };

  const c = session.contribution;
  if (c) {
    const at = toolLog.find((t) => t.tool === "capture_exact_contribution")?.started_at ?? start;
    const recording = `asset:${c.source.asset_id}`;
    log.entity(recording, "relay:CallRecording", at, { sha256: c.source.sha256 });
    log.entity(c.contribution_id, "relay:Contribution", at, { content_hash: c.content_hash, generated_first_person_words: 0 });
    log.relate("wasAttributedTo", c.contribution_id, c.speaker_id, at);
    log.relate("wasDerivedFrom", c.contribution_id, recording, at);
    const capture = activityFor("capture_exact_contribution");
    if (capture) log.relate("wasGeneratedBy", c.contribution_id, capture, at);
  }
  const a = session.assent;
  if (a && c) {
    log.entity(a.assent_id, "relay:Assent", a.recorded_at, { decision: a.decision, assent_hash: a.assent_hash });
    log.relate("wasAttributedTo", a.assent_id, c.speaker_id, a.recorded_at);
    log.relate("wasInformedBy", a.assent_id, c.contribution_id, a.recorded_at);
  }
  const d = session.delivery;
  if (d && c && a) {
    log.entity(d.delivery_id, "relay:Delivery", d.delivered_at, { delivered_to: d.delivered_to });
    log.relate("wasDerivedFrom", d.delivery_id, c.contribution_id, d.delivered_at);
    log.relate("used", d.delivery_id, a.assent_id, d.delivered_at);
    const publish = activityFor("publish_contribution");
    if (publish) log.relate("wasGeneratedBy", d.delivery_id, publish, d.delivered_at);
  }
  return log;
}

/** Null unless something was actually delivered: there is no receipt for a contribution that never sent. */
export function buildProvenanceReceipt(
  session: SessionRecord,
  delivered: readonly VoiceCard[],
  sealed: SealedProvLog,
): ProvenanceReceipt | null {
  const { contribution: c, assent: a, delivery: d } = session;
  if (!c || !a || !d || a.decision !== "yes") return null;
  const verified = session.candidates.flatMap((cand) => cand.citations.map((cite) => cite.source_id));
  return {
    session_id: session.session_id,
    waveform: { asset_id: c.source.asset_id, sha256: c.source.sha256, kept: c.kept },
    literal_transcript: c.literal_transcript,
    source_links: [...new Set([`asset:${c.source.asset_id}`, ...verified])].sort(),
    edits: { silence_trims: c.silence_trims, disfluency_trims: c.disfluency_trims, generated_first_person_words: 0 },
    her_words_pct: 100,
    assent: {
      assent_id: a.assent_id,
      recorded_at: a.recorded_at,
      audio_span: a.audio.span,
      audio_sha256: a.audio.media_hash,
      assent_hash: a.assent_hash,
    },
    content_hash: c.content_hash,
    delivered_to: delivered.map((card) => card.thread_id),
    delivered_at: d.delivered_at,
    scaffolds_logged: session.telemetry.scaffolds_fired.length,
    prov_head: sealed.head,
    final_line: THESIS_LINE,
  };
}
