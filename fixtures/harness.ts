/**
 * Wires the real RelayService to deterministic parts: an in-memory graph and
 * bridge, a fixture clock, and a prerecorded call. No mock data is defined
 * here - only plumbing. With no options it is the judged path; tests override
 * single parts to drive the failure branches through the same code.
 */
import { MemoryThreadBridge } from "@/lib/bridge/thread-bridge";
import { FixtureClock } from "@/lib/clock";
import { MemoryGraphStore } from "@/lib/graph/memory-store";
import { buildGraph, mergeSeeds, type SeedFile } from "@/lib/graph/seed";
import { loadInto, type GraphStore } from "@/lib/graph/store";
import { FixtureCallDriver } from "@/lib/orchestrator/call-driver";
import { AssetIndex, type AssetManifest } from "@/lib/provenance/assets";
import { FixtureTranscription, type CallTranscript } from "@/lib/providers/transcription";
import { RelayService, type ForwardOutcome, type SessionRun } from "@/lib/service/relay-service";
import { policySchema, type Fault } from "@/lib/tools";
import { DIWALI_FORWARD, FAMILY_SEED, GOLDEN_TRANSCRIPT, JUDGED_TIMING, MANIFEST, POLICY } from "./index";

export interface FixtureOptions {
  /** Extra seed files merged onto the family graph. */
  overlays?: SeedFile[];
  policy?: unknown;
  manifest?: AssetManifest;
  /** The prerecorded call. Null means this run has no call available to place. */
  transcript?: CallTranscript | null;
  forward?: unknown;
  faults?: Fault[];
  /** Run over another store (LadybugDB) instead of the in-memory one. */
  graph?: GraphStore;
}

export interface FixtureRig {
  service: RelayService;
  graph: GraphStore;
  bridge: MemoryThreadBridge;
  clock: FixtureClock;
  assets: AssetIndex;
  forward: unknown;
}

export async function buildFixtureRig(options: FixtureOptions = {}): Promise<FixtureRig> {
  const assets = new AssetIndex(options.manifest ?? MANIFEST);
  const data = buildGraph(mergeSeeds(FAMILY_SEED, ...(options.overlays ?? [])), assets);
  const graph = options.graph ?? MemoryGraphStore.from(data);
  if (options.graph) await loadInto(options.graph, data);

  const clock = new FixtureClock(JUDGED_TIMING.start_at);
  const bridge = new MemoryThreadBridge();
  const transcript = options.transcript === undefined ? GOLDEN_TRANSCRIPT : options.transcript;
  const { default: default_ms, ...ms } = JUDGED_TIMING.tool_latency_ms;

  const service = new RelayService({
    graph,
    policy: policySchema.parse(options.policy ?? POLICY),
    assets,
    clock,
    bridge,
    transcription: new FixtureTranscription(transcript ? [transcript] : []),
    callDriver: transcript ? () => new FixtureCallDriver(transcript, clock, JUDGED_TIMING.call_connect_delay_ms) : null,
    runtime: { faults: options.faults ?? [], fixtureLatency: { clock, ms, default_ms } },
  });
  return { service, graph, bridge, clock, assets, forward: options.forward ?? DIWALI_FORWARD };
}

export type FixtureRun = FixtureRig & SessionRun & { intake: ForwardOutcome };

/** Forward the ask, then run the session on its thread. */
export async function runFixture(options: FixtureOptions = {}): Promise<FixtureRun> {
  const rig = await buildFixtureRig(options);
  const intake = await rig.service.forwardAsk(rig.forward);
  const threadId = (rig.forward as { thread_id: string }).thread_id;
  const forwardId = (rig.forward as { forward_id: string }).forward_id;
  const run = await rig.service.runSession(threadId, `session:${forwardId}`);
  return { ...rig, ...run, intake };
}

/** The 90-second judged path, end to end. */
export const runJudgedPath = (): Promise<FixtureRun> => runFixture();
