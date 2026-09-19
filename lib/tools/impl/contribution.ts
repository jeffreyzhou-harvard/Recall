/**
 * Tools 9-11: capture her exact words, get her yes to that exact artifact and
 * audience, and only then deliver. Each step fails closed.
 */
import { RELAY_AGENT_ID, type GraphNode, type Provenance } from "@/lib/graph/types";
import { edgeId } from "@/lib/graph/seed";
import { AuthorshipError, generatedFirstPersonWords, herWordsPct, participantWordsIn } from "@/lib/provenance/authorship";
import { buildEdl, trimCount } from "@/lib/provenance/edl";
import { contentHash } from "@/lib/provenance/hash";
import { tokens, turnText } from "@/lib/providers/transcription";
import type { AssentDecision } from "@/lib/state/machine";
import type { ToolOutput } from "../contracts";
import type { VoiceCard } from "@/lib/bridge/thread-bridge";
import type { ToolContext } from "../context";
import { GateError } from "../gates";
import type { ToolImpl } from "../runtime";

type Contribution = ToolOutput<"capture_exact_contribution">;

/** Exactly the fields that define the artifact. Change any of them and the hash - and so the approval - no longer matches. */
const hashedContent = (c: Omit<Contribution, "content_hash" | "contribution_id">): unknown => ({
  speaker_id: c.speaker_id,
  literal_transcript: c.literal_transcript,
  words: c.words,
  source: c.source,
  intervals: c.intervals,
  trims: c.trims,
  kept: c.kept,
});

export const capture_exact_contribution: ToolImpl<"capture_exact_contribution"> = async (input, ctx) => {
  const ask = ctx.session.ask;
  if (!ask || ask.ask_id !== input.ask_id) throw new GateError("authorship", "inspect_request has not run for this ask");
  const last = ctx.session.assessments[ctx.session.assessments.length - 1];
  if (!last || last.state !== "answer_present") {
    throw new GateError("authorship", "no answer has been heard, so there is nothing of hers to capture");
  }
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

  const literal = words.map((w) => w.w).join(" ");
  const spoken = ` ${tokens(literal).join(" ")} `;
  const blocked = ctx.policy.blocked_terms.find((term) => spoken.includes(` ${term.toLowerCase()} `));
  if (blocked) throw new GateError("permission", "the reply contains content the joint setup blocked from being shared");

  const generated = generatedFirstPersonWords(words, turns);
  if (generated !== 0) throw new GateError("authorship", `${generated} word(s) are not from her recording`);

  const edl = buildEdl({ asset_id: asset.id, sha256: asset.sha256 }, intervals, words);
  const body = {
    speaker_id: ask.addressee_id,
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
  ctx.session.assent = null;
  return contribution;
};

const YES = /^(yes|yeah|yep|yes please|please do|send it|ok|okay|sure|go ahead)\b/;
const NO = /^(no|nope|don't|do not|not now|wait|stop)\b/;

function classifyAssent(transcript: string): AssentDecision {
  const said = tokens(transcript).join(" ");
  const yes = YES.test(said);
  const no = NO.test(said) || /\b(no|don't|wait)\b/.test(said);
  // Anything short of a clean yes is not a yes. A mixed reply is unclear, and unclear never sends.
  if (yes && !no) return "yes";
  if (no && !yes) return "no";
  return "unclear";
}

export const request_assent: ToolImpl<"request_assent"> = async (input, ctx) => {
  ctx.gate.requirePendingContribution(input.contribution_hash);
  const token = await ctx.gate.requireToken(ctx.session.policy_token_id, input.ask_id, ctx.clock.iso());
  if (input.audience !== token.audience) {
    throw new GateError("permission", `"${input.audience}" is not the audience the policy approved`);
  }

  const asset = ctx.assets.resolveSpan(input.audio_window.asset_id, input.audio_window);
  const turns = (await ctx.transcription.turnsIn(input.audio_window)).filter((t) => t.speaker === "participant");
  const turn = turns[turns.length - 1] ?? null;
  if (turn && !turn.is_final) throw new Error(`turn "${turn.turn_id}" is not final yet; wait for endpointing before classifying`);

  const transcript = turn ? turnText(turn) : "";
  const decision: AssentDecision = turn ? classifyAssent(transcript) : "unclear";
  const recordedAt = ctx.clock.iso();
  const body = {
    decision,
    contribution_hash: input.contribution_hash,
    audience: input.audience,
    transcript,
    audio: {
      asset_id: asset.id,
      span: turn ? { start_ms: turn.start_ms, end_ms: turn.end_ms } : null,
      media_hash: asset.sha256,
    },
    recorded_at: recordedAt,
  };
  const assent: ToolOutput<"request_assent"> = {
    assent_id: `assent:${ctx.session.session_id}:${input.contribution_hash.slice(0, 12)}`,
    ...body,
    assent_hash: await contentHash(body),
  };
  ctx.gate.recordAssent({
    assent_id: assent.assent_id,
    decision,
    contribution_hash: input.contribution_hash,
    audience: input.audience,
    recorded_at: recordedAt,
  });
  ctx.session.assent = assent;
  return assent;
};

/** Layer 4 audit: written only once she has said yes and the card has actually been delivered. */
async function writeAudit(ctx: ToolContext, c: Contribution, assent: ToolOutput<"request_assent">, threadId: string, at: string): Promise<void> {
  const callArtifactId = `artifact:call:${ctx.session.session_id}`;
  const prov = (author: string, span: Provenance["span"]): Provenance => ({
    source_id: callArtifactId,
    source_class: "session_audit",
    asset_id: c.source.asset_id,
    media_hash: c.source.sha256,
    span,
    observed_at: at,
    author,
    extraction_method: author === RELAY_AGENT_ID ? "system_event" : "literal_transcript",
    confidence: 1,
    audience_scope: [threadId],
    expires_at: null,
    supersedes: [],
    contradicts: [],
  });
  const overall = { start_ms: c.intervals[0]!.start_ms, end_ms: c.intervals[c.intervals.length - 1]!.end_ms };
  const nodes: GraphNode[] = [
    { id: callArtifactId, type: "Artifact", label: "Approved call audio", props: { kind: "audio", text: null, alt: "The approved spans of the call" }, prov: prov(c.speaker_id, overall) },
    { id: c.contribution_id, type: "Contribution", label: c.literal_transcript, props: { content_hash: c.content_hash, literal_transcript: c.literal_transcript, generated_first_person_words: 0 }, prov: prov(c.speaker_id, overall) },
    { id: assent.assent_id, type: "Assent", label: `Voice approval: ${assent.decision}`, props: { decision: assent.decision, contribution_hash: assent.contribution_hash, audience: assent.audience }, prov: prov(c.speaker_id, assent.audio.span) },
  ];
  for (const node of nodes) await ctx.graph.putNode(node);
  const edges: Array<[Parameters<typeof edgeId>[0], string, string, Provenance["span"]]> = [
    ["SPOKEN_BY", c.contribution_id, c.speaker_id, overall],
    ["SPOKEN_BY", assent.assent_id, c.speaker_id, assent.audio.span],
    ["DERIVED_FROM", c.contribution_id, callArtifactId, overall],
    ["INCLUDED_SPAN", c.contribution_id, callArtifactId, overall],
    ["APPROVED_BY", c.contribution_id, assent.assent_id, assent.audio.span],
    ["DELIVERED_TO", c.contribution_id, threadId, null],
  ];
  for (const [type, from, to, span] of edges) {
    const author = type === "DELIVERED_TO" ? RELAY_AGENT_ID : c.speaker_id;
    const props: Record<string, string> = type === "INCLUDED_SPAN" ? { kept_spans: JSON.stringify(c.kept) } : {};
    await ctx.graph.putEdge({ id: edgeId(type, from, to), type, from, to, props, prov: prov(author, span) });
  }
}

export const publish_contribution: ToolImpl<"publish_contribution"> = async (input, ctx) => {
  const nowIso = ctx.clock.iso();
  const token = await ctx.gate.requireToken(input.policy_token_id, input.ask_id, nowIso);
  const yes = ctx.gate.requirePublishable(input.hash, input.destination, token);

  const c = ctx.session.contribution;
  const assent = ctx.session.assent;
  if (!c || !assent || assent.assent_id !== yes.assent_id) throw new GateError("assent", "the approved contribution is no longer in the session");
  // Re-derive the hash from the content about to be sent. If anything changed after
  // she approved it, this no longer matches and nothing is delivered (rule 3).
  if ((await contentHash(hashedContent(c))) !== input.hash) {
    throw new GateError("assent", "the contribution changed after it was approved");
  }
  const ask = ctx.session.ask!;
  if (input.destination !== ask.thread_id) {
    throw new GateError("permission", "a contribution is delivered only to the thread the ask came from");
  }

  const speaker = await ctx.graph.getNode(c.speaker_id);
  const deliveryId = `delivery:${ctx.session.session_id}`;
  const pauses = c.silence_trims === 1 ? "1 pause" : `${c.silence_trims} pauses`;
  const card: VoiceCard = {
    delivery_id: deliveryId,
    thread_id: input.destination,
    speaker_id: c.speaker_id,
    speaker_name: speaker?.label ?? c.speaker_id,
    delivered_at: nowIso,
    literal_transcript: c.literal_transcript,
    audio: { asset_id: c.source.asset_id, source_sha256: c.source.sha256, kept: c.kept },
    content_hash: c.content_hash,
    provenance_rows: [
      "Source: live call",
      `Edited: ${pauses} trimmed, ${c.generated_first_person_words} words generated`,
      `Approved by ${speaker?.label ?? "her"}'s voice`,
    ],
  };
  // The bridge refuses anything that is not a reply to the forward this ask arrived as, into its own thread.
  await ctx.bridge.post({ kind: "voice_contribution", in_reply_to: ask.forward_id, to: { thread_id: input.destination }, card }, nowIso);
  await writeAudit(ctx, c, assent, input.destination, nowIso);

  const delivery: ToolOutput<"publish_contribution"> = {
    delivery_id: deliveryId,
    contribution_hash: c.content_hash,
    assent_id: assent.assent_id,
    delivered_to: input.destination,
    delivered_at: nowIso,
  };
  ctx.session.delivery = delivery;
  return delivery;
};
