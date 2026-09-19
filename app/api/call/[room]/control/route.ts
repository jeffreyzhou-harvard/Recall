/** Call control for Relay's call page: commands down (say this, play that back, hang up), acknowledgements up. */
import { ackSchema, type CallCommand } from "@/lib/call/control";
import { callHub } from "@/server/call-rooms";
import { liveCall } from "@/server/live-calls";
import { eventStream, refusal, tokenOf, type RoomParams } from "../../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function sessionFor(request: Request, room: string) {
  if (callHub().roleFor(room, tokenOf(request)) !== "relay") throw Response.json({ error: "only Relay's side controls the call" }, { status: 403 });
  const call = liveCall(room);
  if (!call) throw Response.json({ error: "no session is driving this call" }, { status: 409 });
  return call;
}

export async function GET(request: Request, { params }: RoomParams): Promise<Response> {
  try {
    const call = await sessionFor(request, (await params).room);
    return eventStream<CallCommand>(request, (push) => call.attach(push));
  } catch (e) {
    return e instanceof Response ? e : refusal(e);
  }
}

export async function POST(request: Request, { params }: RoomParams): Promise<Response> {
  try {
    const call = await sessionFor(request, (await params).room);
    const ack = ackSchema.safeParse(await request.json().catch(() => null));
    if (!ack.success) return Response.json({ error: "bad request" }, { status: 400 });
    call.acknowledge(ack.data);
    return new Response(null, { status: 204 });
  } catch (e) {
    return e instanceof Response ? e : refusal(e);
  }
}
