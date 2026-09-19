/** Who a call link makes you, and which ICE servers to use. Only for someone holding one of the room's two tokens. */
import { callHub, iceServers } from "@/server/call-rooms";
import { refusal, tokenOf, type RoomParams } from "../../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: RoomParams): Promise<Response> {
  try {
    const role = callHub().roleFor((await params).room, tokenOf(request));
    return Response.json({ role, ice_servers: iceServers() });
  } catch (e) {
    return refusal(e);
  }
}
