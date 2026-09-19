/**
 * Tools 5-7: assess one turn, choose the least support, and say only a
 * reviewed line filled with cited facts.
 *
 * `assess_conversation_state` works from the words of a final turn and nothing
 * else. It reports what was observably said - she named something, she asked
 * Relay to repeat, she said nothing. It has no output field for emotion,
 * cognition, or any judgment of the person, so none can be produced (rule 4).
 * It is not a test: nothing here is "right" or "wrong", only reached or not yet.
 */
import { cueHints, preferCues } from "@/lib/graph/retrieval-layer";
import type { GraphEdge, GraphNode } from "@/lib/graph/types";
import { tokens, turnText } from "@/lib/providers/transcription";
import { allScriptLines, containsPhrase, fill, firstPhraseIn, slotsOf, ScriptError, type ScriptLine } from "@/lib/script/call-script";
import { endsInOpenQuestion, lintConduct, lintLines } from "@/lib/script/lint";
import { FAMILY_SOURCED_MAX_RUNG, type Rung } from "@/lib/state/machine";
import type { ToolOutput } from "../contracts";
import type { ToolContext } from "../context";
import { GateError } from "../gates";
import type { ToolImpl } from "../runtime";

type Assessment = ToolOutput<"assess_conversation_state">;

/** How a verified node is named in speech. Used both to hear it in her words and to fill a slot with it. */
function spokenNames(node: GraphNode): string[] {
  if (node.type === "Person") return [node.props.display_name];
  if (node.type === "Place") return [node.label, ...node.props.aliases];
  if (node.type === "Event") return [node.label];
  return [];
}

// --- tool 5 --------------------------------------------------------------------------------------------------

export const assess_conversation_state: ToolImpl<"assess_conversation_state"> = async (input, ctx) => {
  if (ctx.session.topic?.topic_id !== input.topic_id) throw new GateError("evidence", "get_next_recall_topic has not chosen this topic");
  const policy = ctx.setup.current();
  const window = input.audio_window;
  const turns = (await ctx.transcription.turnsIn(window)).filter((t) => t.speaker === "participant");

  const record = (result: Assessment): Assessment => {
    ctx.session.assessments.push(result);
    const latency = result.evidence.response_latency_ms;
    if (latency !== null) ctx.session.telemetry.response_latencies_ms.push(latency);
    const lastRung = ctx.session.telemetry.rungs_fired.at(-1);
    if (lastRung && lastRung.latency_after_ms === null) lastRung.latency_after_ms = latency;
    return result;
  };

  // What she was answering: the recognition rung offers two choices; every other prompt here is open.
  const format = ctx.session.spoken.at(-1)?.rung === 4 ? ("forced_choice" as const) : ("open" as const);

  // Silence is an endpointed window with no speech of hers: no turn at all, or a final turn with no words.
  const turn = turns.at(-1);
  if (!turn || turn.words.length === 0) {
    return record({
      turn_id: `silence:${window.asset_id}:${window.start_ms}`,
      state: "no_answer",
      silent: true,
      evidence: { transcript: "", span: { start_ms: window.start_ms, end_ms: window.end_ms }, matched_rule: "no_speech_in_window", matched_ids: [], conduct_signal: null, response_format: format, response_latency_ms: null },
    });
  }
  // Endpointing first: a partial turn is never classified.
  if (!turn.is_final) throw new Error(`turn "${turn.turn_id}" is not final yet; wait for endpointing before classifying`);

  const transcript = turnText(turn);
  const said = tokens(transcript);
  const relaySaid = ctx.session.spoken.map((s) => s.text).join(" ");
  const relayTokens = new Set(tokens(relaySaid));
  const novel = said.filter((w) => !relayTokens.has(w));

  const before = (await ctx.transcription.allTurns(window.asset_id)).filter((t) => t.speaker === "relay" && t.end_ms <= turn.start_ms).pop();
  const latency = before ? turn.start_ms - before.end_ms : null;

  // What of the verified subgraph her words touch that Relay has not already said in this call.
  const matched: string[] = [];
  for (const v of ctx.session.verified) {
    if (v.id === policy.person_id) continue;
    const node = await ctx.graph.getNode(v.id);
    const names = node ? spokenNames(node) : [((await ctx.graph.getEdge(v.id))?.props.said_as as string | null | undefined) ?? ""];
    if (names.some((n) => n !== "" && containsPhrase(transcript, n) && !containsPhrase(relaySaid, n))) matched.push(v.id);
  }

  const conduct = firstPhraseIn(transcript, ctx.script.stop_phrases) ? ("stop_request" as const) : firstPhraseIn(transcript, ctx.script.identity_phrases) ? ("identity_question" as const) : null;
  const done = (state: Assessment["state"], rule: string): Assessment =>
    record({ turn_id: turn.turn_id, state, silent: false, evidence: { transcript, span: { start_ms: turn.start_ms, end_ms: turn.end_ms }, matched_rule: rule, matched_ids: matched.sort(), conduct_signal: conduct, response_format: format, response_latency_ms: latency } });

  if (conduct) return done("no_answer", `conduct:${conduct}`);
  if (firstPhraseIn(transcript, ctx.script.unsure_phrases)) return done("no_answer", "said_unsure");

  // A recognition pick is read against what was offered, including on the follow-up: repeating the choice is not a memory.
  const offered = ctx.session.last_recognition;
  if (offered) {
    const saidAs = async (edgeId: string): Promise<string> => ((await ctx.graph.getEdge(edgeId))?.props.said_as as string | null) ?? "";
    const [one, other] = [await saidAs(offered.correct_edge_id), await saidAs(offered.other_edge_id)];
    const named = (w: string): boolean => w !== "" && containsPhrase(transcript, w);
    const pickAlreadyLogged = ctx.session.assessments.some((a) => a.evidence.matched_rule === "named_one_of_the_two_offered");
    const onRecognitionReply = ctx.session.spoken.at(-1)?.rung === 4;
    if (named(one) && !named(other)) {
      const fillers = new Set(["my", "the", "a", "an", "your", "our", "her", "his"]);
      const extra = novel.filter((w) => !fillers.has(w));
      if (pickAlreadyLogged && extra.length === 0) return done("no_answer", "repeat_of_recognition_pick");
      if (!pickAlreadyLogged) return done("recalled", "named_one_of_the_two_offered");
    } else if (onRecognitionReply) {
      return done("no_answer", "did_not_name_one_of_the_two_offered");
    }
  }

  if (said.length > 0 && novel.length === 0) return done("no_answer", "echo_of_relay_words");
  const asksForRepair = (transcript.includes("?") || /\b(pardon|sorry)\b/.test(said.join(" "))) && /\b(what|pardon|sorry|again|repeat|say that)\b/.test(said.join(" "));
  if (asksForRepair) return done("asked_repeat", "repair_request");
  if (said.length >= 4 && novel.length >= 2) return done("new_detail_offered", "substantive_reply");
  if (matched.length > 0) return done("recalled", "named_something_relay_had_not_said");
  if (firstPhraseIn(transcript, ctx.script.affirm_phrases)) return done("recalled", "said_she_is_with_it");
  return done("no_answer", "nothing_about_the_topic");
};

// --- tool 6: the ladder -----------------------------------------------------------------------------------------

interface RungPlan {
  scaffold: ScriptLine;
  slot_ids: Record<string, string>;
  citations: string[];
  cue: { kind: "person" | "photo" | "family_claim"; cue_id: string } | null;
  recognition?: { correct_edge_id: string; other_edge_id: string };
}

interface Material {
  topic: GraphNode;
  personId: string;
  verified: Map<string, { speaker: string; patient_confirmed: boolean }>;
  /** Verified claims about the topic, with the verified things each is also about. */
  claims: Array<{ claim: GraphNode; about: GraphNode[] }>;
  place: GraphNode | null;
  relations: Array<{ edge: GraphEdge; said_as: string }>;
  photos: GraphNode[];
}

async function gather(ctx: ToolContext, topicId: string, verifiedIds: readonly string[]): Promise<Material> {
  const personId = ctx.setup.current().person_id;
  const verified = new Map(ctx.gate.requireVerifiedEvidence(verifiedIds).map((v) => [v.id, v]));
  const topic = await ctx.graph.getNode(topicId);
  if (!topic || !verified.has(topicId)) throw new GateError("evidence", "the topic itself has not been verified");

  const material: Material = { topic, personId, verified, claims: [], place: topic.type === "Place" ? topic : null, relations: [], photos: [] };
  for (const edge of await ctx.graph.edgesOf(topicId)) {
    const otherId = edge.from === topicId ? edge.to : edge.from;
    if (!verified.has(otherId)) continue;
    const other = await ctx.graph.getNode(otherId);
    if (!other) continue;
    if (edge.type === "ABOUT" && other.type === "EpisodicClaim") {
      const about: GraphNode[] = [];
      for (const e of await ctx.graph.edgesOf(other.id)) {
        if (e.type !== "ABOUT" || e.from !== other.id || e.to === topicId || !verified.has(e.to)) continue;
        const n = await ctx.graph.getNode(e.to);
        if (n) about.push(n);
      }
      material.claims.push({ claim: other, about: about.sort((a, b) => (a.id < b.id ? -1 : 1)) });
    } else if (edge.type === "DEPICTS" && other.type === "Artifact" && other.props.kind === "photo") material.photos.push(other);
    else if (edge.type === "RELATED_TO" && edge.props.relation === "took_place_at" && other.type === "Place") material.place = other;
  }
  for (const id of verifiedIds) {
    const edge = await ctx.graph.getEdge(id);
    if (edge?.type === "RELATED_TO" && edge.from === personId && typeof edge.props.said_as === "string" && edge.props.said_as !== "") material.relations.push({ edge, said_as: edge.props.said_as });
  }
  material.claims.sort((a, b) => (a.claim.id < b.claim.id ? -1 : 1));
  material.photos.sort((a, b) => (a.id < b.id ? -1 : 1));
  material.relations.sort((a, b) => (a.edge.id < b.edge.id ? -1 : 1));
  return material;
}

const isHers = (m: Material, claim: GraphNode): boolean => m.verified.get(claim.id)?.speaker === m.personId && m.verified.get(claim.id)?.patient_confirmed === true;

/**
 * When a person/relationship cue and a place/photo/event cue are both available, the person is said first.
 * The retrieval layer only orders cues of the same kind - it never promotes a photo over a person.
 */
function preferPersonThenCues(cues: RungPlan[], cueOrder: (cues: RungPlan[]) => RungPlan[]): RungPlan[] {
  const person = cues.filter((c) => c.cue?.kind === "person");
  const other = cues.filter((c) => c.cue?.kind !== "person");
  return [...(person.length > 0 ? cueOrder(person) : []), ...(other.length > 0 ? cueOrder(other) : [])];
}

/** What each rung would say, or why it cannot be said. A rung with nothing verified to stand on is never improvised. */
function planRung(ctx: ToolContext, rung: Rung, m: Material, familySourced: boolean, cueOrder: (cues: RungPlan[]) => RungPlan[]): RungPlan[] | string {
  const lines = ctx.script.ladder.categories[ctx.session.topic!.category];
  const topicId = m.topic.id;
  switch (rung) {
    case 1:
      return [{ scaffold: ctx.script.ladder.free_recall, slot_ids: { topic: topicId }, citations: [topicId], cue: null }];
    case 2:
      return lines ? [{ scaffold: lines.context, slot_ids: {}, citations: [topicId], cue: null }] : "the call script has no context line for this kind of topic";
    case 3: {
      if (familySourced) {
        // Rule 13: attributed to its contributor, and followed by an open question. Never stated as her memory.
        const theirs = m.claims.find((c) => !isHers(m, c.claim));
        if (!theirs || !m.verified.has(m.verified.get(theirs.claim.id)!.speaker)) return "no verified family contribution to attribute a cue to";
        const author = m.verified.get(theirs.claim.id)!.speaker;
        return [{ scaffold: ctx.script.ladder.family_sourced_association, slot_ids: { author, topic: topicId }, citations: [topicId, theirs.claim.id, author], cue: { kind: "family_claim", cue_id: theirs.claim.id } }];
      }
      const cues: RungPlan[] = [];
      if (lines?.association?.person) {
        for (const c of m.claims.filter((c) => isHers(m, c.claim))) {
          for (const person of c.about.filter((n) => n.type === "Person" && n.id !== m.personId)) {
            if (!cues.some((x) => x.cue?.cue_id === person.id)) cues.push({ scaffold: lines.association.person, slot_ids: { cue: person.id }, citations: [topicId, c.claim.id, person.id], cue: { kind: "person", cue_id: person.id } });
          }
        }
      }
      if (lines?.association?.photo) {
        for (const photo of m.photos) {
          const author = m.verified.get(photo.id)!.speaker;
          if (m.verified.has(author)) cues.push({ scaffold: lines.association.photo, slot_ids: { author }, citations: [topicId, photo.id, author], cue: { kind: "photo", cue_id: photo.id } });
        }
      }
      return cues.length > 0 ? preferPersonThenCues(cues, cueOrder) : "no verified cue is tied to this topic";
    }
    case 4:
    case 5: {
      const line = rung === 4 ? lines?.recognition : lines?.reorientation;
      if (!line) return `the call script has no ${rung === 4 ? "recognition" : "reorientation"} line for this kind of topic`;
      if (!m.place) return "no verified place to name";
      // The fact itself must be hers, in her own confirmed words: a family account is never the "answer" (rule 13).
      for (const c of m.claims.filter((c) => isHers(m, c.claim))) {
        for (const person of c.about.filter((n) => n.type === "Person" && n.id !== m.personId)) {
          const tie = m.relations.find((r) => r.edge.to === person.id);
          if (!tie) continue;
          if (rung === 5) return [{ scaffold: line, slot_ids: { relation: tie.edge.id, person: person.id, place: m.place.id }, citations: [topicId, c.claim.id, person.id, m.place.id, tie.edge.id], cue: null }];
          // A genuinely plausible alternative: someone else she is really related to, who is not part of this memory.
          const inThisMemory = new Set(m.claims.flatMap((x) => x.about.map((n) => n.id)));
          const other = m.relations.find((r) => r.edge.to !== person.id && !inThisMemory.has(r.edge.to) && r.said_as !== tie.said_as);
          if (!other) continue;
          // Order by the other person's id - a rule that knows nothing about which one is in the memory.
          const [a, b] = [tie, other].sort((x, y) => (x.edge.to < y.edge.to ? -1 : 1));
          return [{ scaffold: line, slot_ids: { place: m.place.id, option_a: a!.edge.id, option_b: b!.edge.id }, citations: [topicId, c.claim.id, m.place.id, tie.edge.id, other.edge.id], cue: { kind: "person", cue_id: person.id }, recognition: { correct_edge_id: tie.edge.id, other_edge_id: other.edge.id } }];
        }
      }
      return rung === 4 ? "no verified, plausible alternative to offer beside it" : "nothing of her own, confirmed, to say back to her";
    }
  }
}

export const select_scaffold: ToolImpl<"select_scaffold"> = async (input, ctx) => {
  const topic = ctx.session.topic;
  if (!topic || topic.topic_id !== input.topic_id) throw new GateError("evidence", "get_next_recall_topic has not chosen this topic");
  // The reducer's record of the call is the truth about which rungs have fired; a caller cannot talk its way up the ladder.
  const fired = ctx.machine().context.rungs_fired;
  if (fired.length !== input.rungs_fired.length || fired.some((r, i) => r !== input.rungs_fired[i])) throw new GateError("evidence", "rungs_fired does not match the call so far");
  if ((input.state === "opening") !== (fired.length === 0)) throw new GateError("evidence", "a call opens with free recall, once");

  const material = await gather(ctx, input.topic_id, input.verified_ids);
  const hints = await cueHints(ctx.graph, input.topic_id);
  const highest = Math.max(0, ...fired);
  const rejected: Array<{ rung: number; reason: string }> = [];
  let chosen: { rung: Rung; plans: RungPlan[] } | null = null;

  for (const rung of [1, 2, 3, 4, 5] as Rung[]) {
    // A rung that is disabled outright is always logged as disabled, never merely as "held in reserve".
    if (topic.family_sourced && rung > FAMILY_SOURCED_MAX_RUNG) rejected.push({ rung, reason: "disabled: the topic is family-sourced and she has not confirmed it, so a forced choice or a stated fact could plant a memory (rule 13)" });
    else if (rung === 5 && !topic.reorientation_allowed) rejected.push({ rung, reason: "disabled: this is an autobiographical memory, and stating one outright shades into correction" });
    else if (chosen) rejected.push({ rung, reason: "more support than needed; held in reserve" });
    else if (rung <= highest) rejected.push({ rung, reason: fired.includes(rung) ? "already tried in this call; a rung is never repeated" : "below a rung that has already been tried" });
    else if (rung === 5 && !([1, 2, 3, 4] as Rung[]).every((r) => fired.includes(r))) rejected.push({ rung, reason: "reorientation is never reached before rungs 1-4 have each been tried in order" });
    else {
      const plans = planRung(ctx, rung, material, topic.family_sourced, (cues) => preferCues(cues.map((c) => ({ ...c, cue_id: c.cue!.cue_id })), hints));
      if (typeof plans === "string") rejected.push({ rung, reason: plans });
      else chosen = { rung, plans };
    }
  }

  if (!chosen) return { rung: null, scaffold_id: null, slot_ids: {}, citations: [], cue: null, family_sourced_limit: topic.family_sourced, rejected, retrieval_hints_used: [], decided_by: "deterministic_ladder" };

  // Which cue, never whether: person/relationship first, then the retrieval layer among that kind.
  // An advisor may pick only among the front-runners of that same kind.
  let plan = chosen.plans[0]!;
  let decidedBy: "deterministic_ladder" | "muse_spark" = "deterministic_ladder";
  const tier = (p: RungPlan): string => JSON.stringify([hints.find((h) => h.cue_id === p.cue?.cue_id)?.effective ?? 0, (hints.find((h) => h.cue_id === p.cue?.cue_id)?.ineffective ?? 0) > 0]);
  const sameKind = chosen.plans.filter((p) => (p.cue?.kind ?? null) === (plan.cue?.kind ?? null));
  const level = sameKind.filter((p) => p.cue && tier(p) === tier(plan));
  if (ctx.scaffoldAdvisor && level.length > 1) {
    try {
      const pick = await ctx.scaffoldAdvisor({
        rung: chosen.rung,
        what_she_said: ctx.session.assessments.at(-1)?.evidence.transcript ?? "",
        topic_category: topic.category,
        eligible: level.map((p) => ({ scaffold_id: p.scaffold.id, cue_id: p.cue!.cue_id, citations: p.citations, what_it_does: p.cue!.kind === "photo" ? "mentions a photograph a family member shared" : "names someone she has said was part of it" })),
      });
      const offered = level.find((p) => p.cue!.cue_id === pick.cue_id);
      if (offered && pick.citations.length > 0 && pick.citations.every((c) => offered.citations.includes(c))) {
        plan = offered;
        decidedBy = "muse_spark";
      }
    } catch {
      // The deterministic choice stands.
    }
  }

  ctx.session.last_recognition = plan.recognition ?? ctx.session.last_recognition;
  return {
    rung: chosen.rung,
    scaffold_id: plan.scaffold.id,
    slot_ids: plan.slot_ids,
    citations: plan.citations,
    cue: plan.cue,
    family_sourced_limit: topic.family_sourced,
    rejected,
    retrieval_hints_used: hints.filter((h) => chosen!.plans.some((p) => p.cue?.cue_id === h.cue_id)).map(({ cue_id, effective, ineffective }) => ({ cue_id, effective, ineffective })),
    decided_by: decidedBy,
  };
};

// --- tool 7 ------------------------------------------------------------------------------------------------------

/** Slots the joint setup fills. They need a valid policy token, not a citation: they are what was agreed, not something remembered. */
const SETUP_SLOTS = ["name", "set_up_by", "caregiver", "emergency_number"] as const;
const EDGE_SLOTS = new Set(["relation", "option_a", "option_b"]);
const rungOf = (scriptId: string): number | null => (/^LADDER-([1-5])(-|$)/.exec(scriptId)?.[1] ? Number(/^LADDER-([1-5])/.exec(scriptId)![1]) : null);

export const render_prompt: ToolImpl<"render_prompt"> = async (input, ctx) => {
  if (ctx.session.topic?.topic_id !== input.topic_id) throw new GateError("evidence", "get_next_recall_topic has not chosen this topic");
  const policy = ctx.setup.current();
  await ctx.gate.requireToken(ctx.session.policy_token_id, input.topic_id, ctx.clock.iso());

  const line = allScriptLines(ctx.script).find((l) => l.id === input.scaffold_id);
  if (!line) throw new GateError("evidence", `"${input.scaffold_id}" is not a line in the reviewed call script; Relay says nothing else`);
  const evidence = new Map(ctx.gate.requireVerifiedEvidence(input.citations).map((v) => [v.id, v]));

  const displayName = async (personId: string): Promise<string> => {
    const node = await ctx.graph.getNode(personId);
    if (node?.type !== "Person") throw new GateError("identity", `"${personId}" is not a known person`);
    return node.props.display_name;
  };

  const values: Record<string, string> = {};
  const factIds: Record<string, string[]> = {};
  for (const slot of slotsOf(line.text)) {
    if ((SETUP_SLOTS as readonly string[]).includes(slot)) {
      if (slot in input.slot_ids) throw new GateError("evidence", `"{${slot}}" is filled from the joint setup, never by a caller`);
      values[slot] = slot === "emergency_number" ? policy.safety.emergency_number : await displayName(slot === "name" ? policy.person_id : slot === "set_up_by" ? policy.relay_set_up_by : policy.safety.designated_caregivers[0]!.person_id);
      factIds[slot] = [];
      continue;
    }
    const id = input.slot_ids[slot];
    // Rule 6: a fact with no citation is not said.
    if (!id || !input.citations.includes(id) || !evidence.has(id)) throw new GateError("evidence", `"{${slot}}" has no cited, verified fact to fill it`);
    if (EDGE_SLOTS.has(slot)) {
      const saidAs = (await ctx.graph.getEdge(id))?.props.said_as;
      if (typeof saidAs !== "string" || saidAs === "") throw new GateError("evidence", `"{${slot}}": nobody has said what this relationship is`);
      values[slot] = saidAs;
    } else {
      const node = await ctx.graph.getNode(id);
      if (!node) throw new GateError("evidence", `"{${slot}}": ${id} is not a node`);
      const expected = slot === "topic" ? [ctx.session.topic.topic_id] : null;
      if (expected && !expected.includes(id)) throw new GateError("evidence", `"{topic}" is the topic of this call and nothing else`);
      values[slot] = slot === "topic" ? ctx.session.topic.spoken_as : (spokenNames(node)[0] ?? "");
      if ((slot === "cue" || slot === "person" || slot === "author") && node.type !== "Person") throw new GateError("evidence", `"{${slot}}" must be a person`);
    }
    factIds[slot] = [id];
  }
  for (const slot of Object.keys(input.slot_ids)) if (!slotsOf(line.text).includes(slot)) throw new GateError("evidence", `${line.id} has no slot "{${slot}}"`);

  // Attribution (section 6.2). "You told me" only when the speaker is her; anyone else's claim is phrased with
  // its author; and a mismatch fails closed.
  const author = input.slot_ids.author ?? null;
  for (const id of input.citations) {
    const node = await ctx.graph.getNode(id);
    if (node?.type !== "EpisodicClaim" && !(node?.type === "Artifact" && node.props.kind !== "setup_record")) continue;
    const speaker = evidence.get(id)!.speaker;
    const hers = speaker === policy.person_id && evidence.get(id)!.patient_confirmed;
    if (!hers && author !== speaker) throw new GateError("evidence", `${id} is ${speaker}'s account, so it can only be said attributed to them`);
    if (hers && author !== null) throw new GateError("evidence", `${id} is her own account; it cannot be attributed to ${author}`);
    if (!hers && containsPhrase(line.text, "you told me")) throw new GateError("evidence", `"You told me" is said only of her own words; ${id} is ${speaker}'s`);
  }
  if (author !== null && !endsInOpenQuestion(line.text)) throw new GateError("evidence", "a family-sourced cue ends in an open question, never a yes/no one (rule 13)");

  let text: string;
  try {
    text = fill(line, values);
  } catch (e) {
    if (e instanceof ScriptError) throw new GateError("evidence", e.message);
    throw e;
  }
  const findings = [...lintLines([{ id: line.id, text, surface: "call" }], ctx.script.banned), ...lintConduct([{ id: line.id, text, surface: "call" }], ctx.script.conduct)];
  if (findings.length > 0) throw new GateError("evidence", `the line contains language Relay never uses: "${findings[0]!.phrase}" (rule ${findings[0]!.rule})`);

  const segments: ToolOutput<"render_prompt">["segments"] = [];
  let rest = line.text;
  for (const slot of slotsOf(line.text)) {
    const [head, ...tail] = rest.split(`{${slot}}`);
    if (head) segments.push({ text: head, kind: "connective", citation_ids: [] });
    segments.push({ text: values[slot]!, kind: factIds[slot]!.length > 0 ? "fact" : "connective", citation_ids: factIds[slot]! });
    rest = tail.join(`{${slot}}`);
  }
  if (rest) segments.push({ text: rest, kind: "connective", citation_ids: [] });

  const prompt: ToolOutput<"render_prompt"> = { prompt_id: `prompt:${ctx.session.session_id}:${ctx.session.prompts.length + 1}`, script_id: line.id, voice: "relay", text, rung: rungOf(line.id), segments };
  ctx.session.prompts.push(prompt);
  return prompt;
};
