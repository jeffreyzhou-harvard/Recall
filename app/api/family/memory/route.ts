/** "Tell Recall about a memory you share with Susan." One-way: a thank-you or a hint comes back, never anything from the graph. LIVE ONLY. */
import { bodyOf, guard, liveRecall } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

export async function POST(request: Request): Promise<Response> {
  const refused = guard(request);
  if (refused) return refused;
  const body = await bodyOf(request);
  if (!body || typeof body.member !== "string" || text(body.what_happened, 2000).trim() === "") return Response.json({ error: "expected { member, who, what_happened, when_where? }" }, { status: 400 });
  const out = await (await liveRecall()).service.tellRecallAMemory({
    contributor_id: body.member,
    claim: { who: text(body.who, 200), what_happened: text(body.what_happened, 2000), when_where: text(body.when_where, 200) || null, photo_asset_id: null, about_topic_id: null },
    provenance: { medium: "text", received_at: new Date().toISOString() },
  });
  return Response.json(out);
}
