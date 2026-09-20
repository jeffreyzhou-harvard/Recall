/** Gaps in the graph, never a judgment of the person. Private call-planning data only. */
import type { GraphStore } from "@/lib/graph/store";
import type { AccessPolicy } from "@/lib/tools/policy";
import { usable } from "./updates";

export type KnowledgeGap = "own_account" | "people" | "place" | "occasion";
export interface QuestionPlan { topic_id: string; purpose: "invite_account" | "fill_gap" | "revisit"; gap: KnowledgeGap | null; evidence_ids: string[] }

export async function planQuestion(graph: GraphStore, policy: AccessPolicy, topicId: string, now: string): Promise<QuestionPlan> {
  const empty: QuestionPlan = { topic_id: topicId, purpose: "revisit", gap: null, evidence_ids: [] };
  const topic = await graph.getNode(topicId);
  if (!topic || !policy.topics.allow.includes(topicId) || policy.topics.block.includes(topicId) || !usable(topic.prov, policy, now)) return empty;
  const claims = [];
  for (const edge of await graph.edgesOf(topicId)) {
    if (edge.type !== "ABOUT" || edge.to !== topicId || !usable(edge.prov, policy, now)) continue;
    const claim = await graph.getNode(edge.from);
    if (claim?.type === "EpisodicClaim" && usable(claim.prov, policy, now) && !(await graph.edgesOf(claim.id)).some((e) => e.type === "CONTRADICTS")) claims.push(claim);
  }
  const hers = claims.filter((c) => c.prov.author === policy.person_id && c.prov.patient_confirmed);
  if (!hers.length) return { ...empty, purpose: "invite_account", gap: "own_account" };
  const found = new Set<string>();
  for (const claim of hers) {
    for (const edge of await graph.edgesOf(claim.id)) {
      if (edge.type !== "ABOUT" || edge.from !== claim.id || !usable(edge.prov, policy, now)) continue;
      const target = await graph.getNode(edge.to);
      if (target && usable(target.prov, policy, now) && target.id !== policy.person_id) found.add(target.type);
    }
  }
  const gap: KnowledgeGap | null = !found.has("Person") ? "people" : !found.has("Place") && topic.type !== "Place" ? "place" : topic.type === "Event" && !topic.props.date && !hers.some((c) => /\b(?:18|19|20)\d{2}\b/.test(c.props.text)) ? "occasion" : null;
  return { ...empty, purpose: gap ? "fill_gap" : "revisit", gap, evidence_ids: hers.map((c) => c.id) };
}
