/**
 * One turn of the schedule, for the live side demo. LIVE ONLY, operators only.
 *
 * It takes no topic and no requester: what happens is decided by the graph, the joint setup, and the
 * clock - which topic is due, and whether she may be called now at all. There is no route by which a
 * family member can cause a call to her (AGENTS.md rule 5). The request stays open until the call ends.
 */
import { isOperator } from "@/server/operator";
import { getLiveRelay } from "@/server/relay-live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

export async function POST(request: Request): Promise<Response> {
  if (!isOperator(request)) return Response.json({ error: "not allowed" }, { status: 403 });
  const relay = await getLiveRelay();
  if (relay.callMode === "none") return Response.json({ error: "this deployment cannot place calls (RELAY_CALL=none)" }, { status: 409 });
  return Response.json({ recording: await relay.tick() });
}
