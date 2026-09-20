/**
 * One turn of the schedule, for the live side demo. LIVE ONLY, operators only.
 *
 * It takes no topic and no requester: what happens is decided by the graph, the joint setup, and the
 * clock - which topic is due, and whether she may be called now at all. There is no route by which a
 * family member can cause a call to her (AGENTS.md rule 5). The request stays open until the call ends.
 */
import { scheduleTick, schedulerError } from "@/server/scheduler";
import { isOperator } from "@/server/operator";
import { getLiveRecall } from "@/server/recall-live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

export async function POST(request: Request): Promise<Response> {
  if (!isOperator(request)) return Response.json({ error: "not allowed" }, { status: 403 });
  const recall = await getLiveRecall();
  if (recall.callMode === "none") return Response.json({ error: "this deployment cannot place calls (RECALL_CALL=none)" }, { status: 409 });
  const recording = recall.callMode === "web" ? await scheduleTick() : await recall.tick();
  return Response.json({ outcome: recording ? "completed" : "nothing_due" });
}

/** Operator diagnostics contain configuration state and sanitized failures, never call content. */
export async function GET(request: Request): Promise<Response> {
  if (!isOperator(request)) return Response.json({ error: "not allowed" }, { status: 403 });
  return Response.json({ web_configured: process.env.RECALL_CALL === "web" && !!process.env.DEEPGRAM_API_KEY, scheduler_enabled: process.env.RECALL_SCHEDULER === "1", issue: schedulerError() }, { headers: { "Cache-Control": "no-store" } });
}
