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
 *   2. Closed vocabulary. A relation comes from relations.ts or is rejected, and
 *      a word of hers that means one relation ("daughter") is never filed as another.
 *   3. Said versus worked out. A fact the person stated takes their standing
 *      (participant_confirmed / family_confirmed). Anything derived - "she lives
 *      with my granddaughter", so presumably her mother - is written as
 *      `inferred`, cites what it was derived from, and is never spoken or
 *      retrieved until a person confirms it. "Stated" is read off the words, not
 *      taken from the proposer: the tie needs a word of hers that carries it, and
 *      anyone it points at by id has to be in the words or in the room (the
 *      speaker, her, whoever the question was about). Otherwise it is `inferred`.
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
import { EDGE_SIGNATURES, patientConfirmed, type Confirmation, type EpistemicStatus, type GraphEdge, type GraphNode, type MediaSpan, type NodeType, type Provenance } from "@/lib/graph/types";
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
  /** Two people said different things. Both are set aside until a person resolves it; Recall does not pick. */
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

/** The relation an everyday word means, or null. Own keys only: "constructor" is not a kin word. */
const kinOf = (word: string): Relation | null => (Object.hasOwn(KIN_WORDS, word) ? KIN_WORDS[word]! : null);
/** Relations people have an everyday word for. One of these is "stated" only if that word was said. */
const KIN_RELATIONS: ReadonlySet<Relation> = new Set(Object.values(KIN_WORDS));

export async function applyAnswer(question: Question, answer: Answer, proposals: readonly ProposedFact[], deps: ApplyDeps): Promise<ApplyResult> {
  const { graph, policy } = deps;
  const isParticipant = answer.by === policy.person_id;
  if (!isParticipant && !policy.approved_people.includes(answer.by)) {
    throw new UngroundedFactError(`${answer.by} is neither her nor an approved person, so their answer cannot add to her graph`);
  }
  const standing: EpistemicStatus = isParticipant ? "participant_confirmed" : "family_confirmed";
  const words = tokens(answer.text);

  // ---- every check first; nothing is written until all of them pass --------------------------------
  // Everything written is theirs, and a story is SPOKEN_BY them: being approved on paper is not being a person in the graph.
  if ((await graph.getNode(answer.by))?.type !== "Person") throw new UngroundedFactError(`${answer.by} is not a person in the graph, so nothing can be recorded as said by them`);
  // One answer, one artifact. A reused id would have this answer's facts cite the first answer's words as their source.
  const artifactId = `artifact:answer:${answer.answer_id}`;
  const held = await graph.getNode(artifactId);
  if (held && !(held.type === "Artifact" && held.props.kind === "answer" && held.props.text === answer.text && held.prov.author === answer.by)) {
    throw new UngroundedFactError(`answer id "${answer.answer_id}" already holds other words or another speaker; an answer id is never reused`);
  }

  type Resolved = { id: string; type: NodeType; node: GraphNode | null; name: string };
  const resolve = async (ref: EntityRef, where: string): Promise<Resolved> => {
    if ("id" in ref) {
      const node = await graph.getNode(ref.id);
      if (!node) throw new UngroundedFactError(`${where}: "${ref.id}" is not in the graph`);
      return { id: node.id, type: node.type, node, name: node.label };
    }
    // The message names what was proposed, never what she said: her words do not go to an error log (rule 8).
    if (!saidLiterally(ref.name, words)) throw new UngroundedFactError(`${where}: "${ref.name}" does not appear in what was said`);
    const prefix = PREFIX[ref.type];
    if (!prefix) throw new UngroundedFactError(`${where}: an answer cannot create a ${ref.type}`);
    // The join: if she named Anika last week and this face is Anika, it is the same person, not a second one.
    const existing = (await graph.nodesOfType(ref.type)).find((n) => namesOf(n).some((name) => slug(name) === slug(ref.name)));
    return { id: existing?.id ?? `${prefix}:${slug(ref.name)}`, type: ref.type, node: existing ?? null, name: ref.name };
  };
  // Who an answer may point at by id without naming them: whoever is speaking, her, and whoever the question was about.
  // Anyone else has to be in the words - or the tie to them was worked out, not said.
  const inTheRoom = new Set([answer.by, policy.person_id, ...(question.gap.identified_as ? [question.gap.identified_as.node_id] : [])]);
  const pointedAt = (ref: EntityRef, r: Resolved): boolean => !("id" in ref) || inTheRoom.has(r.id) || (r.node !== null && namesOf(r.node).some((name) => saidLiterally(name, words)));

  type Planned = { where: string; make: GraphNode[]; edge: Omit<GraphEdge, "prov"> | null; status: EpistemicStatus; derived: boolean };
  const plan: Planned[] = [];
  const stub = (r: Resolved): GraphNode[] =>
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
      plan.push({ where, make: stub(target), status: standing, derived: false, edge: { id: edgeId("IDENTIFIED_AS", question.gap.cluster_id, target.id), type: "IDENTIFIED_AS", from: question.gap.cluster_id, to: target.id, props: {} } });
    } else if (p.kind === "relate") {
      const [from, to] = [await resolve(p.from, where), await resolve(p.to, where)];
      assertRelation(p.relation, from.type, to.type);
      if (p.said_as !== null && !saidLiterally(p.said_as, words)) throw new UngroundedFactError(`${where}: "${p.said_as}" is offered as their word but was not said`);
      // Her word for a tie decides what the tie is. "daughter" filed as a sibling contradicts her, so it is refused, not downgraded.
      const meant = p.said_as === null ? [] : tokens(p.said_as).flatMap((w) => kinOf(w) ?? []);
      if (meant.length > 0 && !meant.includes(p.relation)) throw new UngroundedFactError(`${where}: the word offered as theirs means "${meant[0]}", not "${p.relation}"`);
      // "Stated" is read off the words, never taken on the proposer's say-so: a word of theirs has to carry the tie (for kin,
      // the word that means it), and nobody may be pulled in by id who was neither named nor in the room.
      const carried = p.said_as !== null && (!KIN_RELATIONS.has(p.relation) || meant.includes(p.relation));
      const stated = p.basis === "stated" && carried && pointedAt(p.from, from) && pointedAt(p.to, to);
      // The same tie may already be held under another id (the seed mints `RELATED_TO:from->to`). Saying it again confirms that edge.
      const same = from.node && to.node ? (await graph.edgesOf(from.id)).find((e) => e.type === KNOWLEDGE_EDGE && e.from === from.id && e.to === to.id && e.props.relation === p.relation) : undefined;
      const id = same?.id ?? `${KNOWLEDGE_EDGE}:${p.relation}:${from.id}->${to.id}`;
      // Worked out, not said: written as an inference and kept out of everything until a person confirms it.
      plan.push({ where, make: [...stub(from), ...stub(to)], status: stated ? standing : "inferred", derived: !stated, edge: { id, type: KNOWLEDGE_EDGE, from: from.id, to: to.id, props: { relation: p.relation, said_as: p.said_as } } });
    } else {
      const about = await Promise.all(p.about.map((ref) => resolve(ref, where)));
      const storyId = `story:${answer.answer_id}`;
      // Her telling, word for word. Recall never writes, tidies, or summarizes it (rule 1).
      plan.push({ where, make: [{ id: storyId, type: "Story", label: answer.text.slice(0, 60), props: { text: answer.text } } as unknown as GraphNode, ...about.flatMap(stub)], status: standing, derived: false, edge: null });
      for (const a of about) plan.push({ where, make: [], status: standing, derived: false, edge: { id: edgeId("ABOUT", storyId, a.id), type: "ABOUT", from: storyId, to: a.id, props: {} } });
      plan.push({ where, make: [], status: standing, derived: false, edge: { id: edgeId("SPOKEN_BY", storyId, answer.by), type: "SPOKEN_BY", from: storyId, to: answer.by, props: {} } });
    }
  }

  // The shape of every planned edge, against the same table both stores are built from. Checked here so that a store is
  // never the one to refuse an edge halfway through the write, with the answer and half its facts already in the graph.
  const planned = new Map(plan.flatMap((step) => step.make.map((n) => [n.id, n.type] as const)));
  for (const { where, edge } of plan) {
    if (!edge) continue;
    const ends: Array<NodeType | null> = [];
    for (const end of [edge.from, edge.to]) ends.push(planned.get(end) ?? (await graph.getNode(end))?.type ?? null);
    const [a, b] = ends as [NodeType | null, NodeType | null];
    if (!a || !b) throw new UngroundedFactError(`${where}: "${a ? edge.to : edge.from}" is not in the graph`);
    if (!EDGE_SIGNATURES[edge.type].some(([f, t]) => f === a && t === b)) throw new UngroundedFactError(`${where}: ${edge.type} cannot connect ${a} -> ${b}`);
  }

  // ---- write ------------------------------------------------------------------------------------------
  const prov =(status: EpistemicStatus, derived: boolean): Provenance => ({
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
  if (!held) await graph.putNode({ id: artifactId, type: "Artifact", label: "Answer", props: { kind: "answer", text: answer.text, alt: null }, prov: prov(standing, false) });
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
      // Someone already said this face is someone else. Recall does not choose between people: every name is set aside.
      // A rival already in dispute still counts - or a third name, arriving after two had cancelled out, would read as the answer.
      const { from, to, id } = step.edge;
      const rivals = (await graph.edgesOf(from)).filter((e) => e.type === "IDENTIFIED_AS" && e.from === from && e.to !== to);
      if (rivals.length > 0) {
        for (const rival of rivals.filter((e) => e.prov.status !== "disputed")) {
          await graph.confirm(rival.id, { ...confirmation, stance: "disputes" });
          result.disputed.push(rival.id);
        }
        result.disputed.push(id);
        status = "disputed";
      }
    }
    await graph.putEdge({ ...step.edge, prov: prov(status, step.derived) });
    if (status !== "disputed") result.created.push(step.edge.id);
  }
  return result;
}

// --- a deterministic proposer ---------------------------------------------------------------------------

/**
 * Capitalized words that open a sentence without being a name. Lexical, and incomplete by nature - which is why the reader
 * below also refuses to choose between two names nothing connects: an opener this list misses ("Looks like Maya.") makes a
 * second "name", and then nothing is proposed. Words that are also given names (Will, May, Rose, Grace) are left out on purpose.
 */
const NOT_A_NAME = new Set([
  ...["I", "I'm", "I've", "I'd", "I'll", "We", "We're", "We've", "You", "You're", "She", "She's", "He", "He's", "They", "They're", "It", "It's", "That", "That's", "This", "These", "Those", "There", "There's", "Here", "Here's"],
  ...["The", "A", "An", "My", "Our", "Your", "Her", "His", "Their", "Mine", "Who", "Who's", "What", "What's", "Where", "When", "Why", "How", "Which"],
  ...["And", "But", "Or", "So", "Well", "Oh", "Ah", "Um", "Uh", "Er", "Hmm", "Hm", "Mm", "Okay", "Ok", "Yes", "Yeah", "Yep", "No", "Nope", "Sure", "Right", "Now", "Then", "Also", "Just", "Only", "Look", "Looks", "See", "Let", "Let's", "Wait", "Gosh", "Goodness", "Wow", "Hey", "Hi", "Hello", "Please", "Thanks", "Thank", "Sorry"],
  ...["Definitely", "Certainly", "Surely", "Absolutely", "Obviously", "Clearly", "Actually", "Really", "Honestly", "Of", "Course", "Probably", "Maybe", "Perhaps", "Possibly", "Always", "Never", "Sometimes", "Still", "Again", "Every", "Each", "All", "Some", "Both", "Not"],
  ...["Is", "Are", "Was", "Were", "Am", "Do", "Does", "Did", "Has", "Have", "Had", "Can", "Could", "Would", "Should", "Might", "Must", "Think", "Guess", "Seems"],
  ...["In", "On", "At", "With", "From", "For", "To", "By", "About", "After", "Before", "During", "Near", "Around"],
]);

interface NameRun {
  name: string;
  start: number;
  end: number;
}

/** Runs of capitalized words, as she said them, and where in the text: "Cape May", "Maya". A word that is not a name ends a run. */
function namesIn(text: string): NameRun[] {
  const out: NameRun[] = [];
  let run: NameRun | null = null;
  for (const m of text.matchAll(/\S+/gu)) {
    const raw = m[0];
    const word = raw.replace(/^[^\p{L}]+|[^\p{L}']+$/gu, "");
    const start = m.index + (raw.length - raw.replace(/^[^\p{L}]+/u, "").length);
    const isName = /^\p{Lu}[\p{L}'-]*$/u.test(word) && !NOT_A_NAME.has(word);
    if (isName) run = { name: run ? `${run.name} ${word}` : word, start: run ? run.start : start, end: start + word.length };
    if (run && (!isName || /[.!?,;]$/.test(raw))) {
      out.push(run);
      run = null;
    }
  }
  if (run) out.push(run);
  return out;
}

/**
 * A denial ("that's not Priya"), a guess ("maybe Priya", "looks like Priya"), a choice ("Maya or Priya"), or a question - hers,
 * or Recall's own read back. A name in any of these is not her saying who it is, so the reader proposes nothing and the gap is
 * simply raised again another day. This is a match on her literal words, used only to decide NOT to write; it is never stored
 * and says nothing about her (rule 4).
 */
const DENIES = new Set(["no", "not", "nope", "never", "neither", "nor", "none", "nobody", "cannot", "isnt", "wasnt", "arent", "werent", "dont", "doesnt", "didnt", "cant", "couldnt", "wouldnt", "shouldnt", "hasnt", "havent", "aint"]);
const HEDGES = ["maybe", "perhaps", "probably", "possibly", "might", "or", "either", "unsure", "guess", "suppose", "think", "believe", "seem", "seems", "dunno", "could be", "may be", "look like", "looks like", "kind of", "sort of"];

function inDoubt(text: string): boolean {
  if (text.includes("?")) return true;
  const heard = tokens(text.replace(/[‘’]/g, "'"));
  if (heard.some((w) => DENIES.has(w) || w.endsWith("n't"))) return true;
  const line = ` ${heard.join(" ")} `;
  return HEDGES.some((h) => line.includes(` ${h} `));
}

const RUN = "\\p{Lu}[\\p{L}'-]*(?:\\s+\\p{Lu}[\\p{L}'-]*)*";
// No `i` flag, on purpose. Under /iu, \p{Lu} is case-folded and matches ANY letter: "my daughter on the beach" named a person
// called "on". The case-insensitive parts are spelled out, and the kin word is looked up in code.
const TIE = new RegExp(`\\b([Mm][Yy]|[Hh][Ee][Rr])\\s+(\\p{L}+)\\s+(${RUN})`, "gu");
// "That's Maya with my sister Priya": the name after "that's / this is / it's" is who the photo shows.
const SUBJECT = new RegExp(`\\b(?:[Tt]hat['’]s|[Tt]hat\\s+is|[Tt]his\\s+is|[Ii]t['’]s|[Ii]t\\s+is)\\s+(?:(?:[Mm][Yy]|[Hh][Ee][Rr])\\s+\\p{L}+\\s+)?(${RUN})`, "u");
const KIN_PHRASE = new RegExp(`\\b(my|her)\\s+(${Object.keys(KIN_WORDS).join("|")})\\b`, "iu");

/**
 * Reads the two things people most often say about a photo without any model: who someone is to
 * them ("my daughter Maya", "her sister Priya"), and a name on its own. It proposes nothing it
 * cannot point to in the words, and when the words could be read two ways it proposes nothing at
 * all. A model proposer can read far more - through the same door.
 */
export class LexicalAnswerInterpreter implements AnswerInterpreter {
  readonly label = "lexical: kinship phrases and names, from the literal words";

  async interpret(question: Question, answer: Answer, speaker: { id: string; is_participant: boolean }, participantId: string): Promise<ProposedFact[]> {
    const text = answer.text;
    // Names are read off capital letters, so a transcript with no lower case in it ("THAT'S MAYA") has none to read.
    if (inDoubt(text) || !/\p{Ll}/u.test(text)) return [];
    const facts: ProposedFact[] = [];
    const runs = namesIn(text);
    const possessive = (name: string): boolean => /'s?$/.test(name); // "Maya's friend" is not Maya
    /** Names said earlier in the same sentence as position `at`. */
    const namedBefore = (at: number): NameRun[] => {
      const sentence = Math.max(text.lastIndexOf(".", at), text.lastIndexOf("!", at), text.lastIndexOf(";", at)) + 1;
      return runs.filter((r) => r.start >= sentence && r.end <= at);
    };
    // "her", said by her, is somebody else. Said by family it is her - unless a name came first ("Maya and her daughter Anika"),
    // when it is most likely that person. Either way Recall does not guess: no tie is proposed.
    const herIsHer = (at: number, except: string | null): boolean => !speaker.is_participant && namedBefore(at).every((r) => except !== null && slug(r.name) === slug(except));

    // "my daughter Maya" ties Maya to the speaker; "her sister Priya", said by family, ties Priya to her.
    const ties: Array<{ name: string; start: number; end: number }> = [];
    let kinPhrases = 0;
    for (const m of text.matchAll(TIE)) {
      const [whole, whose, word, tail] = m as unknown as [string, string, string, string];
      const relation = kinOf(word.toLowerCase());
      if (!relation) continue;
      kinPhrases++;
      const at = m.index + whole.length - tail.length;
      const run = runs.find((r) => r.start <= at && at < r.end); // none: "my daughter I ..." - an opener, not a name
      if (!run || possessive(run.name)) continue;
      if (whose.toLowerCase() === "her" && !herIsHer(m.index, null)) continue;
      const name = text.slice(at, run.end);
      facts.push({ kind: "relate", from: { id: whose.toLowerCase() === "my" ? speaker.id : participantId }, relation, to: { type: "Person", name }, said_as: word.toLowerCase(), basis: "stated" });
      ties.push({ name, start: m.index, end: run.end });
    }
    const tieOver = (r: NameRun): { name: string } | undefined => ties.find((t) => r.start < t.end && r.end > t.start);

    // "She's my sister" about someone already named: the tie is to the person the question was about.
    const about = question.gap.identified_as;
    if (question.gap.kind === "how_related" && about && kinPhrases === 0) {
      const m = text.match(KIN_PHRASE);
      if (m && (m[1]!.toLowerCase() === "my" || herIsHer(m.index!, about.name))) {
        facts.push({ kind: "relate", from: { id: m[1]!.toLowerCase() === "my" ? speaker.id : participantId }, relation: KIN_WORDS[m[2]!.toLowerCase()]!, to: { id: about.node_id }, said_as: m[2]!.toLowerCase(), basis: "stated" });
      }
    }

    // Naming what the photo shows - also when the family already has (invite_her_word): her saying it is what makes it hers.
    if (question.gap.kind === "unidentified" || question.gap.kind === "invite_her_word") {
      const nameOf = (r: NameRun): string => tieOver(r)?.name ?? r.name;
      const loose = new Set(runs.filter((r) => !tieOver(r)).map((r) => r.name));
      const s = SUBJECT.exec(text);
      const subjectAt = s ? s.index + s[0].length - s[1]!.length : -1;
      const subject = runs.find((r) => r.start <= subjectAt && subjectAt < r.end);
      let name: string | undefined;
      // Two names that nothing in the words connects: Recall cannot tell which one this is, so it does not pick.
      if (loose.size <= 1 && !runs.some((r) => possessive(r.name))) {
        const said = [...new Set(runs.map(nameOf))];
        if (question.expects !== "Person") name = [...loose][0]; // someone tied to the speaker is a person, not the place
        else name = subject ? nameOf(subject) : said.length === 1 ? said[0] : undefined;
      }
      if (name) facts.unshift({ kind: "identify", as: { type: question.expects, name } });
    }
    return facts;
  }
}
