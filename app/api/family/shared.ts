/**
 * The family side's routes. LIVE ONLY.
 *
 * There is no sign-in yet, so `member` is whoever the caller says they are. Until there is, these routes
 * are open in development and need the family secret in production - which is NOT the operator's: whatever
 * opens these routes must never be able to turn the schedule and so cause a call to her (rule 5). What a member
 * may see is still decided, every time, by the joint setup (rule 14): an id that is not an approved
 * member with a live grant gets nothing.
 */
import { isFamily } from "@/server/operator";
import { getLiveRecall, type LiveRecall } from "@/server/recall-live";

export const guard = (request: Request): Response | null => (isFamily(request) ? null : Response.json({ error: "not allowed" }, { status: 403 }));

export async function bodyOf(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The live Recall, with the joint setup re-read first: a revocation is in force before the next dashboard load (rule 12). */
export async function liveRecall(): Promise<LiveRecall> {
  const recall = await getLiveRecall();
  await recall.refreshSetup();
  return recall;
}
