import { z } from "zod";
import { guard, bodyOf, familyResponse, liveRecall } from "../shared";
import { reviewItems, reviewKnowledge } from "@/server/knowledge-review";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const member = new URL(request.url).searchParams.get("member") ?? "", denied = guard(request, member); if (denied) return denied;
  return familyResponse(async () => {
    const live = await liveRecall();
    if (!live.setup.current().approved_people.includes(member)) return Response.json({ error: "Not approved" }, { status: 403 });
    return Response.json(await reviewItems(live.graph, live.setup.current(), member), { headers: { "Cache-Control": "no-store" } });
  });
}
export async function POST(request: Request) {
  const denied = guard(request); if (denied) return denied;
  const body = z.strictObject({ member: z.string().min(1), ids: z.array(z.string().min(1)).min(1).max(24) }).safeParse(await bodyOf(request));
  if (!body.success) return Response.json({ error: "Select the interpretations you want to confirm." }, { status: 400 });
  const refused = guard(request, body.data.member); if (refused) return refused;
  return familyResponse(async () => {
    const live = await liveRecall();
    try { return Response.json(await reviewKnowledge(live.graph, () => live.setup.current(), body.data.member, body.data.ids)); }
    catch { return Response.json({ error: "These interpretations could not be confirmed. Review the people and places before confirming their connection, and check your contribution access." }, { status: 409 }); }
  });
}
