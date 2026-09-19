/**
 * An answer expands the graph - but only with what the person actually said.
 *
 * Something has to read "That's my daughter Maya" and propose facts. Today
 * that is a small lexical matcher; in the live demo it can be a model. Either
 * way it only PROPOSES. `applyAnswer` is the single guarded door, and it holds
 * any proposer - however fluent - to four rules:
 *
 *   1. Grounded. Every name in a proposed fact, and every word offered as hers
 *      ("daughter"), must literally appear in the answer. A model cannot add
 *      "Maya lives in Boston" unless she said Boston.
 *   2. Closed vocabulary. A relation comes from relations.ts or is rejected.
 *   3. Said versus worked out. A fact the person stated takes their standing
 *      (participant_confirmed / family_confirmed). Anything derived - "she lives
 *      with my granddaughter", so presumably her mother - is written as
 *      `inferred`, cites what it was derived from, and is never spoken or
 *      retrieved until a person confirms it.
 *   4. Sourced. Everything written cites one Artifact holding the literal
 *      words. All checks run before any write; a bad proposal leaves nothing.
 *
 * What is deliberately NOT an input and NOT stored: which rung of support the
 * question reached, how long she took, or whether she answered at all. There
 * is no record from which a memory score could ever be assembled.
 */
import { KIN_WORDS, KNOWLEDGE_EDGE, assertRelation, type Relation } from "@/lib/graph/relations";
import { edgeId } from "@/lib/graph/seed";
import type { GraphStore } from "@/lib/graph/store";
import { patientConfirmed, type Confirmation, type EpistemicStatus, type GraphEdge, type GraphNode, type MediaSpan, type NodeType, type Provenance } from "@/lib/graph/types";
import { tokens } from "@/lib/providers/transcription";
import type { AccessPolicy } from "@/lib/tools/policy";
import type { Question } from "./questions";

export interface Answer {
  answer_id: string;
  /** Who said it. Must be her, or an approved person. */
  by: string;
  /** Their literal words. Stored verbatim; never cleaned up. */
  text: string;
  at: string;
  /** Where in a recording the words are, when they were spoken rather than typed. */
  recording: { asset_id: string; media_hash: string; span: MediaSpan } | null;
}

/** Something already in the graph, or something the answer names for the first time. */
export type EntityRef = { id: string } | { type: NodeType; name: string };

export type ProposedFact =
  | { kind: "identify"; as: { type: NodeType; name: string } }
  | { kind: "relate"; from: EntityRef; relation: Relation; to: EntityRef; said_as: string | null; basis: "stated" | "inferred" }
  | { kind: "story"; about: EntityRef[] };

export interface AnswerInterpreter {
  readonly label: string;
  interpret(question: Question, answer: Answer, speaker: { id: string; is_participant: boolean }, participantId: string): Promise<ProposedFact[]>;
}

export class UngroundedFactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UngroundedFactError";
  }
}

export interface ApplyDeps {
  graph: GraphStore;
  policy: AccessPolicy;
}

export interface ApplyResult {
  answer_artifact_id: string;
  created: string[];
  confirmed: string[];
  /** Two people said different things. Both are set aside until a person resolves it; Relay does not pick. */
  disputed: string[];
}

const slug = (name: string): string => tokens(name).join("-");
const PREFIX: Partial<Record<NodeType, string>> = { Person: "person", Place: "place", Event: "event", Activity: "activity", PreferenceExpertise: "pref", Story: "story" };
const namesOf = (n: GraphNode): string[] => [n.label, ...(n.type === "Person" ? [n.props.display_name] : []), ...("aliases" in n.props ? n.props.aliases : [])];

function saidLiterally(phrase: string, answerWords: readonly string[]): boolean {
  const want = tokens(phrase);
  if (want.length === 0) return false;
  for (let i = 0; i + want.length <= answerWords.length; i++) if (want.every((w, k) => answerWords[i + k] === w)) return true;
  return false;
}

export async function applyAnswer(question: Question, answer: Answer, proposals: readonly ProposedFact[], deps: ApplyDeps): Promise<ApplyResult> {
  const { graph, policy } = deps;
  const isParticipant = answer.by === policy.person_id;
  if (!isParticipant && !policy.approved_people.includes(answer.by)) {
    throw new UngroundedFactError(`${answer.by} is neither her nor an approved person, so their answer cannot add to her graph`);
  }
  const standing: EpistemicStatus = isParticipant ? "participant_confirmed" : "family_confirmed";
  const words = tokens(answer.text);

  // ---- every check first; nothing is written until all of them pass --------------------------------
  const resolve = async (ref: EntityRef, where: string): Promise<{ id: string; type: NodeType; node: GraphNode | null; name: string }> => {
    if ("id" in ref) {
      const node = await graph.getNode(ref.id);
      if (!node) throw new UngroundedFactError(`${where}: "${ref.id}" is not in the graph`);
      return { id: node.id, type: node.type, node, name: node.label };
    }
    if (!saidLiterally(ref.name, words)) throw new UngroundedFactError(`${where}: "${ref.name}" does not appear in what was said ("${answer.text}")`);
    const prefix = PREFIX[ref.type];
    if (!prefix) throw new UngroundedFactError(`${where}: an answer cannot create a ${ref.type}`);
    // The join: if she named Anika last week and this face is Anika, it is the same person, not a second one.
    const existing = (await graph.nodesOfType(ref.type)).find((n) => namesOf(n).some((name) => slug(name) === slug(ref.name)));
    return { id: existing?.id ?? `${prefix}:${slug(ref.name)}`, type: ref.type, node: existing ?? null, name: ref.name };
  };

  type Planned = { make: GraphNode[]; edge: Omit<GraphEdge, "prov"> | null; status: EpistemicStatus; derived: boolean };
  const plan: Planned[] = [];
  const stub = (r: { id: string; type: NodeType; node: GraphNode | null; name: string }): GraphNode[] =>
    r.node
      ? []
      : ([
          {
            id: r.id,
            type: r.type,
            label: r.name,
            props: r.type === "Person" ? { display_name: r.name, role: "known" } : r.type === "PreferenceExpertise" ? { text: r.name } : r.type === "Event" ? { wikidata_id: null, date: null } : { aliases: [] },
          } as unknown as GraphNode,
        ]);

  for (const [i, p] of proposals.entries()) {
    const where = `proposal ${i + 1} (${p.kind})`;
    if (p.kind === "identify") {
      if (p.as.type !== question.expects) throw new UngroundedFactError(`${where}: this question is about a ${question.expects}, not a ${p.as.type}`);
      const target = await resolve(p.as, where);
      plan.push({ make: stub(target), status: standing, derived: false, edge: { id: edgeId("IDENTIFIED_AS", question.gap.cluster_id, target.id), type: "IDENTIFIED_AS", from: question.gap.cluster_id, to: target.id, props: {} } });
    } else if (p.kind === "relate") {
      const [from, to] = [await resolve(p.from, where), await resolve(p.to, where)];
      assertRelation(p.relation, from.type, to.type);
      if (p.said_as !== null && !saidLiterally(p.said_as, words)) throw new UngroundedFactError(`${where}: "${p.said_as}" is offered as their word but was not said`);
      const id = `${KNOWLEDGE_EDGE}:${p.relation}:${from.id}->${to.id}`;
      // Worked out, not said: written as an inference and kept out of everything until a person confirms it.
      plan.push({ make: [...stub(from), ...stub(to)], status: p.basis === "stated" ? standing : "inferred", derived: p.basis === "inferred", edge: { id, type: KNOWLEDGE_EDGE, from: from.id, to: to.id, props: { relation: p.relation, said_as: p.said_as } } });
    } else {
      const about = await Promise.all(p.about.map((ref) => resolve(ref, where)));
      const storyId = `story:${answer.answer_id}`;
      // Her telling, word for word. Relay never writes, tidies, or summarizes it (rule 1).
      plan.push({ make: [{ id: storyId, type: "Story", label: answer.text.slice(0, 60), props: { text: answer.text } } as unknown as GraphNode, ...about.flatMap(stub)], status: standing, derived: false, edge: null });
      for (const a of about) plan.push({ make: [], status: standing, derived: false, edge: { id: edgeId("ABOUT", storyId, a.id), type: "ABOUT", from: storyId, to: a.id, props: {} } });
      plan.push({ make: [], status: standing, derived: false, edge: { id: edgeId("SPOKEN_BY", storyId, answer.by), type: "SPOKEN_BY", from: storyId, to: answer.by, props: {} } });
    }
  }

  // ---- write ------------------------------------------------------------------------------------------
  const artifactId = `artifact:answer:${answer.answer_id}`;
  const prov = (status: EpistemicStatus, derived: boolean): Provenance => ({
    source_id: artifactId,
    source_class: "discovery_answer",
    asset_id: answer.recording?.asset_id ?? null,
    media_hash: answer.recording?.media_hash ?? null,
    span: answer.recording?.span ?? null,
    observed_at: answer.at,
    author: answer.by,
    extraction_method: derived ? "rule_deduction" : "answer_interpretation",
    confidence: 1,
    audience_scope: [...policy.approved_audiences],
    expires_at: null,
    supersedes: [],
    contradicts: [],
    status,
    patient_confirmed: patientConfirmed(status),
    confirmations: [],
  });
  if (!(await graph.getNode(artifactId))) {
    await graph.putNode({ id: artifactId, type: "Artifact", label: "Answer", props: { kind: "answer", text: answer.text, alt: null }, prov: prov(standing, false) });
  }
  const confirmation: Confirmation = { by: answer.by, role: isParticipant ? "participant" : "family", stance: "confirms", source_id: artifactId, at: answer.at };
  const result: ApplyResult = { answer_artifact_id: artifactId, created: [], confirmed: [], disputed: [] };

  for (const step of plan) {
    for (const node of step.make) {
      if (await graph.getNode(node.id)) continue;
      await graph.putNode({ ...node, prov: prov(standing, false) } as GraphNode);
      result.created.push(node.id);
    }
    if (!step.edge) continue;
    if (await graph.getEdge(step.edge.id)) {
      // Said again, or now said by someone else: the same fact gains a source. "Confirmed by Maya."
      if (!step.derived) {
        await graph.confirm(step.edge.id, confirmation);
        result.confirmed.push(step.edge.id);
      }
      continue;
    }
    let status = step.status;
    if (step.edge.type === "IDENTIFIED_AS") {
      // Someone already said this face is someone else. Relay does not choose between people: both are set aside.
      const rival = (await graph.edgesOf(step.edge.from)).find((e) => e.type === "IDENTIFIED_AS" && e.from === step.edge!.from && e.to !== step.edge!.to && e.prov.status !== "disputed");
      if (rival) {
        await graph.confirm(rival.id, { ...confirmation, stance: "disputes" });
        result.disputed.push(rival.id, step.edge.id);
        status = "disputed";
      }
    }
    await graph.putEdge({ ...step.edge, prov: prov(status, step.derived) });
    if (status !== "disputed") result.created.push(step.edge.id);
  }
  return result;
}

// --- a deterministic proposer ---------------------------------------------------------------------------

const NOT_A_NAME = new Set(["I", "We", "She", "He", "They", "It", "That's", "That", "This", "Yes", "No", "Oh", "The", "My", "Our", "Her", "His", "And", "But", "Well"]);

/** Runs of capitalized words, as she said them: "Cape May", "Maya". Sentence openers that are not names are skipped. */
function namesIn(text: string): string[] {
  const out: string[] = [];
  let run: string[] = [];
  const flush = (): void => {
    if (run.length > 0) out.push(run.join(" "));
    run = [];
  };
  for (const raw of text.split(/\s+/)) {
    const word = raw.replace(/^[^\p{L}]+|[^\p{L}']+$/gu, "");
    if (/^\p{Lu}[\p{L}'-]*$/u.test(word) && !(run.length === 0 && NOT_A_NAME.has(word))) run.push(word);
    else flush();
    if (/[.!?,;]$/.test(raw)) flush();
  }
  flush();
  return out;
}

/**
 * Reads the two things people most often say about a photo without any model: who someone is to
 * them ("my daughter Maya", "her sister Priya"), and a name on its own. It proposes nothing it
 * cannot point to in the words. A model proposer can read far more - through the same door.
 */
export class LexicalAnswerInterpreter implements AnswerInterpreter {
  readonly label = "lexical: kinship phrases and names, from the literal words";

  async interpret(question: Question, answer: Answer, speaker: { id: string; is_participant: boolean }, participantId: string): Promise<ProposedFact[]> {
    const facts: ProposedFact[] = [];
    const kin = Object.keys(KIN_WORDS).join("|");
    const tied = new Set<string>();
    // "my daughter Maya" ties Maya to the speaker; "her sister Priya", said by family, ties Priya to her.
    for (const m of answer.text.matchAll(new RegExp(`\\b(my|her)\\s+(${kin})\\s+(\\p{Lu}[\\p{L}'-]*)`, "giu"))) {
      const [, whose, word, name] = m as unknown as [string, string, string, string];
      const from = whose.toLowerCase() === "my" ? speaker.id : participantId;
      facts.push({ kind: "relate", from: { id: from }, relation: KIN_WORDS[word.toLowerCase()]!, to: { type: "Person", name }, said_as: word.toLowerCase(), basis: "stated" });
      tied.add(name);
    }
    // "She's my sister" about someone already named: the tie is to the person the question was about.
    const about = question.gap.identified_as;
    if (question.gap.kind === "how_related" && about && tied.size === 0) {
      const m = answer.text.match(new RegExp(`\\b(my|her)\\s+(${kin})\\b`, "iu"));
      if (m) facts.push({ kind: "relate", from: { id: m[1]!.toLowerCase() === "my" ? speaker.id : participantId }, relation: KIN_WORDS[m[2]!.toLowerCase()]!, to: { id: about.node_id }, said_as: m[2]!.toLowerCase(), basis: "stated" });
    }
    if (question.gap.kind === "unidentified") {
      const names = namesIn(answer.text);
      // For a face, the first person tied to the speaker is who it is; otherwise the first name said.
      const name = question.expects === "Person" ? ([...tied][0] ?? names[0]) : names.find((n) => !tied.has(n));
      if (name) facts.unshift({ kind: "identify", as: { type: question.expects, name } });
    }
    return facts;
  }
}
