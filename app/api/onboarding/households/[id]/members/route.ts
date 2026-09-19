/** Someone leaves the household: their permissions go first, then they do. Operators only. LIVE ONLY. */
import { getOnboarding } from "@/server/onboarding";
import { bodyOf, guard, respond, text } from "../../../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const refused = guard(request);
  if (refused) return refused;
  const body = await bodyOf(request);
  if (!body) return Response.json({ error: "expected { person_id, by }" }, { status: 400 });
  const { id } = await ctx.params;
  return respond(async () => (await getOnboarding().removeMember(id, text(body.person_id), text(body.by)), { removed: true }));
}
