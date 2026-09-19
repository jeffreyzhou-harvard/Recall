/** Tools 4-5: policy-bounded retrieval, then verification. Only what passes both may ever be spoken. */
import { citationOf, retrieveCandidates, type Citation } from "@/lib/graph/retrieval";
import { SPEAKABLE_AS_FACT, type GraphNode } from "@/lib/graph/types";
import { GateError } from "../gates";
import type { ToolImpl } from "../runtime";

export const query_context_graph: ToolImpl<"query_context_graph"> = async (input, ctx) => {
  const nowIso = ctx.clock.iso();
  const token = await ctx.gate.requireToken(input.policy_token_id, input.ask_id, nowIso);
  const outside = input.allowed_sources.filter((s) => !token.allowed_source_classes.includes(s));
  if (outside.length > 0) {
    throw new GateError("policy", `source classes outside the policy were requested: ${outside.join(", ")}`);
  }
  const result = await retrieveCandidates(ctx.graph, {
    ask_id: input.ask_id,
    policy_id: token.policy_id,
    audience: token.audience,
    allowed_sources: input.allowed_sources,
    max_hops: input.max_hops,
    now_iso: nowIso,
  });
  ctx.session.candidates = result.candidates;
  return result;
};

export const verify_claim_support: ToolImpl<"verify_claim_support"> = async (input, ctx) => {
  const nowIso = ctx.clock.iso();
  await ctx.gate.requireToken(input.policy_token_id, input.ask_id, nowIso);
  const ask = ctx.session.ask;
  if (!ask || ask.ask_id !== input.ask_id) throw new GateError("evidence", "inspect_request has not run for this ask");

  // Only what this ask legitimately reaches can be verified: the ask's own facts and
  // the candidates retrieval returned under the policy. Anything else in the graph is
  // out of scope, so verification can never be used to launder an unfiltered node.
  const inScope = new Set<string>([
    ask.asker_id,
    ask.addressee_id,
    ...ask.topic_ids,
    ...ask.event_ids,
    ...ask.option_topic_ids,
    ...ask.artifacts.map((a) => a.artifact_id),
    ...ctx.session.candidates.map((c) => c.root_id),
  ]);

  const verified: Array<{ claim_id: string; citations: Citation[]; node: GraphNode }> = [];
  const rejected: Array<{ claim_id: string; reason: string }> = [];
  const conflicts: Array<{ a: string; b: string }> = [];

  for (const claimId of [...new Set(input.claim_ids)]) {
    const reject = (reason: string): void => void rejected.push({ claim_id: claimId, reason });
    const node = await ctx.graph.getNode(claimId);
    if (!node) {
      reject("not_in_graph");
      continue;
    }
    if (!inScope.has(claimId)) {
      reject("not_retrieved_for_this_ask");
      continue;
    }
    if (node.prov.expires_at !== null && node.prov.expires_at <= nowIso) {
      reject("expired");
      continue;
    }
    // Rule 6, extended: Relay speaks only what a person confirmed. An observation or an inference is never a fact.
    if (!SPEAKABLE_AS_FACT.has(node.prov.status)) {
      reject(`not_confirmed:${node.prov.status}`);
      continue;
    }
    if (node.prov.asset_id !== null) {
      try {
        const asset = ctx.assets.resolveSpan(node.prov.asset_id, node.prov.span);
        if (asset.sha256 !== node.prov.media_hash) {
          reject("evidence_hash_mismatch");
          continue;
        }
      } catch {
        reject("evidence_unresolvable");
        continue;
      }
    }

    const edges = await ctx.graph.edgesOf(claimId);
    const citations = [citationOf(node)];

    if (node.type === "EpisodicClaim" || node.type === "PreferenceExpertise") {
      const evidence = edges.find((e) => e.type === "EVIDENCE_FOR" && e.to === claimId && e.from === node.prov.source_id);
      if (!evidence) {
        reject("no_direct_evidence");
        continue;
      }
      const speaker = edges.find((e) => e.type === "SPOKEN_BY" && e.from === claimId);
      if (!speaker || speaker.to !== node.prov.author) {
        reject("speaker_unattributed");
        continue;
      }
      const artifact = await ctx.graph.getNode(node.prov.source_id);
      if (artifact) citations.push(citationOf(artifact));
    } else {
      // The ask's own facts: supported only by an edge the forwarded ask itself established.
      const direct =
        claimId === ask.asker_id || claimId === ask.addressee_id
          ? edges.some((e) => e.from === ask.ask_id && e.to === claimId && e.prov.source_class === "current_ask")
          : edges.some(
              (e) =>
                (e.from === ask.ask_id && e.to === claimId) || // ABOUT a topic or event
                (e.to === ask.ask_id && e.from === claimId && e.type === "EVIDENCE_FOR"), // a forwarded artifact
            );
      if (!direct) {
        reject("no_direct_evidence");
        continue;
      }
    }

    const contradiction = edges.find((e) => e.type === "CONTRADICTS");
    if (contradiction) {
      const pair = [contradiction.from, contradiction.to].sort() as [string, string];
      if (!conflicts.some((c) => c.a === pair[0] && c.b === pair[1])) conflicts.push({ a: pair[0], b: pair[1] });
      reject("contradicted");
      continue;
    }
    verified.push({ claim_id: claimId, citations, node });
  }

  // Remembered facts disagree, so Relay uses none of them: current ask only (AGENTS.md section 5).
  const evidenceMode = conflicts.length > 0 ? ("current_ask_only" as const) : ("full" as const);
  const kept = verified.filter((v) => {
    if (evidenceMode === "full" || v.node.prov.source_class !== "prior_claim_with_source") return true;
    rejected.push({ claim_id: v.claim_id, reason: "conflict_fallback_current_ask_only" });
    return false;
  });

  ctx.gate.recordVerifiedEvidence(kept.map((v) => v.claim_id));
  return {
    verified: kept.map(({ claim_id, citations }) => ({ claim_id, citations })),
    rejected: rejected.sort((a, b) => (a.claim_id < b.claim_id ? -1 : 1)),
    conflicts,
    evidence_mode: evidenceMode,
  };
};
