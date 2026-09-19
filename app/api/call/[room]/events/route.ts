/** Signaling messages down, as Server-Sent Events. Carries negotiation only; audio and video never pass through here. */
import type { HubEvent } from "@/lib/call/signaling";
import { callHub } from "@/server/call-rooms";
import { eventStream, refusal, tokenOf, type RoomParams } from "../../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: RoomParams): Promise<Response> {
  const { room } = await params;
  const token = tokenOf(request);
  try {
    callHub().roleFor(room, token); // refuse with a proper status before opening a stream
  } catch (e) {
    return refusal(e);
  }

  return eventStream<HubEvent>(request, (push, close) => {
    const seat = callHub().subscribe(room, token, (event) => {
      push(event);
      if (event.type === "closed") close();
    });
    return seat.unsubscribe;
  });
}
