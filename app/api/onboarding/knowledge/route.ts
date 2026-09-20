import { guard, bodyOf } from "../shared";
import { liveRecall, familyResponse } from "../../family/shared";
import { importKnowledge, importSchema } from "@/server/knowledge-import";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const denied = guard(request); if (denied) return denied;
  return familyResponse(async () => Response.json(await (await liveRecall()).knowledge.status(), { headers: { "Cache-Control": "no-store" } }));
}
export async function POST(request: Request) {
  const denied = guard(request); if (denied) return denied;
  const input = importSchema.safeParse(await bodyOf(request));
  if (!input.success) return Response.json({ error: "Review up to 20 selected items and choose an approved contributor." }, { status: 400 });
  return familyResponse(async () => {
    const live = await liveRecall();
    try { return Response.json(await importKnowledge(live, input.data), { status: 201, headers: { "Cache-Control": "no-store" } }); }
    catch { return Response.json({ error: "The import was not saved. Check topic names, approved contacts, dates, and photo ownership, then review the selection again." }, { status: 400 }); }
  });
}
