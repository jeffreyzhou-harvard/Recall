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
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FAMILY_SEED, GOLDEN_TRANSCRIPT, JUDGED_TIMING, MANIFEST, POLICY } from "@/fixtures";
import { TelegramClient, type FetchLike, type TgUpdate } from "@/lib/bridge/telegram/api";
import { parseBindings, type TelegramBindings } from "@/lib/bridge/telegram/bindings";
import { TelegramThreadBridge, type RecordingProvider } from "@/lib/bridge/telegram/bridge";
import { TelegramInbound, type HandledUpdate, type MediaStore } from "@/lib/bridge/telegram/inbound";
import { FixtureClock } from "@/lib/clock";
import { MemoryGraphStore } from "@/lib/graph/memory-store";
import { buildGraph } from "@/lib/graph/seed";
import { FixtureCallDriver } from "@/lib/orchestrator/call-driver";
import { AssetIndex } from "@/lib/provenance/assets";
import { cutWav } from "@/lib/provenance/wav";
import { FixtureTranscription } from "@/lib/providers/transcription";
import { RelayService } from "@/lib/service/relay-service";
import type { SessionRecording } from "@/lib/session/recording";
import { policySchema } from "@/lib/tools";

export type CallMode = "none" | "prerecorded";

export interface LiveConfig {
  token: string;
  bindings: TelegramBindings;
  callMode: CallMode;
  /** Project root: where /assets is read from and .data/media is written to. */
  root: string;
  fetchImpl?: FetchLike;
  /** Start of the session clock. Defaults to now; injectable so tests are repeatable. */
  now?: string;
}

export function configFromEnv(env: NodeJS.ProcessEnv, root: string): LiveConfig {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set (see .env.example)");
  const callMode = env.RELAY_CALL ?? "none";
  if (callMode !== "none" && callMode !== "prerecorded") throw new Error(`RELAY_CALL must be "none" or "prerecorded", not "${callMode}"`);
  return { token, bindings: parseBindings(env.RELAY_TELEGRAM_BINDINGS), callMode, root };
}

export interface HandledLive {
  update: HandledUpdate;
  /** Present when a session ran (prerecorded mode, accepted forward). */
  recording: SessionRecording | null;
}

export interface LiveRelay {
  client: TelegramClient;
  botUsername: string;
  callMode: CallMode;
  handle(update: TgUpdate): Promise<HandledLive>;
}

export async function createLiveRelay(config: LiveConfig): Promise<LiveRelay> {
  const client = new TelegramClient(config.token, config.fetchImpl);
  const me = await client.getMe();
  const botUsername = me.username ?? "";

  const assets = new AssetIndex(MANIFEST);
  const graph = MemoryGraphStore.from(buildGraph(FAMILY_SEED, assets));
  const clock = new FixtureClock(config.now ?? new Date().toISOString());

  // Her recording, cut to the kept spans. Bytes are copied, never re-encoded (lib/provenance/wav.ts).
  const recording: RecordingProvider = async (card) => {
    const asset = assets.get(card.audio.asset_id);
    const wav = cutWav(new Uint8Array(readFileSync(join(config.root, asset.path))), card.audio.kept);
    return wav ? { bytes: wav, filename: `${card.speaker_name.toLowerCase()}-answer.wav`, mime: "audio/wav" } : null;
  };
  const bridge = new TelegramThreadBridge(client, config.bindings, recording);

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
  const service = new RelayService({
    graph,
    policy: policySchema.parse(POLICY),
    assets,
    clock,
    bridge,
    transcription: new FixtureTranscription(prerecorded ? [GOLDEN_TRANSCRIPT] : []),
    callDriver: prerecorded ? () => new FixtureCallDriver(GOLDEN_TRANSCRIPT, clock, JUDGED_TIMING.call_connect_delay_ms) : null,
    runtime: { fixtureLatency: { clock, ms, default_ms } },
  });
  const inbound = new TelegramInbound({ client, bridge, service, assets, media, bindings: config.bindings, botUsername });

  // One update at a time: sessions share a graph and a clock, and a family thread has one current ask.
  let queue: Promise<unknown> = Promise.resolve();
  const handle = (update: TgUpdate): Promise<HandledLive> => {
    const next = queue.then(async (): Promise<HandledLive> => {
      const handled = await inbound.handleUpdate(update);
      const fresh = handled.kind === "forwarded" && handled.outcome.accepted && handled.outcome.created;
      if (!fresh || !prerecorded) return { update: handled, recording: null };
      const run = await service.runSession(handled.thread_id, `session:${handled.forward_id}`);
      return { update: handled, recording: run.recording };
    });
    queue = next.catch(() => undefined);
    return next;
  };

  return { client, botUsername, callMode: config.callMode, handle };
}
