/**
 * Start a call. LIVE ONLY: the judged /present route never opens a room.
 *
 * Only Relay starts calls, and only once the access policy has granted an ask (the orchestrator
 * builds its call driver after the grant, never before). This endpoint is how that driver gets a
 * room; it is not something a visitor can use to ring someone.
 */
import { callHub, mayCreateRoom } from "@/server/call-rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!mayCreateRoom(request)) return Response.json({ error: "not allowed to start a call" }, { status: 403 });
  const ticket = callHub().createRoom();
  // Her token rides in the URL fragment, which browsers never send to a server or write to an access log.
  return Response.json({
    room_id: ticket.room_id,
    relay_token: ticket.tokens.relay,
    participant_path: `/call/${ticket.room_id}#${ticket.tokens.participant}`,
    expires_at: new Date(ticket.expires_at).toISOString(),
  });
}
