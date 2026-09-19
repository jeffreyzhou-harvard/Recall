/**
 * Tool 12: the caregiver receipt.
 *
 * It describes what Relay made possible and what support it gave - never the
 * person. There is no score, rating, trend, or comparison to a previous call
 * anywhere in its output, and the contract has no field that could hold one
 * (rules 4 and 8). Every line cites the trace entries or records it rests on.
 */
import { NOTICE_TEXT } from "@/lib/bridge/thread-bridge";
import type { PersonNode, TopicNode } from "@/lib/graph/types";
import { tokens } from "@/lib/providers/transcription";
import type { ToolOutput } from "../contracts";
import type { ToolContext } from "../context";
import type { ToolImpl } from "../runtime";

type Line = ToolOutput<"build_caregiver_receipt">["lines"][number];

const COUNT = ["no", "one", "two", "three", "four"];
const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);


/** Topics she has spoken about before, from verified source-backed claims, that are not simply the options on offer. */
async function ownKnowledgeTopics(ctx: ToolContext, speakerId: string, optionIds: readonly string[]): Promise<TopicNode[]> {
  const topics = new Map<string, TopicNode>();
  for (const id of ctx.gate.verifiedIds()) {
    const node = await ctx.graph.getNode(id);
    if (node?.type !== "EpisodicClaim" || node.prov.author !== speakerId) continue;
    for (const e of (await ctx.graph.edgesOf(id)).filter((e) => e.type === "ABOUT" && e.from === id)) {
      const topic = await ctx.graph.getNode(e.to);
      if (topic?.type === "Topic" && !optionIds.includes(topic.id)) topics.set(topic.id, topic);
    }
  }
  return [...topics.values()];
}

export const build_caregiver_receipt: ToolImpl<"build_caregiver_receipt"> = async (input, ctx) => {
  const { session } = ctx;
  const machine = ctx.machine();
  const trace = machine.trace.filter((t) => t.accepted);
  const final = trace[trace.length - 1]?.to ?? "idle";
  const ask = session.ask;
  const person = ask ? ((await ctx.graph.getNode(ask.addressee_id)) as PersonNode | null) : null;
  const asker = ask ? await ctx.graph.getNode(ask.asker_id) : null;
  const name = person?.props.display_name ?? "She";
  const askerName = asker?.label ?? "the family";

  const reanchors = trace.filter((t) => t.event === "SCAFFOLD_DELIVERED");
  const supports = reanchors.map((t, i) => ({ scaffold_id: session.telemetry.scaffolds_fired[i] ?? "unknown", trace_seq: t.seq }));
  const cite = (...seqs: Array<number | undefined>): string[] => seqs.filter((s): s is number => s !== undefined).map((s) => `trace:${s}`);

  const lines: Line[] = [];
  const delivered = final === "delivered" && session.contribution !== null && session.delivery !== null;

  if (delivered) {
    const c = session.contribution!;
    const deliveredAt = trace.find((t) => t.event === "PUBLISHED")?.seq;
    lines.push({
      dimension: "social",
      text: `${name} answered ${askerName} directly.`,
      citations: [...cite(deliveredAt), session.delivery!.delivery_id],
    });
    // Counts of what Relay did. Relay has no prompt that corrects her and no escalation action, so both are zero by construction.
    lines.push({
      dimension: "emotional",
      text: `${capitalize(COUNT[reanchors.length] ?? String(reanchors.length))} re-anchor${reanchors.length === 1 ? "" : "s"}, no correction or distress escalation.`,
      citations: cite(...reanchors.map((t) => t.seq)),
    });

    const said = new Set(tokens(c.literal_transcript));
    const names = (t: TopicNode): boolean => [t.label, ...t.props.aliases].some((n) => said.has(n.toLowerCase()));
    const options: TopicNode[] = [];
    for (const id of ask!.option_topic_ids) {
      const t = await ctx.graph.getNode(id);
      if (t?.type === "Topic") options.push(t);
    }
    const chose = options.some(names);
    const added = (await ownKnowledgeTopics(ctx, c.speaker_id, ask!.option_topic_ids)).filter(names);
    const subject = person?.props.subject_pronoun ?? name;
    const did = [chose ? "chose" : "answered", ...(added.length > 0 ? ["added original family knowledge"] : [])].join(" and ");
    lines.push({
      dimension: "intellectual",
      text: `${capitalize(subject)} ${did}.`,
      citations: [c.contribution_id, ...added.map((t) => t.id)],
    });
  } else {
    const last = trace[trace.length - 1];
    const what: Record<string, string> = {
      blocked:
        machine.context.family_notice === "clarify"
          ? "Relay could not confirm who was asking or where the answer should go, so no call was placed."
          : "This ask was outside what the family agreed, so no call was placed.",
      narrowed: `Relay did not have enough verified context, so it offered to ask ${askerName} to clarify.`,
      wrapped_up: "No answer today. Relay wrapped up gently.",
      not_sent: "Nothing was sent, because there was no clear yes to sending it.",
      closed_kindly: "Relay restated the question once, then closed the call kindly.",
    };
    lines.push({ dimension: "social", text: what[final] ?? "The call did not finish.", citations: cite(last?.seq) });
  }

  return {
    session_id: input.session_id,
    outcome: final,
    lines,
    supports,
    artifact_metrics: delivered
      ? {
          her_words_pct: 100 as const,
          generated_first_person_words: 0 as const,
          silence_trims: session.contribution!.silence_trims,
        }
      : null,
    scaffolds_logged: supports.length,
    // The reducer chose the notice; this only reports it, so the receipt and the thread cannot disagree.
    family_notice: machine.context.family_notice
      ? { notice: machine.context.family_notice, text: NOTICE_TEXT[machine.context.family_notice] }
      : null,
  };
};
