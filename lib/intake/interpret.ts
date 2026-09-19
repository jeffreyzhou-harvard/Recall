/**
 * Working out what a forwarded ask is about.
 *
 * The deterministic interpreter does one thing: it looks for the exact names
 * of topics and events the graph already knows, inside the asker's own words
 * (the message and the photo caption). It never guesses, paraphrases, or reads
 * the image. If nothing matches, the ask has no subject, Relay cannot render a
 * cited brief, and the flow stops safely and asks the family to clarify - the
 * right outcome, not a failure to work around.
 *
 * A model-backed interpreter for the live side demo implements the same
 * interface and is held to the same output: ids of nodes that exist.
 */
import type { GraphStore } from "@/lib/graph/store";
import type { EventNode, TopicNode } from "@/lib/graph/types";
import { tokens } from "@/lib/providers/transcription";
import type { ForwardedAsk } from "./contract";

export interface AskInterpretation {
  /** The choices on offer, in the order the asker gave them. */
  option_topic_ids: string[];
  /** What the choices have in common, or what the message names outright. */
  subject_topic_ids: string[];
  event_ids: string[];
  /** Which topics each photo shows, per the asker's caption. */
  depicts: Record<string, string[]>;
}

export interface AskInterpreter {
  readonly label: string;
  interpret(ask: ForwardedAsk, graph: GraphStore): Promise<AskInterpretation>;
}

type Named = TopicNode | EventNode;

/** Position of the first whole-word match of any of the node's names, or -1. */
function firstMention(node: Named, words: readonly string[]): number {
  const names = [node.label, ...("aliases" in node.props ? node.props.aliases : [])];
  let best = -1;
  for (const name of names) {
    const want = tokens(name);
    if (want.length === 0) continue;
    for (let i = 0; i + want.length <= words.length; i++) {
      if (want.every((w, k) => words[i + k] === w) && (best === -1 || i < best)) best = i;
    }
  }
  return best;
}

function mentioned<T extends Named>(nodes: readonly T[], text: string): T[] {
  const words = tokens(text);
  return nodes
    .map((node) => ({ node, at: firstMention(node, words) }))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at || (a.node.id < b.node.id ? -1 : 1))
    .map((m) => m.node);
}

export class LexicalAskInterpreter implements AskInterpreter {
  readonly label = "lexical match against known topics";

  async interpret(ask: ForwardedAsk, graph: GraphStore): Promise<AskInterpretation> {
    const topics = await graph.nodesOfType("Topic");
    const events = await graph.nodesOfType("Event");

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
    const subjects = new Set<string>(shared ?? []);
    for (const t of [...inText, ...shown]) if (!optionIds.has(t.id)) subjects.add(t.id);

    const captions = ask.photos.map((p) => p.caption ?? "").join(" ");
    return {
      option_topic_ids: options.map((o) => o.id),
      subject_topic_ids: [...subjects].sort(),
      event_ids: mentioned(events, `${ask.text} ${captions}`).map((e) => e.id),
      depicts,
    };
  }
}
