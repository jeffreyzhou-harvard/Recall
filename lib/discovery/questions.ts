/**
 * Turning a gap into something Relay can say, with a ladder of support.
 *
 *   open         "Who is this?"                  retrieve when possible
 *   cue          "This is someone in your family."
 *   recognition  "Is this Maya or Priya?"        recognize when necessary
 *   tell         "This is Maya, your daughter."  and move on - never a test
 *
 * It is the same least-support principle as the call's scaffold ladder, and
 * it moves on the same observable turn states (asked to repeat, no answer):
 * never on a judgment of her. Which rung was reached is not stored anywhere.
 *
 * Every line is a fixed template whose slots are filled from the graph, and
 * each segment says what kind of statement it is:
 *
 *   observation  cites something only OBSERVED, and is worded as an observation
 *                ("appears in many of your photos"). It never names or explains.
 *   fact         cites something a PERSON CONFIRMED. Only these may be stated.
 *
 * A rung that would need an unconfirmed fact does not exist for that question.
 * So Relay can only cue with "someone in your family", offer names to choose
 * from, or tell her who it is, when a person has actually told Relay that.
 */
import { relationOf } from "@/lib/graph/relations";
import type { GraphStore } from "@/lib/graph/store";
import { SPEAKABLE_AS_FACT, type NodeType } from "@/lib/graph/types";
import type { Gap } from "./gaps";

export const RUNG_LEVELS = ["open", "cue", "recognition", "tell"] as const;
export type RungLevel = (typeof RUNG_LEVELS)[number];

export interface Segment {
  text: string;
  kind: "connective" | "observation" | "fact";
  citation_ids: string[];
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
const rung = (level: RungLevel, segments: Segment[]): Rung => ({ level, segments, text: segments.map((s) => s.text).join("") });

const howMany = (n: number): string => (n >= 20 ? "many" : n >= 5 ? "several" : "some");
const OPEN_ASK: Record<NodeType, string> = { Person: "Who is this?", Place: "Where is this?", Event: "What was happening here?", Activity: "What is going on here?" } as Record<NodeType, string>;
const FAMILY = new Set(["child", "parent", "grandchild", "grandparent", "sibling", "spouse", "relative"]);

export async function questionFor(gap: Gap, graph: GraphStore, participantId: string): Promise<Question> {
  const photos = (await graph.edgesOf(gap.cluster_id)).filter((e) => e.type === "DEPICTS" && e.to === gap.cluster_id).map((e) => e.from).sort();
  const rungs: Rung[] = [];
  const thing = gap.expects === "Person" ? "This person" : gap.expects === "Place" ? "This place" : "This";
  const recurs = observe(`${thing} appears in ${howMany(gap.photo_count)} of your photos.`, gap.cluster_id);
  const companion = gap.together_with[0];
  // "Priya is in many of these too" - a confirmed name, in an observed co-occurrence. Real context, from the graph.
  const alongside = companion ? [say(" "), fact(companion.name, companion.person_id), observe(` is in ${howMany(companion.shared_photos)} of these too.`, gap.cluster_id)] : [];

  if (gap.kind === "unidentified") {
    rungs.push(rung("open", [recurs, ...alongside, say(` ${OPEN_ASK[gap.expects] ?? "What is this?"}`)]));
    if (gap.expects === "Person") {
      // People she or the family have named, whom no photo has been matched to yet: honest candidates.
      const matched = new Set<string>();
      for (const c of await graph.nodesOfType("Cluster")) {
        for (const e of await graph.edgesOf(c.id)) if (e.type === "IDENTIFIED_AS" && SPEAKABLE_AS_FACT.has(e.prov.status)) matched.add(e.to);
      }
      const unmatched = (await graph.nodesOfType("Person"))
        .filter((p) => p.id !== participantId && !matched.has(p.id) && SPEAKABLE_AS_FACT.has(p.prov.status) && p.props.role === "known")
        .sort((a, b) => (a.props.display_name < b.props.display_name ? -1 : 1))
        .slice(0, 2);
      if (unmatched.length === 2) {
        rungs.push(rung("recognition", [say("Is this "), fact(unmatched[0]!.props.display_name, unmatched[0]!.id), say(" or "), fact(unmatched[1]!.props.display_name, unmatched[1]!.id), say("?")]));
      }
    }
  } else if (gap.kind === "how_related") {
    const who = gap.identified_as!;
    rungs.push(rung("open", [say("This is "), fact(who.name, who.node_id, who.edge_id), say(". How do you know "), fact(who.name, who.node_id), say("?")]));
  } else if (gap.kind === "tell_me_about") {
    const who = gap.identified_as!;
    // An invitation with no right answer. There is nothing to cue toward, so it has one rung.
    rungs.push(rung("open", [fact(who.name, who.node_id, who.edge_id), observe(` is in ${howMany(gap.photo_count)} of your photos.`, gap.cluster_id), say(" Would you like to tell me about this one?")]));
  } else {
    // invite_her_word: the family told Relay who this is. The ladder gives her every chance to say it herself first.
    const who = gap.identified_as!;
    rungs.push(rung("open", [recurs, say(` ${OPEN_ASK.Person}`)]));
    const tie = (await graph.edgesOf(who.node_id)).find((e) => e.from === participantId && e.to === who.node_id && relationOf(e) !== null && SPEAKABLE_AS_FACT.has(e.prov.status));
    const relation = tie ? relationOf(tie)! : null;
    if (tie && relation && FAMILY.has(relation)) rungs.push(rung("cue", [fact("This is someone in your family.", tie.id)]));
    const other = (await graph.nodesOfType("Person"))
      .filter((p) => p.id !== who.node_id && p.id !== participantId && SPEAKABLE_AS_FACT.has(p.prov.status) && p.props.role === "known")
      .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
    if (other) {
      // Alphabetical, so which name comes first never hints at the answer.
      const pair = [{ name: who.name, id: who.node_id }, { name: other.props.display_name, id: other.id }].sort((a, b) => (a.name < b.name ? -1 : 1));
      rungs.push(rung("recognition", [say("Is this "), fact(pair[0]!.name, pair[0]!.id), say(" or "), fact(pair[1]!.name, pair[1]!.id), say("?")]));
    }
    const word = tie && typeof tie.props.said_as === "string" ? tie.props.said_as : null;
    rungs.push(rung("tell", [say("This is "), fact(who.name, who.node_id, who.edge_id), ...(tie && word ? [say(", your "), fact(word, tie.id)] : []), say(".")]));
  }

  return { question_id: `question:${gap.gap_id}`, gap, expects: gap.expects, show_photo_id: photos[0] ?? null, rungs };
}

/** The next rung of support, or null when there is no more to offer. Reaching the end is not a failure: Relay moves on. */
export function nextRung(question: Question, after: RungLevel): Rung | null {
  // By level, not by position: a question with no `cue` rung must still move on past it, never back to `open`.
  const reached = RUNG_LEVELS.indexOf(after);
  return question.rungs.find((r) => RUNG_LEVELS.indexOf(r.level) > reached) ?? null;
}

/**
 * The guarantee, checkable on any question: observations cite only observed things and facts cite only
 * what a person confirmed. Throws rather than let an inference be voiced.
 */
export async function assertSpeakable(question: Question, graph: GraphStore): Promise<void> {
  for (const r of question.rungs) {
    for (const s of r.segments) {
      if (s.kind === "connective") continue;
      if (s.citation_ids.length === 0) throw new Error(`"${s.text}" makes a claim with no citation`);
      for (const cited of s.citation_ids) {
        const status = ((await graph.getNode(cited)) ?? (await graph.getEdge(cited)))?.prov.status;
        if (status === undefined) throw new Error(`"${s.text}" cites "${cited}", which is not in the graph`);
        const ok = s.kind === "fact" ? SPEAKABLE_AS_FACT.has(status) : status === "observed" || SPEAKABLE_AS_FACT.has(status);
        if (!ok) throw new Error(`"${s.text}" is voiced as a ${s.kind} but "${cited}" is only ${status}`);
      }
    }
  }
}

