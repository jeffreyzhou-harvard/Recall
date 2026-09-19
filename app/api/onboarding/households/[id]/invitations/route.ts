/**
 * Invite a named person into the household. The token is returned ONCE, here, for the inviter to pass on
 * themselves - Recall never contacts family (rule 5) - and only its hash is kept. Operators only. LIVE ONLY.
 */
import { getOnboarding, newInvitationToken } from "@/server/onboarding";
import { bodyOf, guard, respond, text } from "../../../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const refused = guard(request);
  if (refused) return refused;
  const body = await bodyOf(request);
  const role = body?.role;
  if (!body || (role !== "caregiver" && role !== "family")) return Response.json({ error: 'expected { display_name, role: "caregiver" | "family", invited_by }' }, { status: 400 });
  const { id } = await ctx.params;
  const { token, token_hash } = newInvitationToken();
  return respond(async () => {
    const { token_hash: _kept, ...invitation } = await getOnboarding().invite(id, { display_name: text(body.display_name), role }, text(body.invited_by), token_hash);
    return { invitation, token };
  }, true);
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const refused = guard(request);
  if (refused) return refused;
  const body = await bodyOf(request);
  if (!body) return Response.json({ error: "expected { invitation_id, by }" }, { status: 400 });
  const { id } = await ctx.params;
  return respond(async () => (await getOnboarding().withdrawInvitation(id, text(body.invitation_id), text(body.by)), { withdrawn: true }));
}
