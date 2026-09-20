import { guard, liveRecall, familyResponse } from "../shared";
import { topicChoices } from "@/server/topics";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const member = new URL(request.url).searchParams.get("member") ?? "", denied = guard(request, member); if (denied) return denied;
  return familyResponse(async () => {
    const live = await liveRecall(), p = live.setup.current();
    if (!p.approved_people.includes(member)) return Response.json({ error: "not allowed" }, { status: 403 });
    return Response.json((await topicChoices(live.graph)).filter((t) => p.topics.allow.includes(t.id) && !p.topics.block.includes(t.id)).map((t) => ({ id: t.id, label: t.label })), { headers: { "Cache-Control": "no-store" } });
  });
}
