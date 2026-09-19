/**
 * Working out what a forwarded ask is about.
 *
 * The deterministic interpreter does one thing: it looks for the exact names
 * of things the graph already knows, inside the asker's own words (the message
 * and the photo caption). It never guesses, paraphrases, or reads the image.
 * If nothing matches, the ask has no subject, Recall cannot render a cited
 * brief, and the flow stops safely and asks the family to clarify - the right
 * outcome, not a failure to work around.
 *
 * This is where the discovery loop pays off in the participation loop: once
 * she or the family has told Recall about Maya, Cape May, or making gulab jamun,
 * an ask can simply name them and Recall already knows what is meant. Only
 * CONFIRMED knowledge is matchable. A face cluster nobody has named, or a
 * relationship Recall merely inferred, can never become what an ask is "about".
 *
 * A model-backed interpreter for the live side demo implements the same
 * interface and is held to the same output: ids of nodes that exist.
 */
import type { GraphStore } from "@/lib/graph/store";
import { SPEAKABLE_AS_FACT, type GraphNode, type NodeType, type TopicNode } from "@/lib/graph/types";
import { tokens } from "@/lib/providers/transcription";
import type { ForwardedAsk } from "./contract";

export interface AskInterpretation {
  /** The choices on offer, in the order the asker gave them. */
  option_topic_ids: string[];
  /** What the ask is about: named outright, or what every option is a kind of. */
  subject_topic_ids: string[];
  /** The subset of subjects nobody said: worked out by rule from public reference facts. Marked as such in the graph. */
  deduced_subject_topic_ids: string[];
  event_ids: string[];
  /** People, places, activities, and preferences the ask names, that she or the family already told Recall about. */
  mention_ids: string[];
  /** Which topics each photo shows, per the asker's caption. */
  depicts: Record<string, string[]>;
}

export interface AskInterpreter {
  readonly label: string;
  interpret(ask: ForwardedAsk, graph: GraphStore): Promise<AskInterpretation>;
}

const MENTIONABLE: readonly NodeType[] = ["Person", "Place", "Activity", "PreferenceExpertise"];

function namesOf(node: GraphNode): string[] {
  const aliases = "aliases" in node.props ? node.props.aliases : [];
  const display = node.type === "Person" ? [node.props.display_name] : [];
  return [node.label, ...display, ...aliases];
}

/** Position of the first whole-word match of any of the node's names, or -1. */
function firstMention(node: GraphNode, words: readonly string[]): number {
  let best = -1;
  for (const name of namesOf(node)) {
    const want = tokens(name);
    if (want.length === 0) continue;
    for (let i = 0; i + want.length <= words.length; i++) {
      if (want.every((w, k) => words[i + k] === w) && (best === -1 || i < best)) best = i;
    }
  }
  return best;
}

function mentioned<T extends GraphNode>(nodes: readonly T[], text: string): T[] {
  const words = tokens(text);
  return nodes
    .map((node) => ({ node, at: firstMention(node, words) }))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at || (a.node.id < b.node.id ? -1 : 1))
    .map((m) => m.node);
}

export class LexicalAskInterpreter implements AskInterpreter {
  readonly label = "lexical match against known, confirmed names";

  async interpret(ask: ForwardedAsk, graph: GraphStore): Promise<AskInterpretation> {
    const confirmed = <T extends GraphNode>(nodes: T[]): T[] => nodes.filter((n) => SPEAKABLE_AS_FACT.has(n.prov.status));
    const topics = confirmed(await graph.nodesOfType("Topic"));
    const events = confirmed(await graph.nodesOfType("Event"));

    const depicts: Record<string, string[]> = {};
    const shown: TopicNode[] = [];
    for (const photo of ask.photos) {
      const inCaption = photo.caption ? mentioned(topics, photo.caption) : [];
      depicts[photo.asset_id] = inCaption.map((t) => t.id);
      for (const t of inCaption) if (!shown.includes(t)) shown.push(t);
    }
    const inText = mentioned(topics, ask.text);

    // Two or more things shown, or named, side by side are the choices. One thing alone is a subject.
    const options = shown.length >= 2 ? shown : inText.length >= 2 ? inText : [];
    const optionIds = new Set(options.map((o) => o.id));

    // What every option is a kind of (kheer and halwa are both desserts), from public reference edges.
    let shared: string[] | null = null;
    for (const option of options) {
      const kinds = (await graph.edgesOf(option.id))
        .filter((e) => e.type === "RELATED_TO" && e.from === option.id && e.props.role === "kind_of")
        .map((e) => e.to);
      const soFar: string[] = shared ?? kinds;
      shared = soFar.filter((k) => kinds.includes(k));
    }
    const named = [...inText, ...shown].filter((t) => !optionIds.has(t.id)).map((t) => t.id);
    const deduced = (shared ?? []).filter((id) => !named.includes(id));

    const everything = `${ask.text} ${ask.photos.map((p) => p.caption ?? "").join(" ")}`;
    const knowledge: GraphNode[] = [];
    for (const type of MENTIONABLE) knowledge.push(...confirmed(await graph.nodesOfType(type)));
    // The asker and the person being asked are who the ask is between, not what it is about.
    const parties = new Set([ask.asker_id, ask.addressee_id]);

    return {
      option_topic_ids: options.map((o) => o.id),
      subject_topic_ids: [...new Set([...named, ...deduced])].sort(),
      deduced_subject_topic_ids: deduced.sort(),
      event_ids: mentioned(events, everything).map((e) => e.id),
      mention_ids: mentioned(knowledge, everything).map((n) => n.id).filter((id) => !parties.has(id)),
      depicts,
    };
  }
}
