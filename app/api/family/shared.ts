import { isFamily } from "@/server/operator";
import { getLiveRecall, type LiveRecall } from "@/server/recall-live";

export const guard = (request: Request, memberId?: string): Response | null => (isFamily(request, memberId) ? null : Response.json({ error: "not allowed" }, { status: 403 }));

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
