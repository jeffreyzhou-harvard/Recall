/** A contributor can review only interpretations of their OWN accounts. Patient claims never enter this projection. */
import type { GraphStore } from "@/lib/graph/store";
import type { AccessPolicy } from "@/lib/tools/policy";
import type { GraphNode, GraphEdge, Provenance } from "@/lib/graph/types";
import { contentHash } from "@/lib/provenance/hash";
import { edgeId } from "@/lib/graph/seed";
const receiptId = (id: string) => `artifact:review:${id}`;
const reviewedId = (id: string) => `reviewed:${id}`;
const owned = (p: Provenance, member: string) => p.author === member && p.source_class === "family_contribution" && p.status === "inferred";
export type ReviewItem = { id: string; kind: "entity" | "connection"; label: string; interpretation: string; original: string };
export async function reviewItems(graph: GraphStore, policy: AccessPolicy, member: string): Promise<ReviewItem[]> {
  if (!policy.approved_people.includes(member)) throw new Error("Not approved");
  const data = await graph.snapshot(), nodes = new Map(data.nodes.map((n) => [n.id, n]));
  const out: ReviewItem[] = [];
  for (const value of [...data.nodes, ...data.edges]) {
    if (!owned(value.prov, member) || nodes.has(receiptId(value.id))) continue;
    const source = nodes.get(value.prov.source_id);
    if (source?.type !== "Artifact" || source.prov.author !== member || source.prov.source_class !== "family_contribution" || !source.props.text) continue;
    if (!(source.prov.audience_scope.includes(policy.person_id))) continue;
    if ("label" in value && ["Person", "Place", "Event"].includes(value.type) && value.id.startsWith("entity:")) {
      out.push({ id: value.id, kind: "entity", label: value.label, interpretation: value.type === "Person" ? "A person" : value.type === "Place" ? "A place" : "An event", original: source.props.text });
    } else if (!("label" in value) && value.type === "RELATED_TO" && value.id.startsWith("knowledge:relation:")) {
      const from = nodes.get(value.from), to = nodes.get(value.to);
      // A relation can name only this contributor's entities, or people from joint setup.
      const mayName = (n: GraphNode | undefined) => n && (n.prov.author === member && n.prov.source_class === "family_contribution" || n.type === "Person" && (n.id === policy.person_id || policy.approved_people.includes(n.id)));
      if (mayName(from) && mayName(to)) {
        const relation = String(value.props.relation), kin = ["child", "parent", "grandchild", "grandparent", "sibling", "spouse", "friend", "relative"].includes(relation);
        const interpretation = kin ? `${to!.label} is ${from!.label}'s ${relation}.` : `${from!.label} ${relation.replaceAll("_", " ")} ${to!.label}.`;
        out.push({ id: value.id, kind: "connection", label: "Stated connection", interpretation, original: source.props.text });
      }
    }
  }
  return out.slice(0, 100);
}

export async function reviewKnowledge(graph: GraphStore, currentPolicy: () => AccessPolicy, member: string, ids: string[]) {
  if (!ids.length || ids.length > 24 || new Set(ids).size !== ids.length) throw new Error("Select up to 24 interpretations");
  const write = async () => {
    const policy = currentPolicy();
    const candidates = await reviewItems(graph, policy, member), allowed = new Map(candidates.map((r) => [r.id, r]));
    // Idempotent retries are accepted only for this contributor's review receipts.
    for (const id of ids) if (!allowed.has(id) && (await graph.getNode(receiptId(id)))?.prov.author !== member) throw new Error("Interpretation unavailable");
    const selected = new Set(ids);
    const resolve = async (id: string) => {
      const original = await graph.getNode(id);
      if (!original) throw new Error("Missing endpoint");
      if (original.prov.status !== "inferred") return id;
      if (await graph.getNode(reviewedId(id)) || selected.has(id)) return reviewedId(id);
      throw new Error("Review the people and places before the connection");
    };
    const records: Array<{ value: GraphNode | GraphEdge; item: ReviewItem; prov: Provenance }> = [];
    for (const id of ids) {
      const item = allowed.get(id); if (!item) continue;
      const value = await graph.getNode(id) ?? await graph.getEdge(id);
      if (!value || !owned(value.prov, member)) throw new Error("Interpretation unavailable");
      if (!("label" in value)) { await resolve(value.from); await resolve(value.to); }
      const prov: Provenance = { ...value.prov, source_id: receiptId(id), status: "family_confirmed", patient_confirmed: false, extraction_method: "family_form", asset_id: null, media_hash: null, span: null, observed_at: new Date().toISOString(), confirmations: [] };
      records.push({ value, item, prov });
    }
    // Nodes precede edges, regardless of the order selected in the UI.
    for (const { value, item, prov } of records) {
      await graph.putNode({ id: receiptId(value.id), type: "Artifact", label: "Contributor-reviewed interpretation", props: { kind: "answer", text: JSON.stringify({ selection: item.interpretation, label: item.label, original_source: value.prov.source_id, original_hash: await contentHash(item.original) }), alt: null }, prov });
      await graph.putEdge({ id: edgeId("PERMITTED_IN", prov.source_id, policy.policy_id), type: "PERMITTED_IN", from: prov.source_id, to: policy.policy_id, props: {}, prov });
      if ("label" in value) await graph.putNode({ ...value, id: reviewedId(value.id), prov });
    }
    for (const { value, prov } of records) {
      if ("label" in value) {
        for (const edge of await graph.edgesOf(value.id)) {
          if (edge.type !== "ABOUT" || edge.to !== value.id || !owned(edge.prov, member)) continue;
          await graph.putEdge({ ...edge, id: reviewedId(edge.id), to: reviewedId(value.id), prov });
        }
      } else await graph.putEdge({ ...value, id: reviewedId(value.id), from: await resolve(value.from), to: await resolve(value.to), prov });
    }
    return { reviewed: ids.length, patient_confirmed: false as const };
  };
  return graph.atomic ? graph.atomic(write) : write();
}
