/**
 * Where Muse Spark does Relay's reasoning. Two jobs, both behind seams that
 * already existed, and in both the model only PROPOSES:
 *
 *   graph ingestion   read facts out of what a person said (AnswerInterpreter).
 *                     `applyAnswer` then holds every proposal to the person's literal words, the
 *                     closed relation list, and stated-versus-inferred. A fluent model gets no more
 *                     trust than the lexical matcher it replaces: an ungrounded name is rejected.
 *
 *   cue choice        which cue to offer, once Relay's ladder has ALREADY decided a rung is warranted and
 *                     the retrieval layer has no preference between the front-runners (ScaffoldAdvisor).
 *                     Spark never decides whether to climb, or to which rung - section 6.1 does. It picks
 *                     among the cues on offer and must cite verified node ids from that cue. Anything
 *                     else, or any failure, falls back to the deterministic choice. The model can never
 *                     widen what Relay may say.
 *
 * LIVE ONLY, SERVER ONLY. The judged path uses the deterministic implementations of both.
 */
import { z } from "zod";
import type { Answer, AnswerInterpreter, ProposedFact } from "@/lib/discovery/answers";
import type { Question } from "@/lib/discovery/questions";
import { RELATION_NAMES, type Relation } from "@/lib/graph/relations";
import type { GraphStore } from "@/lib/graph/store";
import { SPEAKABLE_AS_FACT } from "@/lib/graph/types";
import { scaffoldSystemPrompt } from "@/lib/script/persona";
import type { QuestionBank } from "@/lib/script/question-bank";
import type { ScaffoldAdvisor } from "@/lib/tools/context";
import type { MuseSpark } from "./spark";

const NAMED_TYPES = ["Person", "Place", "Event", "Activity", "PreferenceExpertise"] as const;
const entityRef = z.union([z.strictObject({ id: z.string() }), z.strictObject({ type: z.enum(NAMED_TYPES), name: z.string() })]);
const proposalsSchema = z.strictObject({
  facts: z.array(
    z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("identify"), as: z.strictObject({ type: z.enum(NAMED_TYPES), name: z.string() }) }),
      z.strictObject({ kind: z.literal("relate"), from: entityRef, relation: z.enum(RELATION_NAMES as [Relation, ...Relation[]]), to: entityRef, said_as: z.string().nullable(), basis: z.enum(["stated", "inferred"]) }),
      z.strictObject({ kind: z.literal("story"), about: z.array(entityRef) }),
    ]),
  ),
});

const INGEST_RULES = `You read what a person said about a photo and list the facts they stated, as JSON.

Rules, all of them strict:
- Use ONLY names and words that appear literally in what they said. Never add, complete, translate, or correct a name.
- "relation" reads source -> target as "target is source's <relation>": {"from": Susan, "relation": "child", "to": Maya} means Maya is Susan's child.
- "said_as" is the exact word they used for the relation ("daughter"), copied from their words, or null.
- "basis" is "stated" only if they said it outright. If you had to work it out - resolving "she", assuming who lives with whom, guessing a family tie - it is "inferred".
- Refer to someone already known by {"id": ...}; refer to someone new by {"type": ..., "name": ...}.
- "identify" says what the photo's subject is. Include it only if they named it.
- "story" only if they told something that happened, not just a name.
- If they stated nothing usable, return {"facts": []}. Never guess to be helpful.`;

export class MuseAnswerInterpreter implements AnswerInterpreter {
  readonly label = "Muse Spark (proposals only; applyAnswer decides)";

  constructor(
    private readonly spark: MuseSpark,
    private readonly graph: GraphStore,
  ) {}

  async interpret(question: Question, answer: Answer, speaker: { id: string; is_participant: boolean }, participantId: string): Promise<ProposedFact[]> {
    // Only confirmed people are offered as "known": the model is never shown an inference it could launder into a fact.
    const known = (await this.graph.nodesOfType("Person")).filter((p) => SPEAKABLE_AS_FACT.has(p.prov.status)).map((p) => ({ id: p.id, name: p.props.display_name }));
    const context = {
      question_was_about: question.expects,
      photo_subject_already_named: question.gap.identified_as?.name ?? null,
      speaker: { id: speaker.id, is_the_person_herself: speaker.is_participant },
      the_person_herself: participantId,
      known_people: known,
      allowed_relations: RELATION_NAMES,
      what_they_said: answer.text,
    };
    const out = await this.spark.structured("ingest_answer", proposalsSchema, [{ role: "system", content: INGEST_RULES }, { role: "user", content: JSON.stringify(context) }], { reasoning_effort: "low", max_completion_tokens: 4000 });
    return out.facts as ProposedFact[];
  }
}

// --- scaffold choice ---------------------------------------------------------------------------------------

const SCAFFOLD_RULES = `You help someone reach a memory of her own by choosing which ONE cue to offer her.

The kind of support has already been decided; you are only choosing between the cues in "eligible". Choose exactly one "cue_id" from "eligible", and cite node ids taken only from that cue's "citations". Prefer the cue most closely tied to what she just said. You are not assessing her; you are choosing what to say next.`;

/**
 * She is on the line, waiting, while this runs. Measured live, Spark answers in 3-4 s at "minimal"; past this
 * budget the deterministic choice is spoken instead. A slower, cleverer pick is worth less than not leaving her in silence.
 */
export const SCAFFOLD_ADVICE_BUDGET_MS = 6_000;

/** Spark picks among the cues on offer. The caller re-checks the pick and keeps its own choice if it is not one that was offered. */
export function museScaffoldAdvisor(spark: MuseSpark, bank: QuestionBank, budgetMs = SCAFFOLD_ADVICE_BUDGET_MS): ScaffoldAdvisor {
  return async (advice) => {
    const schema = z.strictObject({ cue_id: z.enum(advice.eligible.map((e) => e.cue_id) as [string, ...string[]]), citations: z.array(z.string()) });
    const system = scaffoldSystemPrompt(bank, advice.topic_category, SCAFFOLD_RULES);
    return spark.structured("select_cue", schema, [{ role: "system", content: system }, { role: "user", content: JSON.stringify(advice) }], { reasoning_effort: "minimal", max_completion_tokens: 2000, timeout_ms: budgetMs });
  };
}
