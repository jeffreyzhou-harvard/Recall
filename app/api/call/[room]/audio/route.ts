/**
 * Her audio, from Relay's call page to the server, in small chunks of raw 16-bit PCM. It has to come
 * this way: the speech-to-text key can never be in a browser. Held in memory for the call only (rule 8).
 */
import { callHub } from "@/server/call-rooms";
import { liveCall } from "@/server/live-calls";
import { refusal, tokenOf, type RoomParams } from "../../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: RoomParams): Promise<Response> {
  const { room } = await params;
  try {
    if (callHub().roleFor(room, tokenOf(request)) !== "relay") return Response.json({ error: "only Relay's side sends audio" }, { status: 403 });
  } catch (e) {
    return refusal(e);
  }
  const call = liveCall(room);
  if (!call) return Response.json({ error: "no session is driving this call" }, { status: 409 });
  call.pushAudio(new Uint8Array(await request.arrayBuffer()));
  return new Response(null, { status: 204 });
}
