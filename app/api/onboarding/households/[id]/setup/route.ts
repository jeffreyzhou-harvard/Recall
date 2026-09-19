/**
 * Record a version of the setup. Two kinds, and the difference is the point:
 *
 *   joint       { document, agreed_by: [her, a caregiver, ...], recorded_by }   the only way to add or widen anything
 *   tightening  { document, by }                                                she, or a caregiver, alone: revoke, narrow, pause
 *   reconfirm   { agreed_by, recorded_by }                                      the periodic re-confirmation (rule 14)
 *
 * Operators only. LIVE ONLY.
 */
import { getOnboarding } from "@/server/onboarding";
import { bodyOf, guard, optional, respond, text, texts } from "../../../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const refused = guard(request);
  if (refused) return refused;
  const body = await bodyOf(request);
  const kind = body?.kind;
  if (!body || (kind !== "joint" && kind !== "tightening" && kind !== "reconfirm")) return Response.json({ error: 'expected { kind: "joint" | "tightening" | "reconfirm", ... }' }, { status: 400 });
  const { id } = await ctx.params;
  const onboarding = getOnboarding();
  return respond(() => {
    if (kind === "joint") return onboarding.recordJointSetup(id, body.document, texts(body.agreed_by), text(body.recorded_by), optional(body.note));
    if (kind === "tightening") return onboarding.tightenSetup(id, body.document, text(body.by), optional(body.note));
    return onboarding.recordReconfirmation(id, texts(body.agreed_by), text(body.recorded_by));
  }, true);
}
