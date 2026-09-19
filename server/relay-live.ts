/**
 * The live Relay process: the same RelayService as the judged path, with
 * Telegram plugged in as the family's thread. Used by the webhook route and by
 * `npm run telegram -- poll`. Node only. Nothing on the judged path imports this.
 *
 * Two honest modes, chosen by RELAY_CALL:
 *
 *   none         (default) intake only. A forwarded ask is validated, written
 *                to the graph, and logged. No call is placed, because there is
 *                no telephony yet - and Relay does not pretend otherwise.
 *   prerecorded  after intake, run the session against the prerecorded golden
 *                call. Real Telegram in, real Telegram out, with a recorded call
 *                in the middle. For the side demo; say so when showing it. It
 *                only completes for the ask that call was recorded for: any other
 *                ask stops with a ScriptMismatchError rather than faking a reply.
 *   video        the real thing: after the policy grants the ask, place a live
 *                WebRTC video call, hear her through Deepgram, and deliver her
 *                words. Needs DEEPGRAM_API_KEY, and Relay's call page
 *                (/call/host) open to be Relay's end of the call. Uses the wall
 *                clock, so the policy's call windows apply for real.
 *
 * Telegram is optional: with no TELEGRAM_BOT_TOKEN the family's thread is held
 * in memory and asks arrive through POST /api/live/asks (the web app's
 * "Ask Mom with Relay"). With a token, the same process serves both.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FAMILY_SEED, GOLDEN_TRANSCRIPT, JUDGED_TIMING, MANIFEST, POLICY } from "@/fixtures";
import { TelegramClient, type FetchLike, type TgUpdate } from "@/lib/bridge/telegram/api";
import { parseBindings, type TelegramBindings } from "@/lib/bridge/telegram/bindings";
import { TelegramThreadBridge, type RecordingProvider } from "@/lib/bridge/telegram/bridge";
import { TelegramInbound, type HandledUpdate, type MediaStore } from "@/lib/bridge/telegram/inbound";
import { MemoryThreadBridge, type ThreadBridge } from "@/lib/bridge/thread-bridge";
import type { LiveCall } from "@/lib/call/live-call";
import { FixtureClock, SystemClock, type Clock } from "@/lib/clock";
import { MemoryGraphStore } from "@/lib/graph/memory-store";
import { buildGraph } from "@/lib/graph/seed";
import { FixtureCallDriver } from "@/lib/orchestrator/call-driver";
import { AssetIndex } from "@/lib/provenance/assets";
import { cutWav } from "@/lib/provenance/wav";
import { MuseAnswerInterpreter, museScaffoldAdvisor } from "@/lib/providers/muse/reasoning";
import { MuseSpark, requireMuseKey } from "@/lib/providers/muse/spark";
import { FixtureTranscription, type TranscriptionProvider } from "@/lib/providers/transcription";
import { RelayService, type ForwardOutcome } from "@/lib/service/relay-service";
import type { SessionRecording } from "@/lib/session/recording";
import { policySchema } from "@/lib/tools";
import type { ScaffoldAdvisor } from "@/lib/tools/context";
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
  /** Telegram bot token. Null runs without Telegram: the thread is held in memory. */
  token: string | null;
  bindings: TelegramBindings;
  callMode: CallMode;
  /** Project root: where /assets is read from and .data/media is written to. */
  root: string;
  fetchImpl?: FetchLike;
  /** Start of the session clock. Defaults to now; injectable so tests are repeatable. */
  now?: string;
  /** A policy file to use instead of the committed one: the family's real joint setup. Git-ignored; see .env.example. */
  policyFile?: string;
}

export function configFromEnv(env: NodeJS.ProcessEnv, root: string): LiveConfig {
  const callMode = env.RELAY_CALL ?? "none";
  if (callMode !== "none" && callMode !== "prerecorded" && callMode !== "video") throw new Error(`RELAY_CALL must be "none", "prerecorded", or "video", not "${callMode}"`);
  return { token: env.TELEGRAM_BOT_TOKEN || null, bindings: parseBindings(env.RELAY_TELEGRAM_BINDINGS), callMode, root, policyFile: env.RELAY_POLICY_FILE };
}

export interface HandledLive {
  update: HandledUpdate;
  /** Present when a session ran (prerecorded mode, accepted forward). */
  recording: SessionRecording | null;
}

export interface LiveRelay {
  client: TelegramClient | null;
  botUsername: string;
  callMode: CallMode;
  /** A Telegram update. Throws if Telegram is not configured. */
  handle(update: TgUpdate): Promise<HandledLive>;
  /** A forwarded ask from the web app: the same intake and the same session, without Telegram. */
  ask(payload: unknown): Promise<{ outcome: ForwardOutcome; recording: SessionRecording | null }>;
}

/**
 * When Spark's advice is not used, the ladder's choice stands and the call carries on - by design, silently
 * to her. The operator still needs to know why. The reason only: never what she said.
 */
const loudly =
  (advisor: ScaffoldAdvisor): ScaffoldAdvisor =>
  (advice) =>
    advisor(advice).catch((e: unknown) => {
      console.error("[muse] scaffold advice not used:", e instanceof Error ? e.message : "unknown error");
      throw e;
    });

export async function createLiveRelay(config: LiveConfig): Promise<LiveRelay> {
  const client = config.token ? new TelegramClient(config.token, config.fetchImpl) : null;
  const botUsername = client ? ((await client.getMe()).username ?? "") : "";

  const assets = new AssetIndex(MANIFEST);
  const graph = MemoryGraphStore.from(buildGraph(FAMILY_SEED, assets));
  const video = config.callMode === "video";
  // A live call runs on the wall clock; the prerecorded one replays on a fixture clock.
  const fixtureClock = new FixtureClock(config.now ?? new Date().toISOString());
  const clock: Clock = video ? new SystemClock() : fixtureClock;
  const policy = policySchema.parse(config.policyFile ? JSON.parse(readFileSync(join(config.root, config.policyFile), "utf8")) : POLICY);
  let current: LiveCall | null = null;
  const spark = process.env.MUSE_API_KEY ? new MuseSpark(requireMuseKey(process.env.MUSE_API_KEY)) : null;

  // Her recording, cut to the kept spans. Bytes are copied, never re-encoded (lib/provenance/wav.ts).
  const recording: RecordingProvider = async (card) => {
    const asset = assets.get(card.audio.asset_id);
    // A live call's audio exists only in memory, and only until the call ends.
    const source = current?.wavFor(card.audio.asset_id) ?? new Uint8Array(readFileSync(join(config.root, asset.path)));
    const wav = cutWav(source, card.audio.kept);
    return wav ? { bytes: wav, filename: `${card.speaker_name.toLowerCase()}-answer.wav`, mime: "audio/wav" } : null;
  };
  const bridge: ThreadBridge = client ? new TelegramThreadBridge(client, config.bindings, recording) : new MemoryThreadBridge();

  const media: MediaStore = {
    async put(assetId, bytes, extension) {
      const dir = join(config.root, ".data", "media");
      mkdirSync(dir, { recursive: true });
      const relative = join(".data", "media", `${assetId}.${extension.replace(/[^a-z0-9]/gi, "")}`);
      writeFileSync(join(config.root, relative), bytes);
      return relative;
    },
  };

  const prerecorded = config.callMode === "prerecorded";
  const { default: default_ms, ...ms } = JUDGED_TIMING.tool_latency_ms;
  const fixtures = new FixtureTranscription(prerecorded ? [GOLDEN_TRANSCRIPT] : []);
  // Turns come from whichever call is up: the live one by its asset ids, otherwise the prerecorded transcript.
  const transcription: TranscriptionProvider = {
    label: "live call, else fixture",
    turnsIn: (w) => (current && w.asset_id.startsWith(current.call_asset_id) ? current.turnsIn(w) : fixtures.turnsIn(w)),
    allTurns: (id) => (current && id.startsWith(current.call_asset_id) ? current.allTurns(id) : fixtures.allTurns(id)),
  };
  const keyterms = (await Promise.all((["Topic", "Person", "Place", "Activity"] as const).map((t) => graph.nodesOfType(t)))).flat().map((n) => n.label);
  const service = new RelayService({
    graph,
    policy,
    assets,
    clock,
    bridge,
    transcription,
    // Only ever invoked by the orchestrator, and only after the access policy has granted the ask.
    callDriver: video ? () => (current = placeCall(assets, keyterms)) : prerecorded ? () => new FixtureCallDriver(GOLDEN_TRANSCRIPT, fixtureClock, JUDGED_TIMING.call_connect_delay_ms) : null,
    runtime: video ? {} : { fixtureLatency: { clock: fixtureClock, ms, default_ms } },
    // Muse Spark does Relay's reasoning when a key is present: reading facts out of answers, and choosing
    // among eligible scaffolds. Both only propose; the guards in lib/ decide. Without a key, Relay's own
    // deterministic implementations run instead and nothing else changes.
    ...(spark ? { answerInterpreter: new MuseAnswerInterpreter(spark, graph), scaffoldAdvisor: loudly(museScaffoldAdvisor(spark)) } : {}),
  });
  const inbound = client ? new TelegramInbound({ client, bridge: bridge as TelegramThreadBridge, service, assets, media, bindings: config.bindings, botUsername }) : null;
  const callsPlaced = config.callMode !== "none";
  const runFor = async (threadId: string, forwardId: string): Promise<SessionRecording> => {
    try {
      return (await service.runSession(threadId, `session:${forwardId}`)).recording;
    } finally {
      if (current) forgetCall(current.call_asset_id.slice("live:".length));
      current = null;
    }
  };

  // One update at a time: sessions share a graph and a clock, and a family thread has one current ask.
  let queue: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work);
    queue = next.catch(() => undefined);
    return next;
  };
  const handle = (update: TgUpdate): Promise<HandledLive> =>
    inTurn(async () => {
      if (!inbound) throw new Error("Telegram is not configured (TELEGRAM_BOT_TOKEN)");
      const handled = await inbound.handleUpdate(update);
      const fresh = handled.kind === "forwarded" && handled.outcome.accepted && handled.outcome.created;
      return { update: handled, recording: fresh && callsPlaced ? await runFor(handled.thread_id, handled.forward_id) : null };
    });
  const ask = (payload: unknown): Promise<{ outcome: ForwardOutcome; recording: SessionRecording | null }> =>
    inTurn(async () => {
      const outcome = await service.forwardAsk(payload);
      const fresh = outcome.accepted && outcome.created;
      return { outcome, recording: fresh && callsPlaced ? await runFor(outcome.thread_id, outcome.forward_id) : null };
    });

  return { client, botUsername, callMode: config.callMode, handle, ask };
}
