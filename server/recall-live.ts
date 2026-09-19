/**
 * The live Recall process: the same RecallService as the judged path, held for the life of the server so the
 * family side and the schedule share one graph. Node only. Nothing on the judged path imports this
 * (AGENTS.md section 9: a live path is an optional side demo, behind a flag).
 *
 * Chosen by RECALL_CALL:
 *
 *   none         (default) no call can be placed. The family side still works.
 *   prerecorded  a turn of the schedule runs the prerecorded golden call. Say so when showing it.
 *
 * There is no live call yet. The call feature - her speech transcribed on the web app - is being built
 * separately; when it lands it plugs in here as one more `CallDriver` plus a `TranscriptionProvider`
 * (lib/providers/deepgram.ts is ready for it), and nothing else in the engine has to change.
 *
 * Who it is for is chosen by RECALL_HOUSEHOLD. Unset (the default), it is the committed fixture family. Set to
 * a household id from the onboarding database, the graph starts from that household's identity layer and
 * the joint setup is the one they agreed - re-read before every call and every dashboard load, so a
 * revocation recorded there is in force at once (rule 12).
 *
 * What starts a call is `tick()` - one turn of the schedule - and nothing else. It takes no topic and
 * no requester, so there is no way for a family member to cause a call to her (rule 5). The route that
 * exposes it is for the operator only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CALL_SCRIPT, FAMILY_COPY, FAMILY_SEED, GOLDEN_TRANSCRIPT, JUDGED_TIMING, MANIFEST, POLICY, RECORD_THRESHOLDS, SAFETY_PHRASES } from "@/fixtures";
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
import { DEFAULT_ONBOARDING_DB, openOnboarding } from "./onboarding";

// One live recall per server process: it holds the graph, and a call in progress must outlive a request.
const cache = globalThis as unknown as { __recallLive?: Promise<LiveRecall> };
export function getLiveRecall(): Promise<LiveRecall> {
  cache.__recallLive ??= createLiveRecall(configFromEnv(process.env, process.cwd())).catch((e: unknown) => {
    cache.__recallLive = undefined; // only a failed start-up is retried
    throw e;
  });
  return cache.__recallLive;
}

export type CallMode = "none" | "prerecorded";

export interface LiveConfig {
  callMode: CallMode;
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
}

export function configFromEnv(env: NodeJS.ProcessEnv, root: string): LiveConfig {
  const callMode = env.RECALL_CALL ?? "none";
  if (callMode !== "none" && callMode !== "prerecorded") throw new Error(`RECALL_CALL must be "none" or "prerecorded", not "${callMode}"`);
  if (env.RECALL_HOUSEHOLD && env.RECALL_POLICY_FILE) throw new Error("set RECALL_HOUSEHOLD or RECALL_POLICY_FILE, not both: a household's setup comes from the onboarding database");
  return { callMode, root, policyFile: env.RECALL_POLICY_FILE || undefined, household: env.RECALL_HOUSEHOLD || undefined, onboardingDb: env.RECALL_ONBOARDING_DB || undefined };
}

export interface LiveRecall {
  callMode: CallMode;
  service: RecallService;
  setup: SetupStore;
  /** Safety alerts, held for the designated caregiver's dashboard card. The only thing Recall ever sends to family (rule 15). */
  alerts: MemoryAlertChannel;
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
  const assets = new AssetIndex(MANIFEST);
  const onboarding = config.household ? openOnboarding(config.root, config.onboardingDb ?? DEFAULT_ONBOARDING_DB) : null;
  const agreed = async (): Promise<unknown> => {
    const status = await onboarding!.status(config.household!);
    if (!status.steps.every((s) => s.done)) throw new Error(`${config.household} has not finished onboarding: ${status.steps.filter((s) => !s.done).map((s) => s.step).join(", ")}`);
    return (await onboarding!.currentSetup(config.household!))!.document;
  };
  const graph = MemoryGraphStore.from(buildGraph(onboarding ? await onboarding.graphSeed(config.household!) : FAMILY_SEED, assets));
  const prerecorded = config.callMode === "prerecorded";
  const fixtureClock = prerecorded ? new FixtureClock(config.now ?? JUDGED_TIMING.start_at) : null;
  const clock = fixtureClock ?? new SystemClock();
  const setup = new SetupStore(onboarding ? await agreed() : config.policyFile ? JSON.parse(readFileSync(join(config.root, config.policyFile), "utf8")) : POLICY);
  const refreshSetup = async (): Promise<void> => {
    if (onboarding) setup.replace(await agreed());
  };
  const alerts = new MemoryAlertChannel();
  const spark = process.env.MUSE_API_KEY ? new MuseSpark(requireMuseKey(process.env.MUSE_API_KEY)) : null;
  const { default: default_ms, ...ms } = JUDGED_TIMING.tool_latency_ms;

  const service = new RecallService({
    graph,
    setup,
    assets,
    clock,
    transcription: new FixtureTranscription(prerecorded ? [GOLDEN_TRANSCRIPT] : []),
    script: CALL_SCRIPT,
    copy: FAMILY_COPY,
    thresholds: RECORD_THRESHOLDS,
    safetyPhrases: SAFETY_PHRASES,
    alerts,
    // Only ever invoked by the orchestrator, and only after the joint setup has granted the call.
    callDriver: prerecorded ? () => new FixtureCallDriver(GOLDEN_TRANSCRIPT, fixtureClock!, JUDGED_TIMING.call_connect_delay_ms) : null,
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
      if (config.callMode === "none") return null;
      await refreshSetup();
      const run = await service.runScheduledCall(`session:live:${clock.iso()}:${++sessions}`);
      return run?.recording ?? null;
    });
    queue = next.catch(() => undefined);
    return next;
  };

  return { callMode: config.callMode, service, setup, alerts, refreshSetup, tick };
}
