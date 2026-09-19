/** Tools 3-4: policy-bounded retrieval, then verification. Only what passes both may ever be spoken. */
import { citationOf, retrieveCandidates, type Citation } from "@/lib/graph/retrieval";
import { SPEAKABLE_AS_FACT, type GraphEdge, type GraphNode, type Provenance } from "@/lib/graph/types";
import type { ToolContext } from "../context";
import { GateError, type VerifiedEvidence } from "../gates";
import type { ToolImpl } from "../runtime";

export const query_context_graph: ToolImpl<"query_context_graph"> = async (input, ctx) => {
  const nowIso = ctx.clock.iso();
  const token = await ctx.gate.requireToken(input.policy_token_id, input.topic_id, nowIso);
  const result = await retrieveCandidates(ctx.graph, {
    topic_id: input.topic_id,
    policy_id: token.policy_id,
    audience: token.person_id,
    allowed_sources: token.allowed_source_classes,
    max_hops: input.max_hops,
    now_iso: nowIso,
  });
  ctx.session.candidates = result.candidates;
  ctx.session.relations = result.relations;
  return result;
};

const edgeCitation = (edge: GraphEdge): Citation => ({
  node_id: edge.id,
  source_id: edge.prov.source_id,
  source_class: edge.prov.source_class,
  asset_id: edge.prov.asset_id,
  media_hash: edge.prov.media_hash,
  span: edge.prov.span,
  author: edge.prov.author,
  observed_at: edge.prov.observed_at,
  patient_confirmed: edge.prov.patient_confirmed,
});

/** Checks every fact shares, node or edge: still fresh, confirmed by a person, and its media (if any) is the media it was cut from. */
function provenanceProblem(ctx: ToolContext, prov: Provenance, nowIso: string): string | null {
  if (prov.expires_at !== null && prov.expires_at <= nowIso) return "expired";
  // Rule 6: Relay speaks only what a person confirmed. An observation or an inference is never a fact.
  if (!SPEAKABLE_AS_FACT.has(prov.status)) return `not_confirmed:${prov.status}`;
  if (prov.asset_id !== null) {
    try {
      if (ctx.assets.resolveSpan(prov.asset_id, prov.span).sha256 !== prov.media_hash) return "evidence_hash_mismatch";
    } catch {
      return "evidence_unresolvable";
    }
  }
  return null;
}

export const verify_claim_support: ToolImpl<"verify_claim_support"> = async (input, ctx) => {
  const nowIso = ctx.clock.iso();
  await ctx.gate.requireToken(input.policy_token_id, input.topic_id, nowIso);
  const policy = ctx.setup.current();
  if (ctx.session.topic?.topic_id !== input.topic_id) throw new GateError("evidence", "get_next_recall_topic has not chosen this topic");

  // Only what this topic legitimately reaches can be verified: the topic, and what retrieval returned for it
  // under the policy. Anything else in the graph is out of scope, so verification can never be used to
  // launder an unfiltered node into something Relay may say.
  const inScope = new Set<string>([input.topic_id, ...ctx.session.candidates.map((c) => c.root_id), ...ctx.session.relations.map((r) => r.edge_id)]);
  const mayBind = new Set<string>([policy.person_id, ...policy.approved_people]);

  const verified: Array<VerifiedEvidence & { kind: "node" | "edge"; citations: Citation[] }> = [];
  const rejected: Array<{ claim_id: string; reason: string }> = [];
  const conflicts: Array<{ a: string; b: string }> = [];

  for (const claimId of [...new Set(input.claim_ids)]) {
    const reject = (reason: string): void => void rejected.push({ claim_id: claimId, reason });
    const node: GraphNode | null = await ctx.graph.getNode(claimId);
    const edge: GraphEdge | null = node ? null : await ctx.graph.getEdge(claimId);
    if (!node && !edge) {
      reject("not_in_graph");
      continue;
    }
    if (!inScope.has(claimId)) {
      reject("not_retrieved_for_this_topic");
      continue;
    }
    const prov = (node ?? edge)!.prov;
    const problem = provenanceProblem(ctx, prov, nowIso);
    if (problem) {
      reject(problem);
      continue;
    }
    const source = await ctx.graph.getNode(prov.source_id);
    if (source?.type !== "Artifact") {
      reject("no_direct_evidence");
      continue;
    }

    if (edge) {
      // An identity or relationship binding ("Maya is her daughter") enters only through a named, approved person.
      if (!mayBind.has(prov.author)) {
        reject("binding_without_approved_source");
        continue;
      }
      verified.push({ id: claimId, kind: "edge", speaker: prov.author, patient_confirmed: prov.patient_confirmed, citations: [edgeCitation(edge), citationOf(source)] });
      continue;
    }

    const edges = await ctx.graph.edgesOf(claimId);
    let speaker = prov.author;
    if (node!.type === "EpisodicClaim" || node!.type === "PreferenceExpertise") {
      if (!edges.some((e) => e.type === "EVIDENCE_FOR" && e.to === claimId && e.from === prov.source_id)) {
        reject("no_direct_evidence");
        continue;
      }
      const spokenBy = edges.find((e) => e.type === "SPOKEN_BY" && e.from === claimId);
      if (!spokenBy || spokenBy.to !== prov.author) {
        reject("speaker_unattributed");
        continue;
      }
      speaker = spokenBy.to;
    }
    if (node!.type === "Person" && !mayBind.has(prov.author)) {
      reject("binding_without_approved_source");
      continue;
    }

    const contradiction = edges.find((e) => e.type === "CONTRADICTS");
    if (contradiction) {
      // Two accounts differ. Relay speaks neither, and never says which is right.
      const pair = [contradiction.from, contradiction.to].sort() as [string, string];
      if (!conflicts.some((c) => c.a === pair[0] && c.b === pair[1])) conflicts.push({ a: pair[0], b: pair[1] });
      reject("contradicted");
      continue;
    }
    const citations = node!.id === source.id ? [citationOf(node!)] : [citationOf(node!), citationOf(source)];
    verified.push({ id: claimId, kind: "node", speaker, patient_confirmed: prov.patient_confirmed, citations });
  }

  ctx.gate.recordVerifiedEvidence(verified.map(({ id, speaker, patient_confirmed }) => ({ id, speaker, patient_confirmed })));
  ctx.session.verified = verified.map(({ id, speaker, patient_confirmed }) => ({ id, speaker, patient_confirmed }));
  return {
    verified: verified.map(({ id, kind, speaker, patient_confirmed, citations }) => ({ claim_id: id, kind, speaker, patient_confirmed, citations })),
    rejected: rejected.sort((a, b) => (a.claim_id < b.claim_id ? -1 : 1)),
    conflicts,
  };
};
