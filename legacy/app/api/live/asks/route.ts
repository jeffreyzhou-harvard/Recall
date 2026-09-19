/**
 * "Ask Mom with Recall", from the web app: one forwarded ask in, the finished session's recording out.
 * The same intake, gates, and session as an ask that arrives over Telegram. Operators only. LIVE ONLY.
 */
import { mayCreateRoom } from "@/server/call-rooms";
import { getLiveRecall } from "@/server/recall-live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  if (!mayCreateRoom(request)) return Response.json({ error: "not allowed" }, { status: 403 });
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  try {
    return Response.json(await (await getLiveRecall()).ask(payload));
  } catch (e) {
    console.error("[live ask] failed:", e);
    return Response.json({ error: "the session could not be run" }, { status: 500 });
  }
}
