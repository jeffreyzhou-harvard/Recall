/**
 * The provenance receipt (the 77-90s beat) and the PROV-style log behind it,
 * both derived from a finished run. Nothing here is authored: every field is
 * read from the session, the tool log, or the asset manifest.
 *
 *   original waveform, literal transcript, silence trims, 0 generated
 *   first-person words, store-confirmation and share-confirmation timestamps,
 *   content hash, and the retrieval-layer update.
 */
import { RECALL_AGENT_ID, type MediaSpan } from "@/lib/graph/types";
import type { SessionRecord, ToolCallRecord } from "@/lib/tools";
import { ProvLog, type SealedProvLog } from "./prov-log";

export const THESIS_LINE = "Cues, not answers - every memory stays in her own words.";

export interface ProvenanceReceipt {
  session_id: string;
  waveform: { asset_id: string; sha256: string; kept: MediaSpan[] };
  literal_transcript: string;
  source_links: string[];
  edits: { silence_trims: number; disfluency_trims: number; generated_first_person_words: 0 };
  her_words_pct: 100;
  store_confirmation: { confirmation_id: string; recorded_at: string; audio_span: MediaSpan | null; audio_sha256: string; confirmation_hash: string };
  share_confirmation: { confirmation_id: string; decision: "yes" | "no" | "unclear" | "timeout"; recorded_at: string; confirmation_hash: string };
  content_hash: string;
  claim_id: string;
  stored_at: string;
  shared: boolean;
  rungs_used: number;
  /** "Maya logged as an effective cue for Cape May summers." One per cue offered. What Recall logged; never a statement about her. */
  retrieval_updates: Array<{ topic_label: string; cue_id: string; rung: number; effective: boolean }>;
  prov_head: string;
  final_line: typeof THESIS_LINE;
}

/** PROV-style log of a run: who did what, using which evidence, producing which artifact. */
export function buildProvLog(session: SessionRecord, toolLog: readonly ToolCallRecord[], personId: string): ProvLog {
  const log = new ProvLog();
  const start = toolLog[0]?.started_at ?? "";
  log.agent(RECALL_AGENT_ID, "software", start, { label: "Recall" });
  if (!session.topic) return log;
  log.agent(personId, "person", start);

  for (const call of toolLog) {
    const id = `activity:${call.seq}:${call.tool}`;
    log.activity(id, `recall:${call.tool}`, call.started_at, { latency_ms: call.latency_ms, policy_decision: call.policy_decision, error: call.error?.name ?? null });
    log.relate("wasAssociatedWith", id, RECALL_AGENT_ID, call.started_at);
    for (const source of call.source_ids) log.relate("used", id, source, call.started_at);
  }
  const activityFor = (tool: string): string | null => {
    const call = [...toolLog].reverse().find((c) => c.tool === tool && c.error === null);
    return call ? `activity:${call.seq}:${call.tool}` : null;
  };

  const c = session.contribution;
  const stored = session.stored;
  if (!c || !stored) return log;
  // Her words are attributed to her, and to nobody and nothing else (rule 1).
  log.entity(c.contribution_id, "recall:Contribution", stored.stored_at, { content_hash: c.content_hash, generated_first_person_words: 0 });
  log.relate("wasAttributedTo", c.contribution_id, c.speaker_id, stored.stored_at);
  log.relate("wasDerivedFrom", c.contribution_id, `asset:${c.source.asset_id}`, stored.stored_at);
  const capture = activityFor("capture_contribution");
  if (capture) log.relate("wasGeneratedBy", c.contribution_id, capture, stored.stored_at);

  const store = session.store_confirmation;
  if (store) {
    log.entity(store.confirmation_id, "recall:StoreConfirmation", store.recorded_at, { decision: store.decision, confirmation_hash: store.confirmation_hash });
    log.relate("wasAttributedTo", store.confirmation_id, c.speaker_id, store.recorded_at);
    log.relate("wasInformedBy", store.confirmation_id, c.contribution_id, store.recorded_at);
  }
  const share = session.share_confirmation;
  if (share) {
    log.entity(share.share_confirmation_id, "recall:ShareConfirmation", share.recorded_at, { decision: share.decision, confirmation_hash: share.confirmation_hash });
    log.relate("wasAttributedTo", share.share_confirmation_id, c.speaker_id, share.recorded_at);
    log.relate("wasInformedBy", share.share_confirmation_id, c.contribution_id, share.recorded_at);
  }
  log.entity(stored.claim_id, "recall:EpisodicClaim", stored.stored_at, { shared: stored.shared });
  log.relate("wasDerivedFrom", stored.claim_id, c.contribution_id, stored.stored_at);
  log.relate("wasAttributedTo", stored.claim_id, c.speaker_id, stored.stored_at);
  const commit = activityFor("confirm_and_store");
  if (commit) log.relate("wasGeneratedBy", stored.claim_id, commit, stored.stored_at);
  if (store) log.relate("used", commit ?? stored.claim_id, store.confirmation_id, stored.stored_at);
  return log;
}

/** Null unless something was actually stored: there is no receipt for a contribution she did not confirm. */
export function buildProvenanceReceipt(
  session: SessionRecord,
  retrievalUpdates: ProvenanceReceipt["retrieval_updates"],
  sealed: SealedProvLog,
): ProvenanceReceipt | null {
  const { contribution: c, store_confirmation: store, share_confirmation: share, stored } = session;
  if (!c || !store || !share || !stored || store.decision !== "yes") return null;
  const verified = session.candidates.flatMap((cand) => cand.citations.map((cite) => cite.source_id));
  return {
    session_id: session.session_id,
    waveform: { asset_id: c.source.asset_id, sha256: c.source.sha256, kept: c.kept },
    literal_transcript: c.literal_transcript,
    source_links: [...new Set([`asset:${c.source.asset_id}`, ...verified])].sort(),
    edits: { silence_trims: c.silence_trims, disfluency_trims: c.disfluency_trims, generated_first_person_words: 0 },
    her_words_pct: 100,
    store_confirmation: { confirmation_id: store.confirmation_id, recorded_at: store.recorded_at, audio_span: store.audio.span, audio_sha256: store.audio.media_hash, confirmation_hash: store.confirmation_hash },
    share_confirmation: { confirmation_id: share.share_confirmation_id, decision: share.decision, recorded_at: share.recorded_at, confirmation_hash: share.confirmation_hash },
    content_hash: c.content_hash,
    claim_id: stored.claim_id,
    stored_at: stored.stored_at,
    shared: stored.shared,
    rungs_used: session.telemetry.rungs_fired.length,
    retrieval_updates: retrievalUpdates,
    prov_head: sealed.head,
    final_line: THESIS_LINE,
  };
}
