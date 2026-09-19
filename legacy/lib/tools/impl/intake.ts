/** Tools 1-3: inspect the forwarded ask, verify who is involved, and evaluate the policy. */
import { edgeId } from "@/lib/graph/seed";
import { relationOf } from "@/lib/graph/relations";
import { RECALL_AGENT_ID, SPEAKABLE_AS_FACT, type ArtifactNode, type GraphEdge, type PersonNode, type RelationshipNode } from "@/lib/graph/types";
import { GateError } from "../gates";
import { evaluatePolicy } from "../policy";
import type { ToolImpl } from "../runtime";

const out = (edges: GraphEdge[], type: GraphEdge["type"], from: string): GraphEdge[] =>
  edges.filter((e) => e.type === type && e.from === from);

export const inspect_request: ToolImpl<"inspect_request"> = async (input, ctx) => {
  const ask = await ctx.graph.findCurrentAsk(input.thread_id);
  // Rule 5: Recall only ever acts on a forwarded ask. With nothing forwarded there is nothing to do.
  if (!ask) throw new GateError("permission", `no forwarded ask for "${input.thread_id}"; Recall never initiates contact`);

  const edges = await ctx.graph.edgesOf(ask.id);
  const asker = out(edges, "ASKED_BY", ask.id)[0]?.to;
  const addressee = out(edges, "ADDRESSED_TO", ask.id)[0]?.to;
  if (!asker || !addressee) throw new GateError("identity", "the ask does not name both an asker and an addressee");

  const artifacts = [];
  for (const e of edges.filter((e) => e.type === "EVIDENCE_FOR" && e.to === ask.id)) {
    const node = (await ctx.graph.getNode(e.from)) as ArtifactNode | null;
    if (node && node.props.kind !== "message") {
      artifacts.push({ artifact_id: node.id, kind: node.props.kind, alt: node.props.alt, asset_id: node.prov.asset_id });
    }
  }

  const topicIds: string[] = [];
  const eventIds: string[] = [];
  const mentionIds: string[] = [];
  for (const e of out(edges, "ABOUT", ask.id)) {
    const node = await ctx.graph.getNode(e.to);
    if (node?.type === "Topic") topicIds.push(node.id);
    else if (node?.type === "Event") eventIds.push(node.id);
    else if (node) mentionIds.push(node.id);
  }

  const result = {
    ask_id: ask.id,
    forward_id: ask.props.forward_id,
    thread_id: ask.props.thread_id,
    text: ask.props.text,
    asker_id: asker,
    addressee_id: addressee,
    participants: [asker, addressee],
    artifacts: artifacts.sort((a, b) => (a.artifact_id < b.artifact_id ? -1 : 1)),
    option_topic_ids: ask.props.option_topic_ids,
    topic_ids: topicIds.sort(),
    event_ids: eventIds.sort(),
    mention_ids: mentionIds.sort(),
    requested_audience: ask.props.requested_audience,
    received_at: ask.props.received_at,
    expires_at: ask.prov.expires_at,
  };
  ctx.session.ask = result;
  return result;
};

export const resolve_identity_and_relationships: ToolImpl<"resolve_identity_and_relationships"> = async (input, ctx) => {
  const ask = ctx.session.ask;
  if (!ask || ask.ask_id !== input.ask_id) throw new GateError("identity", "inspect_request has not run for this ask");

  const bindings = [];
  const mismatches = [];
  for (const participant of input.participants) {
    const node = await ctx.graph.getNode(participant);
    if (!node || node.type !== "Person") {
      mismatches.push({ participant, reason: "not a known person" });
      continue;
    }
    const person = node as PersonNode;
    const memberOf = (await ctx.graph.edgesOf(person.id)).find(
      (e) => e.type === "MEMBER_OF_THREAD" && e.from === person.id && e.to === ask.thread_id,
    );
    if (!memberOf) {
      mismatches.push({ participant, reason: "not a member of this thread" });
      continue;
    }
    bindings.push({
      person_id: person.id,
      display_name: person.props.display_name,
      role: person.props.role,
      verified_by: memberOf.prov.source_id,
    });
  }

  // The asker and the addressee must be joined by a relationship the family verified at setup.
  const relationships = [];
  for (const e of (await ctx.graph.edgesOf(ask.addressee_id)).filter((e) => e.type === "RELATED_TO")) {
    const rel = (await ctx.graph.getNode(e.from)) as RelationshipNode | null;
    if (!rel || rel.type !== "Relationship" || !rel.props.verified) continue;
    const ends = (await ctx.graph.edgesOf(rel.id)).filter((x) => x.type === "RELATED_TO" && x.from === rel.id).map((x) => x.to);
    if (ends.includes(ask.asker_id) && ends.includes(ask.addressee_id)) {
      relationships.push({
        relationship_id: rel.id,
        kind: rel.props.kind,
        between: [ask.addressee_id, ask.asker_id],
        verified_by: rel.prov.source_id,
      });
    }
  }
  // ...or by a tie she, or an approved relative, stated in discovery ("That's my daughter Maya"). Only a
  // CONFIRMED tie counts: a relationship Recall merely inferred verifies nobody. And a verified tie is not
  // permission - whether this person may ask at all is still the access policy's decision, next.
  for (const e of await ctx.graph.edgesOf(ask.addressee_id)) {
    const between = [e.from, e.to];
    if (relationOf(e) === null || !SPEAKABLE_AS_FACT.has(e.prov.status)) continue;
    if (!between.includes(ask.asker_id) || !between.includes(ask.addressee_id)) continue;
    relationships.push({ relationship_id: e.id, kind: relationOf(e)!, between: [ask.addressee_id, ask.asker_id], verified_by: e.prov.source_id });
  }
  if (relationships.length === 0) {
    mismatches.push({ participant: ask.asker_id, reason: "no verified relationship to the addressee" });
  }
  for (const required of [ask.asker_id, ask.addressee_id]) {
    if (!input.participants.includes(required)) mismatches.push({ participant: required, reason: "missing from participants" });
  }

  // Audience: her answer may only go back to the thread the ask came from, and that thread must be one the family set up.
  const thread = (await ctx.graph.getNode(ask.thread_id)) as ArtifactNode | null;
  if (!thread || thread.type !== "Artifact" || thread.props.kind !== "thread") {
    mismatches.push({ participant: ask.thread_id, reason: "not a thread the family set up" });
  }
  if (ask.requested_audience !== ask.thread_id) {
    mismatches.push({ participant: ask.requested_audience, reason: "requested audience is not the thread the ask came from" });
  }

  const verified = mismatches.length === 0;
  if (verified) ctx.gate.recordIdentityVerified(ask.ask_id);
  return { verified, bindings, relationships, mismatches };
};

export const get_access_policy: ToolImpl<"get_access_policy"> = async (input, ctx) => {
  ctx.gate.requireIdentity(input.ask_id);
  const ask = ctx.session.ask!;
  if (input.person !== ask.addressee_id) throw new GateError("policy", "policy was requested for someone the ask is not addressed to");

  const nowIso = ctx.clock.iso();
  const decision = evaluatePolicy(ctx.policy, {
    person_id: input.person,
    asker_id: ask.asker_id,
    purpose: input.purpose,
    audience: input.audience,
    topic_ids: ask.topic_ids,
    ask_expires_at: ask.expires_at,
    now_iso: nowIso,
  });
  if (decision.decision === "denied") return decision;

  const expiresAt = new Date(ctx.clock.now() + ctx.policy.token_ttl_minutes * 60_000).toISOString();
  const token = await ctx.gate.issueToken({
    token_id: `token:${ctx.session.session_id}:${input.ask_id}`,
    policy_id: ctx.policy.policy_id,
    ask_id: input.ask_id,
    person_id: input.person,
    asker_id: ask.asker_id,
    purpose: input.purpose,
    audience: input.audience,
    allowed_source_classes: ctx.policy.allowed_source_classes,
    forbidden_claims: ctx.policy.forbidden_claims,
    issued_at: nowIso,
    expires_at: expiresAt,
  });
  ctx.session.policy_token_id = token.token_id;

  // Granting the ask is what permits its forwarded artifacts for this call. Recorded as an edge so
  // retrieval applies one rule - "is this artifact permitted in this policy?" - to every kind of evidence.
  for (const artifact of ask.artifacts) {
    const id = edgeId("PERMITTED_IN", artifact.artifact_id, token.policy_id);
    if ((await ctx.graph.edgesOf(artifact.artifact_id)).some((e) => e.id === id)) continue;
    const source = (await ctx.graph.getNode(artifact.artifact_id))!.prov;
    await ctx.graph.putEdge({
      id,
      type: "PERMITTED_IN",
      from: artifact.artifact_id,
      to: token.policy_id,
      props: { policy_token_id: token.token_id },
      prov: { ...source, author: RECALL_AGENT_ID, extraction_method: "system_event", observed_at: nowIso, span: null, status: "reference", confirmations: [] },
    });
  }
  return {
    decision: "granted" as const,
    policy_token_id: token.token_id,
    policy_id: token.policy_id,
    allowed_source_classes: token.allowed_source_classes,
    forbidden_claims: token.forbidden_claims,
    expires_at: token.expires_at,
    speech: ctx.policy.speech,
  };
};
