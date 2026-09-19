/**
 * Test scaffolding. Branch data lives here, not in /fixtures: it exists only to
 * exercise a gate or a failure transition, and is mostly derived from the
 * judged data rather than written out again.
 */
import { CALL_SCRIPT, FAMILY_SEED, MANIFEST, POLICY } from "@/fixtures";
import { runFixture, type FixtureOptions, type FixtureRun } from "@/fixtures/harness";
import type { SeedFile } from "@/lib/graph/seed";
import type { CallTranscript, Turn } from "@/lib/providers/transcription";
import { fill } from "@/lib/script/call-script";

// --- what Relay says on the golden topic, built from the reviewed script so a test can never drift from it ---
const L = CALL_SCRIPT.lines;
const FS = CALL_SCRIPT.ladder.categories.family_summers!;
export const SAID = {
  greeting: fill(L.greeting, { name: "Susan", set_up_by: "Maya" }),
  identity: fill(L.identity, { set_up_by: "Maya" }),
  rung1: fill(CALL_SCRIPT.ladder.free_recall, { topic: "the summers at Cape May" }),
  rung2: FS.context.text,
  rung3: fill(FS.association!.person!, { cue: "Maya" }),
  rung3photo: fill(FS.association!.photo!, { author: "Maya" }),
  rung4: fill(FS.recognition!, { place: "Cape May", option_a: "daughter", option_b: "sister" }),
  elaborate: FS.elaborate!.text,
  storeQuestion: L.store_question.text,
  shareQuestion: L.share_question.text,
  closeWarm: fill(L.close_warm, { name: "Susan" }),
  closeKind: L.close_kind.text,
  closeNotStored: L.close_not_stored.text,
  narrowing: L.narrowing.text,
  stopAck: L.stop_ack.text,
  backchannel: L.backchannel_wait.text,
  safety: fill(L.safety, { caregiver: "Maya", emergency_number: "911" }),
};
export const HER_LINE = "We went to Cape May every summer.";

/**
 * TEST ONLY. Relay's real script has no reorientation line, because every topic it has is autobiographical and
 * such a memory is never stated outright (AGENTS.md §6.1). The last rung's machinery still has to be
 * right for the day a procedural topic exists - so this script pretends the golden category is one.
 */
export const REORIENTATION_TEXT = "You and your {relation} {person} spent summers together at {place}. You told me about them. What do you remember about those?";
export const SCRIPT_WITH_REORIENTATION = ((): typeof CALL_SCRIPT => {
  const script = structuredClone(CALL_SCRIPT);
  Object.assign(script.ladder.categories.family_summers!, { memory_kind: "procedural", reorientation: { id: "LADDER-5-TEST-ONLY", text: REORIENTATION_TEXT } });
  return script;
})();
export const SAID_RUNG5 = fill({ id: "LADDER-5-TEST-ONLY", text: REORIENTATION_TEXT }, { relation: "daughter", person: "Maya", place: "Cape May" });

export type Step = ["relay", string] | ["her", string] | ["silence"] | ["playback"];

/** A prerecorded call from a list of steps. Timings are regular: each turn two seconds, a second apart, inside the 60 s asset. */
export function call(steps: readonly Step[]): CallTranscript {
  let at = 1000;
  const turns: Turn[] = steps.map((step, i) => {
    const [kind, text] = step;
    const start = at;
    const end = start + 2000;
    at = end + 1000;
    const tokens = text ? text.split(" ") : [];
    const each = 2000 / Math.max(1, tokens.length);
    return {
      turn_id: `t${i + 1}`,
      speaker: kind === "relay" ? "relay" : kind === "playback" ? "playback" : "participant",
      start_ms: start,
      end_ms: end,
      is_final: true,
      words: kind === "silence" || kind === "playback" ? [] : tokens.map((w, j) => ({ w, start_ms: Math.round(start + j * each), end_ms: Math.round(start + (j + 1) * each - 20) })),
    };
  });
  return { asset_id: "call-golden", provider: "fixture", timing_status: "placeholder", turns };
}

/** The opening every call shares: what Relay is, then the invitation. */
export const OPENING: Step[] = [
  ["relay", SAID.greeting],
  ["relay", SAID.rung1],
];
/** A first pause is a hold, not a miss: Relay says the backchannel and waits again, then `next`. */
export const QUIET_THEN = (next: string): Step[] => [["silence"], ["relay", SAID.backchannel], ["silence"], ["relay", next]];
/** From her own words to the warm close, with both yeses. */
export const CAPTURE_AND_CONFIRM = (store = "Yes.", share = "Yes."): Step[] => [["her", HER_LINE], ["playback"], ["relay", SAID.storeQuestion], ["her", store], ["relay", SAID.shareQuestion], ["her", share], ["relay", SAID.closeWarm]];

export const run = (steps: readonly Step[], options: FixtureOptions = {}): Promise<FixtureRun> => runFixture({ ...options, transcript: call(steps) });

export const spokenText = (r: FixtureRun): string[] => r.recording.spoken.map((s) => s.text);
export const toolsCalled = (r: FixtureRun): string[] => r.recording.tool_log.map((c) => c.tool);
export const policyWith = (patch: (p: Record<string, any>) => void): unknown => {
  const p = structuredClone(POLICY) as Record<string, any>;
  patch(p);
  return p;
};

/** An overlay seed: extra nodes and edges citing sources the base seed already declares. */
export const overlay = (description: string, nodes: SeedFile["nodes"], edges: SeedFile["edges"], sources: SeedFile["sources"] = {}): SeedFile => ({ version: 1, description, sources, nodes, edges });

/** Susan's own account and Maya's differ, and someone has said so: linked by CONTRADICTS, so neither may be spoken. */
export const ACCOUNTS_DIFFER = overlay("Susan's and Maya's accounts of Cape May differ", [], [{ type: "CONTRADICTS", from: "claim:cape-may-with-maya", to: "claim:maya-remembers-cape-may", source: "artifact:setup-record" }]);

export { CALL_SCRIPT, FAMILY_SEED, MANIFEST, POLICY };

// --- calling tools directly, the way the orchestrator would, up to a chosen point ------------------------------
import { buildFixtureRig, type FixtureRig } from "@/fixtures/harness";
import { ProvLog } from "@/lib/provenance/prov-log";
import { createRelayStore } from "@/lib/state/store";
import { GateKeeper, TOOL_IMPLS, ToolRuntime, newSession, type ToolContext } from "@/lib/tools";
import type { RelayDeps } from "@/lib/service/relay-service";

export interface Bench extends FixtureRig {
  ctx: ToolContext;
  runtime: ToolRuntime;
  store: ReturnType<typeof createRelayStore>;
  topicId: string;
  tokenId: string;
  verified: string[];
}

/** A call session taken as far as verified evidence: topic chosen, policy granted, graph queried, claims verified. */
export async function bench(options: FixtureOptions = {}): Promise<Bench> {
  const rig = await buildFixtureRig(options);
  const deps = (rig.service as unknown as { deps: RelayDeps }).deps;
  const store = createRelayStore();
  const ctx: ToolContext = { graph: deps.graph, setup: deps.setup, assets: deps.assets, clock: deps.clock, gate: new GateKeeper(), transcription: deps.transcription, session: newSession("session:bench"), prov: new ProvLog(), script: deps.script, copy: deps.copy, safetyPhrases: deps.safetyPhrases, alerts: deps.alerts, machine: () => store.getState().machine };
  const runtime = new ToolRuntime({ clock: deps.clock, call: ctx }, TOOL_IMPLS);
  const now = deps.clock.iso();
  const pick = await runtime.call("get_next_recall_topic", { person_id: "person:susan", schedule_context: { now } });
  const topicId = pick.topic!.topic_id;
  const grant = await runtime.call("place_recall_call", { person_id: "person:susan", topic_id: topicId, window: { now } });
  if (grant.decision !== "granted") throw new Error(`the bench call was denied: ${grant.reason}`);
  const found = await runtime.call("query_context_graph", { topic_id: topicId, max_hops: 2, policy_token_id: grant.policy_token_id });
  const support = await runtime.call("verify_claim_support", { topic_id: topicId, claim_ids: [topicId, ...found.candidates.map((c) => c.root_id), ...found.relations.map((r) => r.edge_id)], policy_token_id: grant.policy_token_id });
  return { ...rig, ctx, runtime, store, topicId, tokenId: grant.policy_token_id, verified: support.verified.map((v) => v.claim_id) };
}
