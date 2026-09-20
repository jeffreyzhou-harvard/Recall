import { KnowledgeUpdater, LiteralGraphExtractor } from "@/lib/knowledge/updates";
import { MuseGraphExtractor } from "@/lib/providers/muse/graph";
import { CallAttempts } from "./call-attempts";
import { MediaStore } from "./media";
import { WebCall, LiveTranscription } from "./web-call";
import { callPhotoSource } from "./call-photos";
import { DurableAlerts } from "./alerts";
import { dataDirectory } from "./data-directory";
/** The live service uses the jointly configured household and persistent graph.
 * Web calls are driven by the schedule, never a family request. `/present` remains an isolated fixture path.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CALL_SCRIPT, FAMILY_COPY, FAMILY_SEED, GOLDEN_TRANSCRIPT, JUDGED_TIMING, MANIFEST, POLICY, RECORD_THRESHOLDS, SAFETY_PHRASES, SAFETY_THRESHOLDS } from "@/fixtures";
import { FixtureClock, SystemClock } from "@/lib/clock";
import { MemoryGraphStore } from "@/lib/graph/memory-store";
import { buildGraph } from "@/lib/graph/seed";
import { FixtureCallDriver } from "@/lib/orchestrator/call-driver";
import { AssetIndex } from "@/lib/provenance/assets";
import { MuseAnswerInterpreter, museScaffoldAdvisor } from "@/lib/providers/muse/reasoning";
import { MuseSpark, requireMuseKey } from "@/lib/providers/muse/spark";
import { FixtureTranscription } from "@/lib/providers/transcription";
import { MemoryAlertChannel } from "@/lib/safety/alert";
import { RecallService } from "@/lib/service/recall-service";
import type { SessionRecording } from "@/lib/session/recording";
import { SetupStore, type ScaffoldAdvisor } from "@/lib/tools";
import { SqliteGraphStore } from "./graph-store";
import { activeHousehold } from "./active-household";
import { openOnboarding } from "./onboarding";
import { readCircle } from "./circle/store";

// One live recall per server process: it holds the graph, and a call in progress must outlive a request.
const cache = globalThis as unknown as { __recallLive?: Promise<LiveRecall>; __recallLiveKey?: string };
export async function getLiveRecall(): Promise<LiveRecall> {
  const config = configFromEnv(process.env, process.cwd());
  const key = JSON.stringify(config);
  if (cache.__recallLiveKey !== key) {
    const previous = await cache.__recallLive?.catch(() => null);
    if (previous?.currentCall()) return previous;
    if (cache.__recallLiveKey !== key) { cache.__recallLive = undefined; cache.__recallLiveKey = key; }
  }
  cache.__recallLive ??= createLiveRecall(config).catch((e: unknown) => {
    cache.__recallLive = undefined; // only a failed start-up is retried
    throw e;
  });
  return cache.__recallLive;
}

export type CallMode = "none" | "prerecorded" | "web";

export interface LiveConfig {
  callMode: CallMode;
  /** Explicit test/demo only. Never enabled by the live application. */
  fixture?: boolean;
  /** Project root: where a policy file is read from. */
  root: string;
  /** Start of the session clock. Defaults to the judged timing; injectable so tests are repeatable. */
  now?: string;
  /** A joint setup to use instead of the committed one: the family's real one. Git-ignored; see .env.example. */
  policyFile?: string;
  /** A household from the onboarding database to run for, instead of the fixture family. */
  household?: string;
  /** Where that database is, as a path from the project root. */
  onboardingDb?: string;
  /** Local, fictional household only; never selects the deployment's active household or sends alerts. */
  sampleDemo?: boolean;
}

export function configFromEnv(env: NodeJS.ProcessEnv, root: string): LiveConfig {
  const callMode = env.RECALL_CALL ?? "none";
  if (callMode !== "none" && callMode !== "prerecorded" && callMode !== "web") throw new Error(`RECALL_CALL must be "none", "web", or "prerecorded", not "${callMode}"`);
  if (env.RECALL_HOUSEHOLD && env.RECALL_POLICY_FILE) throw new Error("set RECALL_HOUSEHOLD or RECALL_POLICY_FILE, not both: a household's setup comes from the onboarding database");
  return { callMode, root, policyFile: env.RECALL_POLICY_FILE || undefined, household: env.RECALL_HOUSEHOLD || activeHousehold(root), onboardingDb: env.RECALL_ONBOARDING_DB || undefined };
}

export interface LiveRecall {
  callMode: CallMode;
  service: RecallService;
  graph: import("@/lib/graph/store").GraphStore;
  assets: AssetIndex;
  knowledge: KnowledgeUpdater;
  setup: SetupStore;
  /** Safety alerts, held for the designated caregiver's dashboard card. The only thing Recall ever sends to family (rule 15). */
  alerts: MemoryAlertChannel | DurableAlerts;
  media: MediaStore | null;
  currentCall(): WebCall | null;
  /** Re-read the joint setup from where it is kept. Call before anything that depends on it (rule 12). A no-op for the fixture family. */
  refreshSetup(): Promise<void>;
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

export async function createLiveRecall(config: LiveConfig): Promise<LiveRecall> {
  if (config.sampleDemo && (process.env.NODE_ENV !== "development" || !config.household || !readCircle(config.household).demo)) throw new Error("Sample calls require a local sample family.");
  if (!config.household && !config.fixture) throw new SetupRequiredError();
  if (config.household && config.callMode === "prerecorded") throw new Error("Real households cannot use prerecorded calls.");
  const assets = new AssetIndex(config.fixture ? MANIFEST : { version: 1, generated_by: "live", assets: [] });
  const onboarding = config.household ? openOnboarding(config.root, config.onboardingDb ?? join(dataDirectory(config.root), "onboarding.db")) : null;
  const agreed = async (): Promise<unknown> => {
    const version = await onboarding!.currentSetup(config.household!);
    if (!version) throw new SetupRequiredError();
    return version.document;
  };
  if (onboarding) await agreed();
  const seed = buildGraph(onboarding ? await onboarding.graphSeed(config.household!) : FAMILY_SEED, assets);
  const graph = onboarding ? new SqliteGraphStore(join(dataDirectory(config.root), "recall-graph.db"), config.household!, process.env.RECALL_GRAPH_READS !== "sqlite") : MemoryGraphStore.from(seed);
  if (graph instanceof SqliteGraphStore) await graph.seed(seed);
  const prerecorded = config.callMode === "prerecorded";
  const fixtureClock = prerecorded ? new FixtureClock(config.now ?? JUDGED_TIMING.start_at) : null;
  const clock = fixtureClock ?? new SystemClock();
  const setup = new SetupStore(onboarding ? await agreed() : config.policyFile ? JSON.parse(readFileSync(join(config.root, config.policyFile), "utf8")) : POLICY);
  const refreshSetup = async (): Promise<void> => {
    if (onboarding) {
      setup.replace(await agreed());
      if (graph instanceof SqliteGraphStore) await graph.seed(buildGraph(await onboarding.graphSeed(config.household!), assets));
    }
  };
  const alerts = config.household && !config.sampleDemo ? new DurableAlerts(config.root, config.household) : new MemoryAlertChannel();
  const media = config.household ? new MediaStore(config.root, config.household, assets, graph instanceof SqliteGraphStore ? graph : undefined) : null;
  media?.reconcile(new Set((await graph.nodesOfType("Artifact")).map((n) => n.prov.asset_id)), setup.current().person_id);
  const attempts = config.household ? new CallAttempts(config.root, config.household) : null;
  let currentSession = "";
  const transcription = new LiveTranscription();
  let webCall: WebCall | null = null;
  const spark = process.env.MUSE_API_KEY ? new MuseSpark(requireMuseKey(process.env.MUSE_API_KEY)) : null;
  const knowledge = new KnowledgeUpdater(graph, () => setup.current(), spark ? new MuseGraphExtractor(spark) : new LiteralGraphExtractor(), refreshSetup);
  const { default: default_ms, ...ms } = JUDGED_TIMING.tool_latency_ms;

  const service = new RecallService({
    graph,
    knowledgeQuestions: !config.fixture,
    ...(!config.fixture ? { enrichKnowledge: () => knowledge.process(1).catch(() => ({ failed: 1 })) } : {}),
    callAttempts: () => attempts?.all() ?? [],
    onContributionCommitted: async (ctx) => { if (ctx.session.stored) await webCall?.retainConfirmed({ contribution_hash: ctx.session.stored.contribution_hash, store: ctx.session.store_confirmation, share: ctx.session.share_confirmation, share_audio: ctx.session.share_audio_window }); },
    onCallSession: (id) => { currentSession = id; },
    isCallStopped: () => webCall?.cannotCommit === true || setup.current().calls_paused,
    setup,
    assets,
    clock,
    transcription: config.callMode === "web" ? transcription : new FixtureTranscription(prerecorded ? [GOLDEN_TRANSCRIPT] : []),
    script: CALL_SCRIPT,
    copy: FAMILY_COPY,
    thresholds: RECORD_THRESHOLDS,
    safetyPhrases: SAFETY_PHRASES,
    safetyThresholds: SAFETY_THRESHOLDS,
    alerts,
    // Only ever invoked by the orchestrator, and only after the joint setup has granted the call.
    callDriver: prerecorded ? () => new FixtureCallDriver(GOLDEN_TRANSCRIPT, fixtureClock!, JUDGED_TIMING.call_connect_delay_ms) : config.callMode === "web" && media ? (topicLabel) => {
      const policy = setup.current();
      attempts?.record(currentSession, clock.iso());
      webCall = new WebCall(policy.person_id, media, transcription, graph, policy.speech.pace, policy.speech.max_call_minutes);
      const photos = callPhotoSource(graph, media, setup, () => clock.iso());
      webCall.photoSource = config.sampleDemo ? async context => {
        const state = readCircle(config.household!);
        const moment = state.moments.find(moment => state.demoCall?.topics[moment.id] === context.topic_id);
        if (!state.demo || !moment) return [];
        return (await photos(context)).filter(photo => moment.photoIds.some(id => photo.id.startsWith(`artifact:sample-photo:${id}:`)));
      } : photos;
      webCall.topicLabel = topicLabel ?? "";
      return webCall;
    } : null,
    runtime: fixtureClock ? { fixtureLatency: { clock: fixtureClock, ms, default_ms } } : { timeout_ms: 15_000 },
    // Muse Spark, when a key is present: which cue to offer (never whether to climb), and reading facts out of an
    // answer. Both only propose; the guards in lib/ decide. Without a key the deterministic choices run instead.
    ...(spark ? { answerInterpreter: new MuseAnswerInterpreter(spark, graph), scaffoldAdvisor: loudly(museScaffoldAdvisor(spark)) } : {}),
  });

  // One call at a time: sessions share a graph and a clock.
  let queue: Promise<unknown> = Promise.resolve();
  let sessions = 0;
  const tick = (): Promise<SessionRecording | null> => {
    const next = queue.then(async () => {
      if (!config.fixture) await knowledge.process(2);
      if (config.callMode === "none" || (config.callMode === "web" && !process.env.DEEPGRAM_API_KEY)) return null;
      await refreshSetup();
      await service.tickSafetyEscalations();
      if (config.callMode === "web" && setup.current().call_transport !== "web") return null;
      const pauseCheck = config.callMode === "web" ? setInterval(() => { void refreshSetup().then(() => { if (setup.current().calls_paused) webCall?.stop(); }).catch(() => webCall?.stop()); }, 1000) : null;
      try {
        const run = await service.runScheduledCall(`session:live:${clock.iso()}:${++sessions}`);
        return run?.recording ?? null;
      } finally { if (pauseCheck) clearInterval(pauseCheck); webCall = null; }

    });
    queue = next.catch(() => undefined);
    return next;
  };

  return { callMode: config.callMode, service, graph, assets, knowledge, media, currentCall: () => webCall?.ended ? null : webCall, setup, alerts, refreshSetup, tick };
}

export class SetupRequiredError extends Error {
  constructor() { super("Complete the joint setup before opening the family view."); this.name = "SetupRequiredError"; }
}
