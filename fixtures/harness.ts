/**
 * Builds a complete Recall from fixtures: in-memory graph, the joint setup, the
 * fixed scripts, a fixture clock, and a prerecorded call. The judged path and
 * every engine test run through this, so they exercise the same service the
 * live side demo does - only the call driver and the clock differ.
 */
import { FixtureClock } from "@/lib/clock";
import { MemoryGraphStore } from "@/lib/graph/memory-store";
import { buildGraph, mergeSeeds, type SeedFile } from "@/lib/graph/seed";
import { loadInto, type GraphStore } from "@/lib/graph/store";
import { FixtureCallDriver } from "@/lib/orchestrator/call-driver";
import { AssetIndex, type AssetManifest } from "@/lib/provenance/assets";
import { FixtureTranscription, type CallTranscript } from "@/lib/providers/transcription";
import { MemoryAlertChannel } from "@/lib/safety/alert";
import type { SafetyPhrases } from "@/lib/safety/phrases";
import type { CallScript } from "@/lib/script/call-script";
import { RecallService, type SessionRun } from "@/lib/service/recall-service";
import { SetupStore, type Fault, type ScaffoldAdvisor } from "@/lib/tools";
import { CALL_SCRIPT, FAMILY_COPY, FAMILY_SEED, GOLDEN_TRANSCRIPT, JUDGED_TIMING, MANIFEST, POLICY, RECORD_THRESHOLDS, SAFETY_PHRASES } from "./index";

export interface FixtureOptions {
  /** Extra seed files merged onto the family graph. */
  overlays?: SeedFile[];
  /** Replaces the base seed entirely. */
  seed?: SeedFile;
  policy?: unknown;
  manifest?: AssetManifest;
  /** The prerecorded call. Null means this run has no call available to place. */
  transcript?: CallTranscript | null;
  faults?: Fault[];
  script?: CallScript;
  safetyPhrases?: SafetyPhrases;
  scaffoldAdvisor?: ScaffoldAdvisor;
  /** When the fixture clock starts. */
  now?: string;
  /** Run over another store (LadybugDB) instead of the in-memory one. */
  graph?: GraphStore;
}

export interface FixtureRig {
  service: RecallService;
  graph: GraphStore;
  setup: SetupStore;
  alerts: MemoryAlertChannel;
  clock: FixtureClock;
  assets: AssetIndex;
}

export async function buildFixtureRig(options: FixtureOptions = {}): Promise<FixtureRig> {
  const assets = new AssetIndex(options.manifest ?? MANIFEST);
  const data = buildGraph(mergeSeeds(options.seed ?? FAMILY_SEED, ...(options.overlays ?? [])), assets);
  const graph = options.graph ?? MemoryGraphStore.from(data);
  if (options.graph) await loadInto(options.graph, data);

  const clock = new FixtureClock(options.now ?? JUDGED_TIMING.start_at);
  const setup = new SetupStore(options.policy ?? POLICY);
  const alerts = new MemoryAlertChannel();
  const transcript = options.transcript === undefined ? GOLDEN_TRANSCRIPT : options.transcript;
  const { default: default_ms, ...ms } = JUDGED_TIMING.tool_latency_ms;

  const service = new RecallService({
    graph,
    setup,
    assets,
    clock,
    transcription: new FixtureTranscription(transcript ? [transcript] : []),
    script: options.script ?? CALL_SCRIPT,
    copy: FAMILY_COPY,
    thresholds: RECORD_THRESHOLDS,
    safetyPhrases: options.safetyPhrases ?? SAFETY_PHRASES,
    alerts,
    callDriver: transcript ? () => new FixtureCallDriver(transcript, clock, JUDGED_TIMING.call_connect_delay_ms) : null,
    scaffoldAdvisor: options.scaffoldAdvisor,
    runtime: { faults: options.faults ?? [], fixtureLatency: { clock, ms, default_ms } },
  });
  return { service, graph, setup, alerts, clock, assets };
}

export type FixtureRun = FixtureRig & SessionRun;

/** One tick of the schedule over the fixtures. Throws if nothing was due: every fixture run is expected to schedule a call. */
export async function runFixture(options: FixtureOptions = {}): Promise<FixtureRun> {
  const rig = await buildFixtureRig(options);
  const run = await rig.service.runScheduledCall("session:judged");
  if (!run) throw new Error("no topic was due, so no call was scheduled");
  return { ...rig, ...run };
}

export const runJudgedPath = (): Promise<FixtureRun> => runFixture();
