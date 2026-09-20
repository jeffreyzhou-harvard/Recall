import { isFamily } from "@/server/operator";
import { getLiveRecall, type LiveRecall } from "@/server/recall-live";
import { browserPrincipal } from "@/server/session";
import { accountForMember } from "@/server/accounts";
import { activeHousehold } from "@/server/active-household";
import { localSampleRequest } from "@/server/sample-access";
import { ensureSampleCallHistory, getSampleRecall } from "@/server/sample-call";
import { readCircle } from "@/server/circle/store";

export const guard = (request: Request, memberId?: string): Response | null => (isFamily(request, memberId) ? null : Response.json({ error: "not allowed" }, { status: 403 }));

export async function bodyOf(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Bind the local rehearsal to the signed caregiver's sample, never a caller-supplied household. */
function sampleHousehold(request?: Request): string | null {
  if (!request || !localSampleRequest(request)) return null;
  const principal = browserPrincipal(request);
  if (principal?.role !== "family") return null;
  const account = accountForMember(principal.member_id);
  return account?.role === "family" && readCircle(account.household_id).demo ? account.household_id : null;
}
export function familyHousehold(request: Request): string | null {
  return sampleHousehold(request) ?? activeHousehold() ?? null;
}

/** Re-read setup before every load; the same tools enforce revocations in both transports. */
export async function liveRecall(request?: Request): Promise<LiveRecall> {
  const sample = sampleHousehold(request);
  if (sample) await ensureSampleCallHistory(sample);
  const recall = sample ? await getSampleRecall(sample) : await getLiveRecall();
  await recall.refreshSetup();
  return recall;
}

/** Expected empty-install state, never a fallback to sample data. */
export async function familyResponse(work: () => Promise<Response>): Promise<Response> {
  try { return await work(); }
  catch (error) {
    if (error instanceof Error && error.name === "SetupRequiredError") return Response.json({ error: error.message, code: "setup_required" }, { status: 409 });
    console.error("Family request failed", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "Recall could not complete this request. Please reload before making another change." }, { status: 503 });
  }
}
