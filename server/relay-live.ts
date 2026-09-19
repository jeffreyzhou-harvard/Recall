/**
 * The live Relay process: the same RelayService as the judged path, with a real
 * call in the middle. Node only. Nothing on the judged path imports this
 * (AGENTS.md section 9: the live path is an optional side demo, behind a flag).
 *
 * Chosen by RELAY_CALL:
 *
 *   none         (default) no call can be placed. The family side still works.
 *   prerecorded  a scheduler tick runs the prerecorded golden call. Say so when showing it.
 *   video        the real thing: once the joint setup grants the call, place a live WebRTC video
 *                call, hear her through Deepgram, and let Muse Spark pick which cue to offer.
 *                Needs DEEPGRAM_API_KEY, and Relay's call page (/call/host) open to be Relay's
 *                end of the call. Uses the wall clock, so the agreed call windows apply for real.
 *
 * What starts a call is `tick()` - one turn of the schedule - and nothing else. It takes no topic and
 * no requester, so there is no way for a family member to cause a call to her (rule 5). The route that
 * exposes it is for the operator only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CALL_SCRIPT, FAMILY_COPY, FAMILY_SEED, GOLDEN_TRANSCRIPT, JUDGED_TIMING, MANIFEST, POLICY, RECORD_THRESHOLDS, SAFETY_PHRASES } from "@/fixtures";
import type { LiveCall } from "@/lib/call/live-call";
import { FixtureClock, SystemClock, type Clock } from "@/lib/clock";
import { MemoryGraphStore } from "@/lib/graph/memory-store";
import { buildGraph } from "@/lib/graph/seed";
import { FixtureCallDriver } from "@/lib/orchestrator/call-driver";
import { AssetIndex } from "@/lib/provenance/assets";
import { MuseAnswerInterpreter, museScaffoldAdvisor } from "@/lib/providers/muse/reasoning";
import { MuseSpark, requireMuseKey } from "@/lib/providers/muse/spark";
import { FixtureTranscription, type TranscriptionProvider } from "@/lib/providers/transcription";
import { MemoryAlertChannel } from "@/lib/safety/alert";
import { RelayService } from "@/lib/service/relay-service";
import type { SessionRecording } from "@/lib/session/recording";
import { SetupStore, type ScaffoldAdvisor } from "@/lib/tools";
import { forgetCall, placeCall } from "./live-calls";

// One live relay per server process: it holds the graph, and a call in progress must outlive a request.
const cache = globalThis as unknown as { __relayLive?: Promise<LiveRelay> };
export function getLiveRelay(): Promise<LiveRelay> {
  cache.__relayLive ??= createLiveRelay(configFromEnv(process.env, process.cwd())).catch((e: unknown) => {
    cache.__relayLive = undefined; // only a failed start-up is retried
    throw e;
  });
  return cache.__relayLive;
}

export type CallMode = "none" | "prerecorded" | "video";

export interface LiveConfig {
  callMode: CallMode;
  /** Project root: where a policy file is read from. */
  root: string;
  /** Start of the session clock outside video mode. Defaults to the judged timing; injectable so tests are repeatable. */
  now?: string;
  /** A joint setup to use instead of the committed one: the family's real one. Git-ignored; see .env.example. */
  policyFile?: string;
}

export function configFromEnv(env: NodeJS.ProcessEnv, root: string): LiveConfig {
  const callMode = env.RELAY_CALL ?? "none";
  if (callMode !== "none" && callMode !== "prerecorded" && callMode !== "video") throw new Error(`RELAY_CALL must be "none", "prerecorded", or "video", not "${callMode}"`);
  return { callMode, root, policyFile: env.RELAY_POLICY_FILE };
}

export interface LiveRelay {
  callMode: CallMode;
  service: RelayService;
  setup: SetupStore;
  /** Safety alerts, held for the designated caregiver's dashboard card. The only thing Relay ever sends to family (rule 15). */
  alerts: MemoryAlertChannel;
  /** One turn of the schedule. Null when nothing is due, or when this deployment cannot place calls. */
  tick(): Promise<SessionRecording | null>;
}

/**
 * When Spark's pick is not used, the deterministic choice stands and the call carries on - by design, silently
 * to her. The operator still needs to know why. The reason only: never what she said.
 */
const loudly =
  (advisor: ScaffoldAdvisor): ScaffoldAdvisor =>
  (advice) =>
    advisor(advice).catch((e: unknown) => {
      console.error("[muse] cue advice not used:", e instanceof Error ? e.message : "unknown error");
      throw e;
    });

export async function createLiveRelay(config: LiveConfig): Promise<LiveRelay> {
  const assets = new AssetIndex(MANIFEST);
  const graph = MemoryGraphStore.from(buildGraph(FAMILY_SEED, assets));
  const video = config.callMode === "video";
  const prerecorded = config.callMode === "prerecorded";
  // A live call runs on the wall clock; the prerecorded one replays on a fixture clock.
  const fixtureClock = new FixtureClock(config.now ?? JUDGED_TIMING.start_at);
  const clock: Clock = video ? new SystemClock() : fixtureClock;
  const setup = new SetupStore(config.policyFile ? JSON.parse(readFileSync(join(config.root, config.policyFile), "utf8")) : POLICY);
  const alerts = new MemoryAlertChannel();
  let current: LiveCall | null = null;
  const spark = process.env.MUSE_API_KEY ? new MuseSpark(requireMuseKey(process.env.MUSE_API_KEY)) : null;

  const { default: default_ms, ...ms } = JUDGED_TIMING.tool_latency_ms;
  const fixtures = new FixtureTranscription(prerecorded ? [GOLDEN_TRANSCRIPT] : []);
  // Turns come from whichever call is up: the live one by its asset ids, otherwise the prerecorded transcript.
  const transcription: TranscriptionProvider = {
    label: "live call, else fixture",
    turnsIn: (w) => (current && w.asset_id.startsWith(current.call_asset_id) ? current.turnsIn(w) : fixtures.turnsIn(w)),
    allTurns: (id) => (current && id.startsWith(current.call_asset_id) ? current.allTurns(id) : fixtures.allTurns(id)),
  };
  // Names Deepgram should expect to hear: people and places she and her family have already told Relay about.
  const keyterms = (await Promise.all((["Person", "Place", "Event"] as const).map((t) => graph.nodesOfType(t)))).flat().map((n) => n.label);

  const service = new RelayService({
    graph,
    setup,
    assets,
    clock,
    transcription,
    script: CALL_SCRIPT,
    copy: FAMILY_COPY,
    thresholds: RECORD_THRESHOLDS,
    safetyPhrases: SAFETY_PHRASES,
    alerts,
    // Only ever invoked by the orchestrator, and only after the joint setup has granted the call.
    callDriver: video ? () => (current = placeCall(assets, keyterms)) : prerecorded ? () => new FixtureCallDriver(GOLDEN_TRANSCRIPT, fixtureClock, JUDGED_TIMING.call_connect_delay_ms) : null,
    runtime: video ? {} : { fixtureLatency: { clock: fixtureClock, ms, default_ms } },
    // Muse Spark, when a key is present: which cue to offer (never whether to climb), and reading facts out of an
    // answer. Both only propose; the guards in lib/ decide. Without a key the deterministic choices run instead.
    ...(spark ? { answerInterpreter: new MuseAnswerInterpreter(spark, graph), scaffoldAdvisor: loudly(museScaffoldAdvisor(spark)) } : {}),
  });

  // One call at a time: sessions share a graph and a clock.
  let queue: Promise<unknown> = Promise.resolve();
  let sessions = 0;
  const tick = (): Promise<SessionRecording | null> => {
    const next = queue.then(async () => {
      if (config.callMode === "none") return null;
      try {
        const run = await service.runScheduledCall(`session:live:${clock.iso()}:${++sessions}`);
        return run?.recording ?? null;
      } finally {
        if (current) forgetCall(current.call_asset_id.slice("live:".length));
        current = null;
      }
    });
    queue = next.catch(() => undefined);
    return next;
  };

  return { callMode: config.callMode, service, setup, alerts, tick };
}
