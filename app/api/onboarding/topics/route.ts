import { guard, bodyOf } from "../shared";
import { liveRecall, familyResponse } from "../../family/shared";
import { topicChoices, createTopic, topicDraft } from "@/server/topics";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const denied = guard(request); if (denied) return denied;
  return familyResponse(async () => Response.json(await topicChoices((await liveRecall()).graph), { headers: { "Cache-Control": "no-store" } }));
}
export async function POST(request: Request) {
  const denied = guard(request); if (denied) return denied;
  const input = topicDraft.safeParse(await bodyOf(request));
  if (!input.success) return Response.json({ error: "Enter a contributor, short topic name, and their story." }, { status: 400 });
  return familyResponse(async () => {
    const live = await liveRecall();
    try { return Response.json(await createTopic(live.graph, live.setup.current(), input.data), { status: 201 }); }
    catch { return Response.json({ error: "Use an approved contributor and a short topic name without sentences or questions." }, { status: 400 }); }
  });
}
