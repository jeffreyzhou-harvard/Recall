/** Operator setup projection: family-sourced topic labels, never patient transcripts. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { GraphStore } from "@/lib/graph/store";
import type { AccessPolicy } from "@/lib/tools/policy";
import { opensAsAQuestion } from "@/lib/tools/impl/family";
import { CALL_SCRIPT, FAMILY_COPY } from "@/fixtures";
import { lintLines } from "@/lib/script/lint";
import { edgeId } from "@/lib/graph/seed";
export const topicDraft = z.strictObject({ contributor_id: z.string().min(1), label: z.string().trim().min(1).max(80), story: z.string().trim().min(1).max(2000) });
export async function createTopic(graph: GraphStore, policy: AccessPolicy, input: z.infer<typeof topicDraft>) {
  const draft = topicDraft.parse(input);
  if (!policy.approved_people.includes(draft.contributor_id)) throw new Error("The contributor must be approved in joint setup.");
  if (/[?!.\n\r{}]/.test(draft.label) || draft.label.split(/\s+/).length > 8 || lintLines([{ id: "topic", text: draft.label, surface: "call" }], CALL_SCRIPT.banned).length) throw new Error("Use a short topic name, such as summers at the beach.");
  if (opensAsAQuestion(draft.story, FAMILY_COPY.question_openers)) throw new Error("Tell a memory rather than submitting a question.");
  const author = await graph.getNode(draft.contributor_id);
  if (author?.type !== "Person") throw new Error("The contributor is not in this household.");
  const id = `topic:${randomUUID()}`, artifact = `artifact:${id}`, claim = `claim:${id}`;
  const prov = { source_id: artifact, source_class: "family_contribution" as const, asset_id: null, media_hash: null, span: null, observed_at: new Date().toISOString(), author: draft.contributor_id, extraction_method: "family_form" as const, confidence: 1, audience_scope: [policy.person_id], expires_at: null, supersedes: [], contradicts: [], status: "family_confirmed" as const, patient_confirmed: false, confirmations: [] };
  const write = async () => {
    await graph.putNode({ id: artifact, type: "Artifact", label: "Family topic contribution", props: { kind: "family_story", text: draft.story, alt: draft.label }, prov });
    // Generic stories have no reviewed context assertion: free recall and attributed family cues only.
    await graph.putNode({ id, type: "Event", label: draft.label, props: { wikidata_id: null, date: null, topic: { spoken_as: draft.label, category: "story" } }, prov });
    await graph.putNode({ id: claim, type: "EpisodicClaim", label: "Family account", props: { text: draft.story }, prov });
    for (const [type, from, to] of [["ABOUT", claim, id], ["EVIDENCE_FOR", artifact, claim], ["SPOKEN_BY", claim, draft.contributor_id], ["CONTRIBUTED_BY", claim, draft.contributor_id], ["PERMITTED_IN", artifact, policy.policy_id]] as const) await graph.putEdge({ id: edgeId(type, from, to), type, from, to, props: {}, prov });
    return { id, label: draft.label };
  };
  return graph.atomic ? graph.atomic(write) : write();
}
export async function topicChoices(graph: GraphStore) {
  const nodes = [...await graph.nodesOfType("Event"), ...await graph.nodesOfType("Place"), ...await graph.nodesOfType("EpisodicClaim")];
  return nodes.filter((n) => n.props.topic).map((n) => ({ id: n.id, label: n.label, contributor_id: n.prov.author }));
}
