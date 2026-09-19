/**
 * Turning a gap into something Recall can say, with a ladder of support.
 *
 *   open         "Who is this?"                                              retrieve when possible
 *   cue          "Anika mentioned this might be Maya. What comes to mind?"   someone else's word, said as theirs
 *   recognition  "Is this Maya or Priya?"                                    recognize when necessary
 *
 * It is the same least-support principle as the call's scaffold ladder, and
 * it moves on the same observable turn states (asked to repeat, no answer):
 * never on a judgment of her. Which rung was reached is not stored anywhere.
 * There is no rung that tells her who someone is. What she has said herself is
 * never asked again (gaps.ts), and what only the family has said is not
 * Recall's to state (rule 13; AGENTS.md section 6.1).
 *
 * Every line is a fixed template whose slots are filled from the graph, and
 * each segment says what kind of statement it is:
 *
 *   observation  cites something only OBSERVED, and is worded as an observation
 *                ("appears in many of your photos"). It never names or explains.
 *   fact         cites something SHE confirmed. Only these may be stated outright,
 *                or offered as a choice.
 *   attributed   cites something only the family has said. It is worded as theirs
 *                ("Anika mentioned..."), and the line ends in an open question -
 *                never a yes/no one, never a forced choice (rule 13).
 *
 * A rung that would need a fact nobody has given does not exist for that question.
 */
import type { GraphStore } from "@/lib/graph/store";
import { SPEAKABLE_AS_FACT, patientConfirmed, type EpistemicStatus, type NodeType } from "@/lib/graph/types";
import { endsInOpenQuestion } from "@/lib/script/lint";
import type { Gap } from "./gaps";

export const RUNG_LEVELS = ["open", "cue", "recognition"] as const;
export type RungLevel = (typeof RUNG_LEVELS)[number];

export interface Segment {
  text: string;
  kind: "connective" | "observation" | "fact" | "attributed";
  citation_ids: string[];
  /** For an `attributed` segment: the person whose account it is. Their name is in the same line. */
  attributed_to?: string;
}

export interface Rung {
  level: RungLevel;
  text: string;
  segments: Segment[];
}

export interface Question {
  question_id: string;
  gap: Gap;
  expects: NodeType;
  /** One photo, never a carousel (AGENTS.md section 10). The first by id, so it is stable. */
  show_photo_id: string | null;
  /** In order of support. Only rungs this question can honestly offer are present; `open` always is. */
  rungs: Rung[];
}

const say = (text: string): Segment => ({ text, kind: "connective", citation_ids: [] });
const observe = (text: string, ...ids: string[]): Segment => ({ text, kind: "observation", citation_ids: ids });
const fact = (text: string, ...ids: string[]): Segment => ({ text, kind: "fact", citation_ids: ids });
const attributed = (text: string, author: string, ...ids: string[]): Segment => ({ text, kind: "attributed", citation_ids: ids, attributed_to: author });
const rung = (level: RungLevel, segments: Segment[]): Rung => ({ level, segments, text: segments.map((s) => s.text).join("") });

const howMany = (n: number): string => (n >= 20 ? "many" : n >= 5 ? "several" : "some");
const OPEN_ASK: Record<NodeType, string> = { Person: "Who is this?", Place: "Where is this?", Event: "What was happening here?", Activity: "What is going on here?" } as Record<NodeType, string>;
/** Her own word, or not a claim about her life at all. Nothing else is Recall's to state without saying whose it is. */
const hers = (status: EpistemicStatus | undefined): boolean => status !== undefined && (patientConfirmed(status) || status === "reference");

export async function questionFor(gap: Gap, graph: GraphStore, participantId: string): Promise<Question> {
  const photos = (await graph.edgesOf(gap.cluster_id)).filter((e) => e.type === "DEPICTS" && e.to === gap.cluster_id).map((e) => e.from).sort();
  const rungs: Rung[] = [];
  const thing = gap.expects === "Person" ? "This person" : gap.expects === "Place" ? "This place" : "This";
  const recurs = observe(`${thing} appears in ${howMany(gap.photo_count)} of your photos.`, gap.cluster_id);
  const openAsk = rung("open", [recurs, say(` ${OPEN_ASK[gap.expects] ?? "What is this?"}`)]);

  const who = gap.identified_as;
  const naming = who ? await graph.getEdge(who.edge_id) : null;
  const saidByHer = hers(naming?.prov.status);
  // Only the family has said who this is. Their word is never Recall's to state: it is said as theirs, before an open question.
  const author = naming && !saidByHer && SPEAKABLE_AS_FACT.has(naming.prov.status) ? await graph.getNode(naming.prov.author) : null;
  const theySaid = who && author?.type === "Person" && SPEAKABLE_AS_FACT.has(author.prov.status) ? [attributed(author.props.display_name, author.id, author.id), say(" mentioned this might be "), attributed(who.name, author.id, who.edge_id), say(".")] : null;

  if (gap.kind === "unidentified" || !who) {
    // "Priya is in many of these too" - a name SHE has put to a face, in an observed co-occurrence. Real context, from the graph.
    let alongside: Segment[] = [];
    for (const companion of gap.together_with) {
      if (!hers((await graph.getEdge(companion.edge_id))?.prov.status)) continue;
      alongside = [say(" "), fact(companion.name, companion.edge_id), observe(` is in ${howMany(companion.shared_photos)} of these too.`, gap.cluster_id)];
      break;
    }
    rungs.push(rung("open", [recurs, ...alongside, say(` ${OPEN_ASK[gap.expects] ?? "What is this?"}`)]));
    if (gap.expects === "Person") {
      // People she has named herself, whom no photo has been matched to yet: honest candidates. A name only the family has
      // given is never an option in a forced choice (rule 13).
      const matched = new Set<string>();
      for (const c of await graph.nodesOfType("Cluster")) {
        for (const e of await graph.edgesOf(c.id)) if (e.type === "IDENTIFIED_AS" && SPEAKABLE_AS_FACT.has(e.prov.status)) matched.add(e.to);
      }
      const unmatched = (await graph.nodesOfType("Person"))
        .filter((p) => p.id !== participantId && !matched.has(p.id) && hers(p.prov.status) && p.props.role === "known")
        .sort((a, b) => (a.props.display_name < b.props.display_name ? -1 : 1))
        .slice(0, 2);
      if (unmatched.length === 2) {
        rungs.push(rung("recognition", [say("Is this "), fact(unmatched[0]!.props.display_name, unmatched[0]!.id), say(" or "), fact(unmatched[1]!.props.display_name, unmatched[1]!.id), say("?")]));
      }
    }
  } else if (gap.kind === "how_related") {
    if (saidByHer) rungs.push(rung("open", [say("This is "), fact(who.name, who.edge_id), say(". How do you know "), fact(who.name, who.edge_id), say("?")]));
    else if (theySaid && author) rungs.push(rung("open", [...theySaid, say(" How do you know "), attributed(who.name, author.id, who.edge_id), say("?")]));
    else rungs.push(openAsk); // nobody the name can honestly be attributed to: ask without it
  } else if (gap.kind === "tell_me_about") {
    // An invitation with no right answer. There is nothing to cue toward, so it has one rung.
    if (saidByHer) rungs.push(rung("open", [fact(who.name, who.edge_id), observe(` is in ${howMany(gap.photo_count)} of your photos.`, gap.cluster_id), say(" Would you like to tell me about this one?")]));
    else if (theySaid) rungs.push(rung("open", [...theySaid, say(" What would you like to tell me about this photo?")]));
    else rungs.push(rung("open", [recurs, say(" What would you like to tell me about this photo?")]));
  } else {
    // invite_her_word: the family told Recall who this is; she has not. She gets every chance to say it herself first, and
    // then hears the family's answer only as the family's. There is no forced choice with their answer in it, and nothing
    // tells her who it is: either could plant a memory that is not hers (rule 13; section 6.1).
    rungs.push(openAsk);
    if (theySaid) rungs.push(rung("cue", [...theySaid, say(" What comes to mind?")]));
  }

  return { question_id: `question:${gap.gap_id}`, gap, expects: gap.expects, show_photo_id: photos[0] ?? null, rungs };
}

/** The next rung of support, or null when there is no more to offer. Reaching the end is not a failure: Recall moves on. */
export function nextRung(question: Question, after: RungLevel): Rung | null {
  // By level, not by position: a question with no `cue` rung must still move on past it, never back to `open`.
  const reached = RUNG_LEVELS.indexOf(after);
  return question.rungs.find((r) => RUNG_LEVELS.indexOf(r.level) > reached) ?? null;
}

/**
 * The guarantee, checkable on any question: observations cite only observed things; facts cite only what SHE confirmed;
 * and what only the family has said is voiced as theirs, by name, before an open question. Throws rather than let an
 * inference, or a family member's account, be voiced as her memory.
 */
export async function assertSpeakable(question: Question, graph: GraphStore): Promise<void> {
  for (const r of question.rungs) {
    for (const s of r.segments) {
      if (s.kind === "connective") continue;
      if (s.citation_ids.length === 0) throw new Error(`"${s.text}" makes a claim with no citation`);
      const teller = s.kind === "attributed" ? await graph.getNode(s.attributed_to ?? "") : null;
      if (s.kind === "attributed") {
        if (teller?.type !== "Person" || !SPEAKABLE_AS_FACT.has(teller.prov.status)) throw new Error(`"${s.text}" is attributed to nobody Recall can name`);
        if (!r.text.includes(teller.props.display_name)) throw new Error(`"${s.text}" is ${teller.props.display_name}'s account, but the line does not say so`);
        if (!endsInOpenQuestion(r.text)) throw new Error(`"${r.text}" voices a family member's account, so it must end in an open question, never a yes/no one (rule 13)`);
      }
      for (const cited of s.citation_ids) {
        const prov = ((await graph.getNode(cited)) ?? (await graph.getEdge(cited)))?.prov;
        if (prov === undefined) throw new Error(`"${s.text}" cites "${cited}", which is not in the graph`);
        const status = prov.status;
        const ok = s.kind === "fact" ? hers(status) : s.kind === "attributed" ? SPEAKABLE_AS_FACT.has(status) : status === "observed" || SPEAKABLE_AS_FACT.has(status);
        if (!ok) throw new Error(`"${s.text}" is voiced as ${s.kind === "attributed" ? "someone's account" : `a ${s.kind}`} but "${cited}" is only ${status}`);
        // Attribution fails closed (section 6.2): the account has to be the named person's, by authorship or by their own confirmation.
        const theirs = cited === teller?.id || prov.author === teller?.id || prov.confirmations.some((c) => c.by === teller?.id && c.stance === "confirms");
        if (s.kind === "attributed" && !theirs) throw new Error(`"${s.text}" is attributed to ${teller!.id}, but "${cited}" is not their account`);
      }
    }
  }
}
