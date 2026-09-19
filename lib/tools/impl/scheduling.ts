/**
 * Tools 1-2: which topic is due, and whether Recall may call her about it now.
 *
 * Topic choice is a deterministic ranking. No model free-picks a topic, and no
 * family member can cause a call: the only inputs are the graph, the joint
 * setup, and the clock (rule 5).
 */
import { cueHints } from "@/lib/graph/retrieval-layer";
import { LIFE_PERIODS, SPEAKABLE_AS_FACT, TOPIC_NODE_TYPES, type GraphNode, type TopicFacet } from "@/lib/graph/types";
import type { ToolOutput } from "../contracts";
import type { ToolContext } from "../context";
import { GateError } from "../gates";
import { evaluateCallPolicy } from "../policy";
import type { ToolImpl } from "../runtime";

type Topic = NonNullable<ToolOutput<"get_next_recall_topic">["topic"]>;

/** How a node is named aloud and which ladder lines fit it, if it can be a topic at all. A Person is one only by invitation (section 6.1). */
function facetOf(node: GraphNode): TopicFacet | null {
  if (node.type === "Person") return node.props.role === "participant" ? null : { spoken_as: node.props.display_name, category: "person" };
  if (node.type === "Place" || node.type === "Event" || node.type === "EpisodicClaim") return node.props.topic ?? null;
  return null;
}

/**
 * Rule 13's test. A topic is family-sourced and unconfirmed unless SHE has said something about it herself:
 * either the node rests on her own words, or a claim about it is hers and confirmed.
 */
export async function isFamilySourced(ctx: Pick<ToolContext, "graph">, node: GraphNode, personId: string): Promise<boolean> {
  if (node.prov.patient_confirmed && node.prov.author === personId) return false;
  for (const edge of await ctx.graph.edgesOf(node.id)) {
    if (edge.type !== "ABOUT" || edge.to !== node.id) continue;
    const claim = await ctx.graph.getNode(edge.from);
    if (claim?.type === "EpisodicClaim" && claim.prov.patient_confirmed && claim.prov.author === personId) return false;
  }
  return true;
}

/**
 * How often this memory has been told: the accounts of it, hers and her family's, that a person stands behind.
 * Retrieval frequency, more than age, is what seems to keep a memory reachable (EVIDENCE.md, section A).
 */
async function timesTold(ctx: Pick<ToolContext, "graph">, topicId: string): Promise<number> {
  let told = 0;
  for (const edge of await ctx.graph.edgesOf(topicId)) {
    if (edge.type !== "ABOUT" || edge.to !== topicId) continue;
    const claim = await ctx.graph.getNode(edge.from);
    if (claim && SPEAKABLE_AS_FACT.has(claim.prov.status)) told++;
  }
  return told;
}

export const get_next_recall_topic: ToolImpl<"get_next_recall_topic"> = async (input, ctx) => {
  const policy = ctx.setup.current();
  const excluded: Array<{ topic_id: string; reason: string }> = [];
  const eligible: Array<{ node: GraphNode; facet: TopicFacet; last: string | null; told: number; cue: boolean }> = [];
  if (input.person_id !== policy.person_id) return { topic: null, ranked: [], excluded: [], decided_by: "deterministic_ranking" };

  const lastRevisit = new Map<string, string>();
  for (const o of await ctx.graph.nodesOfType("TopicOutcome")) {
    if (o.props.timestamp <= input.schedule_context.now && o.props.timestamp > (lastRevisit.get(o.props.topic_id) ?? "")) lastRevisit.set(o.props.topic_id, o.props.timestamp);
  }

  for (const type of TOPIC_NODE_TYPES) {
    for (const node of await ctx.graph.nodesOfType(type)) {
      const facet = facetOf(node);
      if (!facet) continue;
      const out = (reason: string): void => void excluded.push({ topic_id: node.id, reason });
      if (type === "Person" && !policy.topics.person_topics_enabled) continue; // people are simply not topics unless the setup says so
      if (policy.topics.block.includes(node.id)) out("on the block list");
      else if (!policy.topics.allow.includes(node.id)) out("not on the allow list");
      else if (!SPEAKABLE_AS_FACT.has(node.prov.status)) out(`not confirmed by anyone: ${node.prov.status}`);
      else if (node.prov.expires_at !== null && node.prov.expires_at <= input.schedule_context.now) out("expired");
      else eligible.push({ node, facet, last: lastRevisit.get(node.id) ?? null, told: await timesTold(ctx, node.id), cue: (await cueHints(ctx.graph, node.id)).some((h) => h.effective > 0) });
    }
  }

  // Freshness first - never revisited, then longest ago - so that every memory comes round again, call after call,
  // rather than being visited once. Among those equally due: the one told most often; then by when in her life it is
  // from, where someone has said (ages 6-30, then recent, then the years between; unknown last); then a topic Recall
  // already knows a helpful cue for; then id. Nothing here is a model's judgment.
  const period = (f: TopicFacet): number => (f.life_period ? LIFE_PERIODS.indexOf(f.life_period) : LIFE_PERIODS.length);
  eligible.sort((a, b) => {
    if (a.last !== b.last) return a.last === null ? -1 : b.last === null ? 1 : a.last < b.last ? -1 : 1;
    if (a.told !== b.told) return b.told - a.told;
    if (period(a.facet) !== period(b.facet)) return period(a.facet) - period(b.facet);
    if (a.cue !== b.cue) return a.cue ? -1 : 1;
    return a.node.id < b.node.id ? -1 : 1;
  });

  const first = eligible[0];
  const topic: Topic | null = first
    ? {
        topic_id: first.node.id,
        topic_type: first.node.type,
        label: first.node.label,
        spoken_as: first.facet.spoken_as,
        category: first.facet.category,
        family_sourced: await isFamilySourced(ctx, first.node, policy.person_id),
        // Only a category the reviewed script marks as procedural may ever be stated outright. Nothing else is.
        reorientation_allowed: ctx.script.ladder.categories[first.facet.category]?.memory_kind === "procedural",
        last_revisited_at: first.last,
      }
    : null;
  ctx.session.topic = topic;
  return {
    topic,
    ranked: eligible.map((e, i) => ({ topic_id: e.node.id, rank: i + 1, last_revisited_at: e.last, times_told: e.told, life_period: e.facet.life_period ?? null, has_effective_cue: e.cue })),
    excluded: excluded.sort((a, b) => (a.topic_id < b.topic_id ? -1 : 1)),
    decided_by: "deterministic_ranking",
  };
};

export const place_recall_call: ToolImpl<"place_recall_call"> = async (input, ctx) => {
  const policy = ctx.setup.current();
  const topic = ctx.session.topic;
  // The topic is the one the ranking chose - not one a caller, a model, or a family member would like.
  if (!topic || topic.topic_id !== input.topic_id) throw new GateError("policy", "a call is placed only for the topic get_next_recall_topic chose");

  const earlier = (await ctx.graph.nodesOfType("Session")).map((s) => s.props.started_at);
  const decision = evaluateCallPolicy(policy, { person_id: input.person_id, topic_id: input.topic_id, topic_type: topic.topic_type, now_iso: input.window.now, earlier_call_starts: earlier });
  if (decision.decision === "denied") return decision;

  const issuedAt = ctx.clock.iso();
  const token = await ctx.gate.issueToken({
    token_id: `token:${ctx.session.session_id}`,
    policy_id: policy.policy_id,
    person_id: policy.person_id,
    topic_id: input.topic_id,
    allowed_source_classes: policy.allowed_source_classes,
    issued_at: issuedAt,
    expires_at: new Date(ctx.clock.now() + policy.token_ttl_minutes * 60_000).toISOString(),
  });
  ctx.session.policy_token_id = token.token_id;
  return {
    decision: "granted",
    policy_token_id: token.token_id,
    policy_id: policy.policy_id,
    allowed_source_classes: policy.allowed_source_classes,
    expires_at: token.expires_at,
    speech: policy.speech,
    saved_contact_name: policy.attestations.saved_contact_name,
  };
};
