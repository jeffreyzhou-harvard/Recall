/**
 * Drive the tools by hand, the way a model that ignored the intended order
 * would, so gate tests can call any tool directly against a real context.
 */
import { buildFixtureRig, type FixtureOptions, type FixtureRig } from "@/fixtures/harness";
import { ProvLog } from "@/lib/provenance/prov-log";
import { createRelayStore } from "@/lib/state/store";
import { GateKeeper, TOOL_IMPLS, ToolRuntime, newSession, policySchema, type ToolContext, type ToolOutput } from "@/lib/tools";
import { FixtureTranscription } from "@/lib/providers/transcription";
import { GOLDEN_TRANSCRIPT, POLICY } from "@/fixtures";
import { CALL, THREAD, goldenTurn } from "./fixtures";

export interface Bench extends FixtureRig {
  ctx: ToolContext;
  runtime: ToolRuntime;
}

/** A rig with the ask already forwarded, plus a bare tool runtime over the same graph, bridge, and clock. */
export async function bench(options: FixtureOptions = {}): Promise<Bench> {
  const rig = await buildFixtureRig(options);
  await rig.service.forwardAsk(rig.forward);
  const store = createRelayStore();
  const ctx: ToolContext = {
    graph: rig.graph,
    policy: policySchema.parse(options.policy ?? POLICY),
    assets: rig.assets,
    clock: rig.clock,
    gate: new GateKeeper(),
    transcription: new FixtureTranscription([options.transcript ?? GOLDEN_TRANSCRIPT]),
    session: newSession("session:bench"),
    prov: new ProvLog(),
    bridge: rig.bridge,
    machine: () => store.getState().machine,
  };
  return { ...rig, ctx, runtime: new ToolRuntime(ctx, TOOL_IMPLS) };
}

export interface Prepared extends Bench {
  ask: ToolOutput<"inspect_request">;
  tokenId: string;
  verified: string[];
}

/** Tools 1-5. */
export async function throughVerify(options: FixtureOptions = {}): Promise<Prepared> {
  const b = await bench(options);
  const { runtime } = b;
  const ask = await runtime.call("inspect_request", { thread_id: THREAD });
  await runtime.call("resolve_identity_and_relationships", { ask_id: ask.ask_id, participants: ask.participants });
  const policy = await runtime.call("get_access_policy", { ask_id: ask.ask_id, person: ask.addressee_id, purpose: "answer_current_ask", audience: ask.requested_audience });
  if (policy.decision !== "granted") throw new Error("expected the policy to be granted");
  const retrieval = await runtime.call("query_context_graph", {
    ask_id: ask.ask_id,
    question: ask.text,
    allowed_sources: policy.allowed_source_classes,
    max_hops: 2,
    policy_token_id: policy.policy_token_id,
  });
  const support = await runtime.call("verify_claim_support", {
    ask_id: ask.ask_id,
    claim_ids: [ask.asker_id, ...ask.topic_ids, ...ask.event_ids, ...ask.artifacts.map((a) => a.artifact_id), ...retrieval.candidates.map((c) => c.root_id)],
    policy_token_id: policy.policy_token_id,
  });
  return { ...b, ask, tokenId: policy.policy_token_id, verified: support.verified.map((v) => v.claim_id) };
}

/** On from `throughVerify`: hear her answer and capture it. Leaves the contribution pending approval. */
export async function throughCapture(): Promise<Prepared & { captured: ToolOutput<"capture_exact_contribution"> }> {
  const prepared = await throughVerify();
  const answer = goldenTurn("p2");
  await prepared.runtime.call("assess_conversation_state", {
    ask_id: prepared.ask.ask_id,
    audio_window: { asset_id: CALL, start_ms: goldenTurn("r2").end_ms, end_ms: answer.end_ms },
    turn_history: [],
  });
  const captured = await prepared.runtime.call("capture_exact_contribution", {
    ask_id: prepared.ask.ask_id,
    audio_intervals: [{ asset_id: CALL, start_ms: answer.start_ms, end_ms: answer.end_ms }],
  });
  return { ...prepared, captured };
}

export const assentWindow = () => ({ asset_id: CALL, start_ms: goldenTurn("pb1").end_ms, end_ms: goldenTurn("p3").end_ms });
