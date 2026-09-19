/**
 * Tools 8, 9, 10, 17: capture her exact words, get her yes to remembering that
 * exact artifact, ask whether to share it, and only then - last - commit it.
 * Then record what happened on the topic. Each step fails closed.
 */
import { edgeId } from "@/lib/graph/seed";
import { patientConfirmed, RELAY_AGENT_ID, type EdgeType, type GraphNode, type MediaSpan, type Provenance, type SourceClass } from "@/lib/graph/types";
import { AuthorshipError, generatedFirstPersonWords, herWordsPct, participantWordsIn } from "@/lib/provenance/authorship";
import { buildEdl, trimCount } from "@/lib/provenance/edl";
import { contentHash } from "@/lib/provenance/hash";
import { tokens, turnText, type AudioWindow } from "@/lib/providers/transcription";
import { firstPhraseIn } from "@/lib/script/call-script";
import type { StoreDecision } from "@/lib/state/machine";
import type { ToolOutput } from "../contracts";
import type { ToolContext } from "../context";
import { GateError } from "../gates";
import type { ToolImpl } from "../runtime";

type Contribution = ToolOutput<"capture_contribution">;

/** Exactly the fields that define the artifact. Change any of them and the hash - and so her confirmation - no longer matches. */
const hashedContent = (c: Omit<Contribution, "content_hash" | "contribution_id">): unknown => ({
  speaker_id: c.speaker_id,
  literal_transcript: c.literal_transcript,
  words: c.words,
  source: c.source,
  intervals: c.intervals,
  trims: c.trims,
  kept: c.kept,
});

export const capture_contribution: ToolImpl<"capture_contribution"> = async (input, ctx) => {
  const policy = ctx.setup.current();
  if (ctx.session.topic?.topic_id !== input.topic_id) throw new GateError("authorship", "get_next_recall_topic has not chosen this topic");
  const last = ctx.session.assessments.at(-1);
  if (!last || (last.state !== "recalled" && last.state !== "new_detail_offered")) throw new GateError("authorship", "she has not said anything about this, so there is nothing of hers to capture");

  const assetIds = [...new Set(input.audio_intervals.map((i) => i.asset_id))];
  if (assetIds.length !== 1) throw new GateError("authorship", "a contribution is drawn from one recording");
  const asset = ctx.assets.get(assetIds[0]!);
  const intervals = input.audio_intervals.map(({ start_ms, end_ms }) => ({ start_ms, end_ms }));
  for (const interval of intervals) ctx.assets.resolveSpan(asset.id, interval);

  const turns = await ctx.transcription.allTurns(asset.id);
  let words;
  try {
    // Deterministic check: any interval holding Relay's speech, or played-back audio, is rejected outright.
    words = participantWordsIn(turns, intervals);
  } catch (e) {
    if (e instanceof AuthorshipError) throw new GateError("authorship", e.message);
    throw e;
  }
  if (words.length === 0) throw new GateError("authorship", "there are no words of hers in that stretch of the call");

  const literal = words.map((w) => w.w).join(" ");
  const spoken = ` ${tokens(literal).join(" ")} `;
  if (policy.blocked_terms.some((term) => spoken.includes(` ${term.toLowerCase()} `))) throw new GateError("policy", "the reply contains content the joint setup blocked from being kept");

  const generated = generatedFirstPersonWords(words, turns);
  if (generated !== 0) throw new GateError("authorship", `${generated} word(s) are not from her recording`);

  const edl = buildEdl({ asset_id: asset.id, sha256: asset.sha256 }, intervals, words);
  const body = {
    speaker_id: policy.person_id,
    literal_transcript: literal,
    words,
    source: { asset_id: asset.id, sha256: asset.sha256 },
    intervals,
    trims: edl.trims,
    kept: edl.kept,
    silence_trims: trimCount(edl, "silence"),
    disfluency_trims: trimCount(edl, "disfluency"),
    generated_first_person_words: 0 as const,
    her_words_pct: herWordsPct(words, turns) as 100,
  };
  const hash = await contentHash(hashedContent(body));
  const contribution: Contribution = { contribution_id: `contribution:${ctx.session.session_id}`, content_hash: hash, ...body };

  ctx.gate.setPendingContribution(hash);
  ctx.session.contribution = contribution;
  ctx.session.store_confirmation = null;
  ctx.session.share_confirmation = null;
  return contribution;
};

/**
 * A yes is an allow-list, not a deny-list. No list of refusal words can be complete - "never mind", "not
 * that one", "leave it" are all ways of not saying yes - so a reply counts as yes only when EVERY word in
 * it is part of saying yes, and at least one of them actually says it. Anything else she might add, of any
 * kind, makes it not a clean yes (rule 3).
 *
 * The cost is deliberate: "yes, the one about the beach" is unclear, and nothing is kept. Relay can ask
 * again on another call; a memory stored or shared without her clear yes cannot be un-stored in her eyes.
 * English only, like the rest of the lexical rules here.
 */
const YES_WORDS = new Set(["yes", "yeah", "yep", "yup", "ok", "okay", "sure", "please", "do", "it", "that", "go", "ahead", "and", "thanks", "thank", "you", "remember", "share", "i", "would", "i'd", "like", "to"]);
const SAYS_YES = /\b(yes|yeah|yep|yup|ok|okay|sure|please do|do it|do that|go ahead)\b/;
const OPENS_WITH_YES = /^(yes|yeah|yep|yup|ok|okay|sure|please do|go ahead)\b/;
/** Used only to tell a plain "no" from an unclear reply, for the record. It can never make something a yes. */
const REFUSES = /\b(no|nope|not|don't|dont|wait|stop|never)\b/;

export function classifyYes(transcript: string): StoreDecision {
  const words = tokens(transcript);
  const said = words.join(" ");
  if (words.length > 0 && words.every((w) => YES_WORDS.has(w)) && SAYS_YES.test(said)) return "yes";
  // Neither of these stores or shares anything. A reply that opens with a yes and then adds to it is unclear, not a no.
  return REFUSES.test(said) && !OPENS_WITH_YES.test(said) ? "no" : "unclear";
}

/** Her final turn in a window, if she said anything. A partial turn is never classified. */
async function finalTurnIn(ctx: ToolContext, window: AudioWindow) {
  const turn = (await ctx.transcription.turnsIn(window)).filter((t) => t.speaker === "participant").at(-1) ?? null;
  if (turn && !turn.is_final) throw new Error(`turn "${turn.turn_id}" is not final yet; wait for endpointing before classifying`);
  return turn && turn.words.length > 0 ? turn : null;
}

const callArtifactId = (ctx: ToolContext): string => `artifact:call:${ctx.session.session_id}`;

function provFor(ctx: ToolContext, c: Contribution, author: string, span: MediaSpan | null, at: string, sourceClass: SourceClass): Provenance {
  const status = sourceClass === "recall_call" ? ("participant_confirmed" as const) : ("reference" as const);
  return {
    source_id: callArtifactId(ctx),
    source_class: sourceClass,
    asset_id: c.source.asset_id,
    media_hash: c.source.sha256,
    span,
    observed_at: at,
    author,
    extraction_method: author === RELAY_AGENT_ID ? "system_event" : "literal_transcript",
    confidence: 1,
    audience_scope: [ctx.setup.current().person_id],
    expires_at: null,
    supersedes: [],
    contradicts: [],
    status,
    patient_confirmed: patientConfirmed(status),
    confirmations: [],
  };
}

export const confirm_and_store: ToolImpl<"confirm_and_store"> = async (input, ctx) => {
  const c = ctx.session.contribution;
  ctx.gate.requirePendingContribution(input.contribution_hash);
  if (!c || c.content_hash !== input.contribution_hash) throw new GateError("confirmation", "the captured contribution is no longer in the session");

  if (input.step === "confirm") {
    const asset = ctx.assets.resolveSpan(input.audio_window.asset_id, input.audio_window);
    const turn = await finalTurnIn(ctx, input.audio_window);
    // A stop is not an answer to the question. It is recorded as "no" so that nothing can be kept, and the orchestrator ends the call.
    const stopRequested = turn !== null && firstPhraseIn(turnText(turn), ctx.script.stop_phrases) !== null;
    const decision: StoreDecision = turn ? (stopRequested ? "no" : classifyYes(turnText(turn))) : "unclear";
    const recordedAt = ctx.clock.iso();
    const body = { decision, contribution_hash: input.contribution_hash, audio: { asset_id: asset.id, span: turn ? { start_ms: turn.start_ms, end_ms: turn.end_ms } : null, media_hash: asset.sha256 }, recorded_at: recordedAt };
    const confirmation = { step: "confirm" as const, confirmation_id: `store-confirmation:${ctx.session.session_id}`, ...body, stop_requested: stopRequested, response_format: "yes_no" as const, confirmation_hash: await contentHash(body) };
    ctx.gate.recordStoreConfirmation(input.contribution_hash, decision);
    ctx.session.store_confirmation = confirmation;
    return confirmation;
  }

  // --- commit. Last, and only with her yes to exactly this, unchanged (rule 3; section 5). ---
  const nowIso = ctx.clock.iso();
  const topic = ctx.session.topic;
  if (!topic) throw new GateError("confirmation", "there is no topic for this contribution to be about");
  const token = await ctx.gate.requireToken(input.policy_token_id, topic.topic_id, nowIso);
  const { shared } = ctx.gate.requireCommittable(input.contribution_hash);
  // Re-derive the hash from the content about to be written. If anything changed after she heard it, nothing is stored.
  if ((await contentHash(hashedContent(c))) !== input.contribution_hash) throw new GateError("confirmation", "the contribution changed after she confirmed it");
  const share = ctx.session.share_confirmation;
  if (!share || share.contribution_hash !== input.contribution_hash) throw new GateError("confirmation", "the share question has not resolved; commit comes last");

  const artifactId = callArtifactId(ctx);
  const claimId = `claim:${ctx.session.session_id}`;
  const overall = { start_ms: Math.min(...c.intervals.map((i) => i.start_ms)), end_ms: Math.max(...c.intervals.map((i) => i.end_ms)) };
  const hers = (span: MediaSpan | null): Provenance => provFor(ctx, c, c.speaker_id, span, nowIso, "recall_call");
  const audit = (span: MediaSpan | null): Provenance => provFor(ctx, c, c.speaker_id, span, nowIso, "session_audit");

  const nodes: GraphNode[] = [
    { id: artifactId, type: "Artifact", label: "Confirmed call audio", props: { kind: "call", text: null, alt: "The spans of the call she confirmed" }, prov: hers(overall) },
    { id: c.contribution_id, type: "Contribution", label: c.literal_transcript, props: { content_hash: c.content_hash, literal_transcript: c.literal_transcript, generated_first_person_words: 0, shared }, prov: hers(overall) },
    // The new claim is her literal words and nothing else: no summary, no tidying, no model in between (rule 1).
    { id: claimId, type: "EpisodicClaim", label: c.literal_transcript, props: { text: c.literal_transcript }, prov: hers(overall) },
    { id: share.share_confirmation_id, type: "ShareConfirmation", label: `Share confirmation: ${share.decision}`, props: { decision: share.decision, contribution_hash: share.contribution_hash, recorded_at: share.recorded_at }, prov: audit(null) },
  ];
  for (const node of nodes) await ctx.graph.putNode(node);

  const place = ctx.session.verified.length > 0 ? await placeOf(ctx, topic.topic_id) : null;
  const edges: Array<[EdgeType, string, string, Record<string, string>]> = [
    ["EVIDENCE_FOR", artifactId, claimId, {}],
    ["SPOKEN_BY", claimId, c.speaker_id, {}],
    ["SPOKEN_BY", c.contribution_id, c.speaker_id, {}],
    ["SPOKEN_BY", share.share_confirmation_id, c.speaker_id, {}],
    ["DERIVED_FROM", c.contribution_id, artifactId, {}],
    ["DERIVED_FROM", claimId, c.contribution_id, {}],
    ["INCLUDED_SPAN", c.contribution_id, artifactId, { kept_spans: JSON.stringify(c.kept) }],
    ["ABOUT", claimId, topic.topic_id, {}],
    ...(place ? ([["ABOUT", claimId, place, {}]] as Array<[EdgeType, string, string, Record<string, string>]>) : []),
    ["SHARE_CONFIRMED_BY", c.contribution_id, share.share_confirmation_id, {}],
    ["PERMITTED_IN", artifactId, token.policy_id, {}],
  ];
  const written: string[] = [];
  for (const [type, from, to, props] of edges) {
    const id = edgeId(type, from, to);
    await ctx.graph.putEdge({ id, type, from, to, props, prov: type === "SHARE_CONFIRMED_BY" || type === "PERMITTED_IN" ? audit(null) : hers(overall) });
    written.push(id);
  }

  const stored = { step: "commit" as const, claim_id: claimId, contribution_id: c.contribution_id, contribution_hash: c.content_hash, shared, stored_at: nowIso, edges_written: written };
  ctx.session.stored = stored;
  return stored;
};

/** The verified place an event topic took place at, so her new words are tied to the place as well as to the event. */
async function placeOf(ctx: ToolContext, topicId: string): Promise<string | null> {
  const topic = await ctx.graph.getNode(topicId);
  if (topic?.type !== "Event") return null;
  for (const e of await ctx.graph.edgesOf(topicId)) {
    if (e.type === "RELATED_TO" && e.from === topicId && e.props.relation === "took_place_at" && ctx.gate.isVerified(e.to)) return e.to;
  }
  return null;
}

export const confirm_share: ToolImpl<"confirm_share"> = async (input, ctx) => {
  ctx.gate.requirePendingContribution(input.contribution_hash);
  // No window means she did not answer in time. That is "not shared", and it never blocks storing (section 5).
  const turn = input.audio_window ? await finalTurnIn(ctx, input.audio_window) : null;
  const stopRequested = turn !== null && firstPhraseIn(turnText(turn), ctx.script.stop_phrases) !== null;
  const decision = !input.audio_window ? ("timeout" as const) : turn ? (stopRequested ? ("no" as const) : classifyYes(turnText(turn))) : ("unclear" as const);
  const recordedAt = ctx.clock.iso();
  const body = { decision, contribution_hash: input.contribution_hash, recorded_at: recordedAt };
  const confirmation: ToolOutput<"confirm_share"> = { share_confirmation_id: `share-confirmation:${ctx.session.session_id}`, ...body, stop_requested: stopRequested, response_format: "yes_no", confirmation_hash: await contentHash(body) };
  ctx.gate.recordShareConfirmation(input.contribution_hash, decision);
  ctx.session.share_confirmation = confirmation;
  return confirmation;
};

export const record_retrieval_outcome: ToolImpl<"record_retrieval_outcome"> = async (input, ctx) => {
  const topic = ctx.session.topic;
  if (!topic || topic.topic_id !== input.topic_id) throw new GateError("evidence", "get_next_recall_topic has not chosen this topic");
  // Read from the reducer's own record of the call: what is written is what happened, not what a caller reports.
  const machine = ctx.machine();
  const { rungs_fired, cues_offered, reached_at_rung } = machine.context;
  const at = ctx.clock.iso();
  const sessionNodeId = ctx.session.session_id;
  const logId = `artifact:call-log:${ctx.session.session_id}`;
  const c = ctx.session.contribution;

  const prov: Provenance = {
    source_id: logId,
    source_class: "session_audit",
    asset_id: null,
    media_hash: null,
    span: null,
    observed_at: at,
    author: RELAY_AGENT_ID,
    extraction_method: "system_event",
    confidence: 1,
    audience_scope: [ctx.setup.current().person_id],
    expires_at: null,
    supersedes: [],
    contradicts: [],
    status: "reference",
    patient_confirmed: false,
    confirmations: [],
  };
  await ctx.graph.putNode({ id: logId, type: "Artifact", label: "Relay's record of this call", props: { kind: "call", text: null, alt: null }, prov });
  await ctx.graph.putNode({ id: sessionNodeId, type: "Session", label: "Recall call", props: { topic_id: topic.topic_id, started_at: ctx.session.started_at ?? at, ended_at: at, outcome: machine.state }, prov });
  const link = async (type: EdgeType, from: string, to: string): Promise<void> => ctx.graph.putEdge({ id: edgeId(type, from, to), type, from, to, props: {}, prov });
  if (ctx.session.stored && c) await link("DERIVED_FROM", c.contribution_id, sessionNodeId);

  // A call that was stopped, or handed off for safety, never finished its ladder. Counting it would misstate
  // what happened on the topic, so only the fact of the call is kept (rule 12: nothing beyond metadata).
  const interrupted = machine.state === "stopped" || machine.state === "safety_handoff";
  if (rungs_fired.length === 0 || interrupted) return { topic_outcome_id: null, retrieval_record_ids: [], first_rung_reached_unaided: null, highest_rung_used: null };

  const highest = Math.max(...rungs_fired);
  const outcomeId = `outcome:${ctx.session.session_id}`;
  await ctx.graph.putNode({ id: outcomeId, type: "TopicOutcome", label: "Topic outcome", props: { session_id: sessionNodeId, topic_id: topic.topic_id, first_rung_reached_unaided: reached_at_rung, highest_rung_used: highest, timestamp: at }, prov });
  await link("OUTCOME_OF", outcomeId, sessionNodeId);
  await link("RECALLED_IN", topic.topic_id, sessionNodeId);

  // The retrieval layer: for each cue offered, did she reach the memory after it? One record per use.
  const records: string[] = [];
  for (const cue of cues_offered) {
    const id = `retrieval:${ctx.session.session_id}:${cue.rung}`;
    const effective = reached_at_rung === cue.rung;
    await ctx.graph.putNode({ id, type: "RetrievalRecord", label: "Cue outcome", props: { topic_id: topic.topic_id, cue_id: cue.cue_id, rung: cue.rung, effective, used_at: at }, prov });
    await link(effective ? "CUE_EFFECTIVE_FOR" : "CUE_INEFFECTIVE_FOR", id, topic.topic_id);
    records.push(id);
  }
  return { topic_outcome_id: outcomeId, retrieval_record_ids: records, first_rung_reached_unaided: reached_at_rung, highest_rung_used: highest };
};
