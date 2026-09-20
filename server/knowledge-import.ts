/** Selective imports are attributed family contributions, never scraped or inferred biography. */
import { z } from "zod";
import { contentHash } from "@/lib/provenance/hash";
import { edgeId } from "@/lib/graph/seed";
import type { GraphNode, GraphEdge, Provenance } from "@/lib/graph/types";
import { lintConduct, lintLines } from "@/lib/script/lint";
import { opensAsAQuestion } from "@/lib/tools/impl/family";
import { CALL_SCRIPT, FAMILY_COPY } from "@/fixtures";
import type { LiveRecall } from "./recall-live";

export const importSchema = z.strictObject({
  request_id: z.string().uuid(), contributor_id: z.string().min(1), reviewed: z.literal(true),
  items: z.array(z.strictObject({
    kind: z.enum(["history", "calendar", "photo", "contact"]),
    label: z.string().trim().min(1).max(80), text: z.string().trim().min(1).max(2000),
    date: z.iso.date().optional(), asset_id: z.string().optional(), person_id: z.string().optional(),
    place: z.string().trim().min(1).max(80).optional(),
  })).min(1).max(20),
});
export type KnowledgeImport = z.infer<typeof importSchema>;

export async function importKnowledge(live: Pick<LiveRecall, "graph" | "setup" | "media" | "refreshSetup">, raw: unknown) {
  const input = importSchema.parse(raw);
  await live.refreshSetup();
  const policy = live.setup.current(), graph = live.graph, policyVersion = JSON.stringify(policy);
  if (!policy.approved_people.includes(input.contributor_id) || input.contributor_id === policy.person_id) throw new Error("Choose an approved contributor.");
  const requestHash = await contentHash(input), receiptId = `artifact:import:${input.request_id}`;
  const prior = await graph.getNode(receiptId);
  if (prior?.type === "Artifact") {
    const receipt = JSON.parse(prior.props.text ?? "{}");
    if (receipt.hash !== requestHash) throw new Error("This import was already saved with different contents.");
    return receipt.result as { topics: Array<{ id: string; label: string }>; imported: number };
  }
  const nodes: GraphNode[] = [], edges: GraphEdge[] = [], topics: Array<{ id: string; label: string }> = [], media: string[] = [];
  const at = new Date().toISOString();
  for (const [i, item] of input.items.entries()) {
    if (/[?!.\n\r{}]/.test(item.label) || item.label.split(/\s+/).length > 8 || lintLines([{ id: "import", text: item.label, surface: "call" }], CALL_SCRIPT.banned).length || lintConduct([{ id: "import", text: item.label, surface: "call" }], CALL_SCRIPT.conduct).length) throw new Error("Use short topic names without sentences or questions.");
    if (opensAsAQuestion(item.text, FAMILY_COPY.question_openers)) throw new Error("Contribute an account, rather than a question for the patient.");
    if (policy.blocked_terms.some((term) => `${item.label} ${item.text} ${item.place ?? ""}`.toLowerCase().includes(term.toLowerCase()))) throw new Error("This item contains a blocked topic.");
    if (item.kind !== "contact" && item.person_id || item.kind !== "photo" && item.asset_id || item.kind !== "calendar" && item.date) throw new Error("Use only the fields belonging to this item.");
    const person = item.kind === "contact" ? await graph.getNode(item.person_id ?? "") : null;
    if (item.kind === "contact" && (person?.type !== "Person" || !policy.approved_people.includes(person.id) || person.props.display_name !== item.label)) throw new Error("Match each selected contact to an approved household member.");
    const attachment = item.kind === "photo" ? live.media?.get(item.asset_id ?? "") : null;
    if (item.kind === "photo" && (!attachment || attachment.owner !== input.contributor_id || attachment.entry.kind !== "image")) throw new Error("Choose a photo uploaded by this contributor.");
    if (item.kind === "calendar" && !item.date) throw new Error("Choose the date from the selected calendar entry.");
    const id = `topic:import:${input.request_id}:${i}`, artifactId = `artifact:${id}`, claimId = `claim:${id}`;
    const prov: Provenance = { source_id: artifactId, source_class: "family_contribution", asset_id: attachment?.entry.id ?? null, media_hash: attachment?.entry.sha256 ?? null, span: null, observed_at: at, author: input.contributor_id, extraction_method: "family_form", confidence: 1, audience_scope: [policy.person_id], expires_at: null, supersedes: [], contradicts: [], status: "family_confirmed", patient_confirmed: false, confirmations: [] };
    nodes.push({ id: artifactId, type: "Artifact", label: `Selected ${item.kind} contribution`, props: { kind: attachment ? "photo" : "family_story", text: item.text, alt: item.label }, prov });
    nodes.push({ id: claimId, type: "EpisodicClaim", label: "Family account", props: { text: item.text }, prov });
    const topicId = person?.id ?? id;
    if (!person) { nodes.push({ id, type: "Event", label: item.label, props: { wikidata_id: null, date: item.date ?? null, topic: { spoken_as: item.label, category: "story" } }, prov }); topics.push({ id, label: item.label }); }
    const link = (type: GraphEdge["type"], from: string, to: string, props: GraphEdge["props"] = {}) => edges.push({ id: edgeId(type, from, to), type, from, to, props, prov });
    link("ABOUT", claimId, topicId); link("SPOKEN_BY", claimId, input.contributor_id); link("CONTRIBUTED_BY", claimId, input.contributor_id); link("CONTRIBUTED_BY", artifactId, input.contributor_id); link("EVIDENCE_FOR", artifactId, claimId); link("PERMITTED_IN", artifactId, policy.policy_id);
    if (attachment) { link("DEPICTS", artifactId, topicId); media.push(attachment.entry.id); }
    if (item.place) {
      if (!item.text.includes(item.place)) throw new Error("The place must appear in your account exactly as entered.");
      const placeId = `place:import:${input.request_id}:${i}`;
      nodes.push({ id: placeId, type: "Place", label: item.place, props: { aliases: [] }, prov });
      link("ABOUT", claimId, placeId);
      // A selected calendar entry is evidence of that entry, not proof that someone attended it.
    }
  }
  const result = { topics, imported: input.items.length };
  const write = async () => {
    if (JSON.stringify(live.setup.current()) !== policyVersion) throw new Error("Joint setup changed. Review this import again.");
    const existing = await graph.getNode(receiptId);
    if (existing?.type === "Artifact") {
      if (JSON.parse(existing.props.text ?? "{}").hash !== requestHash) throw new Error("Import id already used.");
      return result;
    }
    for (const node of nodes) await graph.putNode(node);
    for (const edge of edges) await graph.putEdge(edge);
    await graph.putNode({ id: receiptId, type: "Artifact", label: "Selected import receipt", props: { kind: "audit_log", text: JSON.stringify({ hash: requestHash, result }), alt: null }, prov: { ...nodes[0]!.prov, source_class: "session_audit", author: "system:recall", status: "reference", patient_confirmed: false, extraction_method: "system_event", asset_id: null, media_hash: null } });
    // Uses the graph's SQLite connection in live deployments, so attachment retention commits with evidence.
    for (const asset of media) live.media!.keep(asset);
    return result;
  };
  await live.refreshSetup();
  return graph.atomic ? graph.atomic(write) : write();
}
