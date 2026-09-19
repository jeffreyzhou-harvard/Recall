/** Shared by the call routes. LIVE ONLY. */
import { HubError, type HubRefusal } from "@/lib/call/signaling";

const STATUS: Record<HubRefusal, number> = { unknown_room: 404, bad_token: 403, expired: 410, closed: 410, invalid_signal: 400 };

/** Plain words for the person holding the link; the code is for us. Never says why in a way that helps guess a token. */
export function refusal(e: unknown): Response {
  if (e instanceof HubError) return Response.json({ error: "This call link is not valid any more.", code: e.code }, { status: STATUS[e.code] });
  throw e;
}

export const tokenOf = (request: Request): string | null => new URL(request.url).searchParams.get("token");
export type RoomParams = { params: Promise<{ room: string }> };
