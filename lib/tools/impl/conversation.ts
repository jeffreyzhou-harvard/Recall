/**
 * Tools 6-8: assess one turn, choose the least support, and say only what is
 * cited.
 *
 * `assess_conversation_state` works from the words of a final turn and nothing
 * else. It reports what was observably said - a request to repeat, an answer,
 * silence. It has no output field for emotion, cognition, or any judgment of
 * the person, so none can be produced (rule 4).
 */
import type { ArtifactNode, EpisodicClaimNode, GraphNode, TopicNode } from "@/lib/graph/types";
import { tokens, turnText } from "@/lib/providers/transcription";
import { SCAFFOLD_IDS, type PromptKind, type ScaffoldId, type ToolOutput } from "../contracts";
import type { ToolContext } from "../context";
import { GateError } from "../gates";
import type { ToolImpl } from "../runtime";

type RepairTarget = "whole" | "asker" | "referent";

async function topicsNamed(ctx: ToolContext, topicIds: readonly string[], spoken: readonly string[]): Promise<string[]> {
  const said = new Set(spoken);
  const hits: string[] = [];
  for (const id of topicIds) {
    const node = (await ctx.graph.getNode(id)) as TopicNode | null;
    if (node?.type !== "Topic") continue;
    const names = [node.label, ...node.props.aliases].map((n) => n.toLowerCase());
    if (names.some((n) => said.has(n))) hits.push(id);
  }
  return hits;
}

export const assess_conversation_state: ToolImpl<"assess_conversation_state"> = async (input, ctx) => {
  const ask = ctx.session.ask;
  if (!ask || ask.ask_id !== input.ask_id) throw new GateError("evidence", "inspect_request has not run for this ask");

  const window = input.audio_window;
  const turns = (await ctx.transcription.turnsIn(window)).filter((t) => t.speaker === "participant");
  const record = (result: ToolOutput<"assess_conversation_state">): ToolOutput<"assess_conversation_state"> => {
    ctx.session.assessments.push(result);
    if (result.state === "asked_repeat" || result.state === "no_answer") ctx.session.telemetry.thread_loss_events++;
    if (result.evidence.response_latency_ms !== null) {
      ctx.session.telemetry.response_latencies_ms.push(result.evidence.response_latency_ms);
    }
    return result;
  };

  // Silence is an endpointed window with no speech: either no turn at all, or a final turn with no words.
  if (turns.length === 0 || turns[turns.length - 1]!.words.length === 0) {
    return record({
      turn_id: `silence:${window.start_ms}`,
      state: "no_answer",
      evidence: {
        transcript: "",
        span: { start_ms: window.start_ms, end_ms: window.end_ms },
        matched_rule: "no_speech_in_window",
        repair_target: null,
        mentioned_option_ids: [],
        response_latency_ms: null,
      },
    });
  }

  const turn = turns[turns.length - 1]!;
  // Endpointing first: a partial turn is never classified as an answer or as assent.
  if (!turn.is_final) throw new Error(`turn "${turn.turn_id}" is not final yet; wait for endpointing before classifying`);

  const transcript = turnText(turn);
  const said = tokens(transcript);
  const has = (...words: string[]): boolean => words.some((w) => said.includes(w));
  const mentioned = await topicsNamed(ctx, ask.option_topic_ids, said);

  const before = (await ctx.transcription.allTurns(window.asset_id))
    .filter((t) => t.speaker === "relay" && t.end_ms <= turn.start_ms)
    .pop();
  const latency = before ? turn.start_ms - before.end_ms : null;

  let state: ToolOutput<"assess_conversation_state">["state"];
  let rule: string;
  let target: RepairTarget | null = null;

  const asksForRepair = transcript.includes("?") || has("again", "pardon", "repeat");
  if (asksForRepair && has("who")) [state, rule, target] = ["asked_repeat", "repair_request:who", "asker"];
  else if (asksForRepair && has("which")) [state, rule, target] = ["asked_repeat", "repair_request:which", "referent"];
  else if (asksForRepair && has("what", "again", "pardon", "repeat", "sorry")) {
    [state, rule, target] = ["asked_repeat", "repair_request:general", "whole"];
  } else if (/\b(i don'?t know|not sure)\b/.test(said.join(" "))) [state, rule] = ["no_answer", "said_unsure"];
  else if (mentioned.length > 0) [state, rule] = ["answer_present", "names_a_current_option"];
  else if (ask.option_topic_ids.length === 0 && said.length >= 3) [state, rule] = ["answer_present", "substantive_reply_to_open_ask"];
  else [state, rule] = ["followed", "acknowledgement"];

  return record({
    turn_id: turn.turn_id,
    state,
    evidence: {
      transcript,
      span: { start_ms: turn.start_ms, end_ms: turn.end_ms },
      matched_rule: rule,
      repair_target: target,
      mentioned_option_ids: mentioned,
      response_latency_ms: latency,
    },
  });
};

// --- scaffold ladder ---------------------------------------------------------

interface VerifiedFacts {
  asker: GraphNode | null;
  event: GraphNode | null;
  subject: GraphNode | null;
  options: TopicNode[];
  photos: ArtifactNode[];
  claims: EpisodicClaimNode[];
}

/** Sort the verified ids into the slots prompts are built from. Unverified ids never get this far. */
async function factsFrom(ctx: ToolContext, ids: readonly string[]): Promise<VerifiedFacts> {
  const ask = ctx.session.ask!;
  const facts: VerifiedFacts = { asker: null, event: null, subject: null, options: [], photos: [], claims: [] };
  const byId = new Map<string, GraphNode>();
  for (const id of ids) {
    const node = await ctx.graph.getNode(id);
    if (node) byId.set(id, node);
  }
  facts.asker = byId.get(ask.asker_id) ?? null;
  facts.event = ask.event_ids.map((id) => byId.get(id)).find(Boolean) ?? null;
  facts.subject = ask.topic_ids.filter((id) => !ask.option_topic_ids.includes(id)).map((id) => byId.get(id)).find(Boolean) ?? null;
  facts.options = ask.option_topic_ids.map((id) => byId.get(id)).filter((n): n is TopicNode => n?.type === "Topic");
  facts.photos = ask.artifacts
    .filter((a) => a.kind === "photo")
    .map((a) => byId.get(a.artifact_id))
    .filter((n): n is ArtifactNode => n?.type === "Artifact");
  facts.claims = [...byId.values()]
    .filter((n): n is EpisodicClaimNode => n.type === "EpisodicClaim" && n.prov.source_class === "prior_claim_with_source")
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return facts;
}

/** What each rung needs in order to be said at all, and the ids it would cite. */
function rungCitations(rung: ScaffoldId, f: VerifiedFacts): string[] | null {
  switch (rung) {
    case "repeat":
      return f.asker && (f.event || f.subject) ? [f.asker, f.event, f.subject].filter((n): n is GraphNode => !!n).map((n) => n.id) : null;
    case "name_asker":
      return f.asker ? [f.asker.id] : null;
    case "restate_options":
      return f.options.length >= 2 ? [...f.options.map((o) => o.id), ...(f.asker ? [f.asker.id] : []), ...f.photos.map((p) => p.id)] : null;
    case "source_backed_cue":
      return f.claims[0] && f.claims[0].prov.asset_id && f.claims[0].prov.span ? [f.claims[0].id] : null;
  }
}

const TARGET_RUNG: Record<RepairTarget, number> = { whole: 0, asker: 1, referent: 2 };

/**
 * The deterministic ladder. Least support first: a rung is chosen only when
 * every rung below it either cannot address what was observed, was already
 * tried, or has no verified evidence to stand on. Every rejection is recorded.
 *
 * In the live side demo Meta Muse Spark makes this one decision from the same
 * typed input, and must cite graph node ids; its answer is validated against
 * the same contract and the same eligibility rules.
 */
export const select_scaffold: ToolImpl<"select_scaffold"> = async (input, ctx) => {
  const ask = ctx.session.ask;
  if (!ask || ask.ask_id !== input.ask_id) throw new GateError("evidence", "inspect_request has not run for this ask");
  ctx.gate.requireVerifiedEvidence(input.verified_ids);

  const facts = await factsFrom(ctx, input.verified_ids);
  const highestUsed = Math.max(-1, ...input.scaffolds_used.map((s) => SCAFFOLD_IDS.indexOf(s)));
  const floor = input.repair_target ? TARGET_RUNG[input.repair_target] : highestUsed + 1;

  const rejected: Array<{ scaffold_id: ScaffoldId; reason: string }> = [];
  let chosen: { scaffold_id: ScaffoldId; citations: string[] } | null = null;

  for (const [index, rung] of SCAFFOLD_IDS.entries()) {
    if (chosen) {
      rejected.push({ scaffold_id: rung, reason: "more support than needed; held in reserve" });
      continue;
    }
    const citations = rungCitations(rung, facts);
    if (index < floor) {
      const reason =
        input.repair_target === "referent"
          ? "does not supply what was asked for: the options were never named"
          : input.repair_target === "asker"
            ? "does not say who is asking"
            : "a lower rung was already tried";
      rejected.push({ scaffold_id: rung, reason });
    } else if (input.scaffolds_used.includes(rung)) rejected.push({ scaffold_id: rung, reason: "already used in this call" });
    else if (!citations) rejected.push({ scaffold_id: rung, reason: "no verified evidence to say it with" });
    else chosen = { scaffold_id: rung, citations };
  }

  if (chosen) ctx.session.telemetry.scaffolds_fired.push(chosen.scaffold_id);
  return {
    scaffold_id: chosen?.scaffold_id ?? null,
    citations: chosen?.citations ?? [],
    rejected,
    decided_by: "deterministic_ladder" as const,
  };
};

// --- prompt rendering ---------------------------------------------------------

type Segment = { text: string; kind: "connective" | "fact"; citation_ids: string[] };
const say = (text: string): Segment => ({ text, kind: "connective", citation_ids: [] });
const fact = (text: string, ...nodes: GraphNode[]): Segment => ({ text, kind: "fact", citation_ids: nodes.map((n) => n.id) });
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six"];
const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function need<T>(value: T | null | undefined, kind: PromptKind, slot: string): T {
  if (value === null || value === undefined) throw new GateError("evidence", `"${kind}" needs a verified citation for ${slot}`);
  return value;
}

/**
 * Templates are fixed. Connective words are Relay's own; every fact is a slot
 * filled from a verified node and carries that node's id. There is no free-text
 * path, so Relay cannot say something it has no citation for (rule 6).
 */
function compose(kind: PromptKind, f: VerifiedFacts): Segment[] {
  switch (kind) {
    case "brief":
    case "repeat": {
      const asker = need(f.asker, kind, "the asker");
      const about = [f.event, f.subject].filter((n): n is GraphNode => !!n);
      if (about.length === 0) need(null, kind, "what the ask is about");
      return [fact(asker.label, asker), say(" wants your help with "), fact(about.map((n) => n.label).join(" "), ...about), say(".")];
    }
    case "name_asker":
      return [say("This is from "), fact(need(f.asker, kind, "the asker").label, f.asker!), say(".")];
    case "restate_options": {
      if (f.options.length < 2) need(null, kind, "two current options");
      const [first, ...rest] = f.options;
      const segments: Segment[] = [fact(capitalize(first!.label), first!)];
      for (const option of rest) segments.push(say(" or "), fact(option.label, option));
      segments.push(say("."));
      if (f.asker && f.photos.length > 0) {
        const count = f.photos.length === 1 ? "this photo" : `these ${NUMBER_WORDS[f.photos.length] ?? f.photos.length} photos`;
        segments.push(say(" "), fact(f.asker.label, f.asker), say(" sent "), fact(count, ...f.photos), say("."));
      }
      return segments;
    }
    case "source_backed_cue":
      return [fact("Here is something you said before.", need(f.claims[0], kind, "a source-backed claim"))];
    case "confirm_send":
      return [say("Want me to send that to "), fact(need(f.asker, kind, "the asker").label, f.asker!), say("?")];
    case "narrowing":
      return [
        say("I don't have enough context to answer that for you. I can ask "),
        fact(need(f.asker, kind, "the asker").label, f.asker!),
        say(" to clarify."),
      ];
    case "wrap_up":
      return [say("That's alright. We can come back to this another time.")];
    case "close_kindly":
      return [say("Thank you. We'll talk again soon.")];
  }
}

export const render_prompt: ToolImpl<"render_prompt"> = async (input, ctx) => {
  const ask = ctx.session.ask;
  if (!ask || ask.ask_id !== input.ask_id) throw new GateError("evidence", "inspect_request has not run for this ask");
  // No citations, no speech: every id offered must already have passed verify_claim_support.
  ctx.gate.requireVerifiedEvidence(input.citations);

  const facts = await factsFrom(ctx, input.citations);
  const segments = compose(input.scaffold_id, facts);

  const cited = new Set(input.citations);
  for (const s of segments) {
    if (s.kind === "fact" && (s.citation_ids.length === 0 || s.citation_ids.some((id) => !cited.has(id)))) {
      throw new GateError("evidence", `"${s.text}" is not backed by the citations provided`);
    }
  }

  const claim = input.scaffold_id === "source_backed_cue" ? facts.claims[0]! : null;
  const result: ToolOutput<"render_prompt"> = {
    prompt_id: `prompt:${ctx.session.session_id}:${ctx.session.prompts.length + 1}`,
    kind: input.scaffold_id,
    voice: "relay",
    text: segments.map((s) => s.text).join(""),
    segments,
    // Her own earlier words are played back from the original clip, never re-voiced.
    play_original: claim
      ? { asset_id: claim.prov.asset_id!, span: claim.prov.span!, media_hash: claim.prov.media_hash! }
      : null,
  };
  ctx.session.prompts.push(result);
  return result;
};
