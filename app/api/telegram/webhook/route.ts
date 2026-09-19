/**
 * Telegram webhook. LIVE ONLY: the judged /present route never touches this.
 *
 * Telegram signs nothing, so the shared secret set with setWebhook is the only
 * proof a request came from Telegram: it is required, and compared in constant
 * time. Anything without it is refused before the body is read.
 */
import { timingSafeEqual } from "node:crypto";
import { WEBHOOK_SECRET_HEADER, type TgUpdate } from "@/lib/bridge/telegram/api";
import { configFromEnv, createLiveRelay, type LiveRelay } from "@/server/relay-live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let relay: Promise<LiveRelay> | null = null;

function authentic(presented: string | null, expected: string): boolean {
  if (!presented) return false;
  const [a, b] = [Buffer.from(presented), Buffer.from(expected)];
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || !process.env.TELEGRAM_BOT_TOKEN) return new Response("Telegram is not configured", { status: 503 });
  if (!authentic(request.headers.get(WEBHOOK_SECRET_HEADER), secret)) return new Response("forbidden", { status: 403 });

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  try {
    // Built once and kept: it holds the graph. Only a failed start-up is retried on the next request.
    relay ??= createLiveRelay(configFromEnv(process.env, process.cwd())).catch((e: unknown) => {
      relay = null;
      throw e;
    });
    const handled = await (await relay).handle(update);
    console.log(`[telegram] update ${update.update_id}: ${handled.update.kind}${handled.recording ? ` -> ${handled.recording.final_state}` : ""}`);
  } catch (e) {
    // Answer 200 regardless: a non-200 makes Telegram redeliver, and an update that fails once will
    // fail every time. Redelivery of a good update is already harmless (forward ids are idempotent).
    console.error(`[telegram] update ${update.update_id} failed:`, e);
  }
  return new Response("ok");
}
