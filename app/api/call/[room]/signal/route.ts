/** One signaling message up. Validated against the strict schema, then relayed to the other peer and forgotten. */
import { callHub } from "@/server/call-rooms";
import { refusal, tokenOf, type RoomParams } from "../../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: RoomParams): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  try {
    callHub().send((await params).room, tokenOf(request), body);
    return new Response(null, { status: 204 });
  } catch (e) {
    return refusal(e);
  }
}
