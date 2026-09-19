/** Ask, don't assert: record a tie between two members because a named member said so. Operators only. LIVE ONLY. */
import { getOnboarding } from "@/server/onboarding";
import { bodyOf, guard, optional, respond, text } from "../../../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const refused = guard(request);
  if (refused) return refused;
  const body = await bodyOf(request);
  if (!body) return Response.json({ error: "expected { from_person_id, to_person_id, relation, said_as?, stated_by }" }, { status: 400 });
  const { id } = await ctx.params;
  return respond(() => getOnboarding().stateRelationship(id, { from_person_id: text(body.from_person_id), to_person_id: text(body.to_person_id), relation: text(body.relation), said_as: optional(body.said_as) }, text(body.stated_by)), true);
}
