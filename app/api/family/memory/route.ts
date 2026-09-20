/** "Tell Recall about a memory you share with Susan." One-way: a thank-you or a hint comes back, never anything from the graph. LIVE ONLY. */
import { bodyOf, guard, liveRecall, familyResponse } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

export async function POST(request: Request): Promise<Response> {
  const refused = guard(request);
  if (refused) return refused;
  const body = await bodyOf(request);
  if (!body || typeof body.member !== "string" || text(body.what_happened, 2000).trim() === "") return Response.json({ error: "expected { member, who, what_happened, when_where? }" }, { status: 400 });
  const deniedMember = guard(request, body.member);
  if (deniedMember) return deniedMember;
  const member = body.member;
  return familyResponse(async () => {
  const live = await liveRecall();
  const attachment = typeof body.asset_id === "string" ? live.media?.get(body.asset_id) : null;
  if (body.asset_id && (!attachment || attachment.owner !== member)) return Response.json({ error: "This attachment is no longer available to your account." }, { status: 400 });
  const out = await live.service.tellRecallAMemory({
    contributor_id: member,
    claim: { who: text(body.who, 200), what_happened: text(body.what_happened, 2000), when_where: text(body.when_where, 200) || null, photo_asset_id: attachment?.entry.id ?? null, about_topic_id: typeof body.about_topic_id === "string" ? body.about_topic_id : null },
    provenance: { medium: attachment ? attachment.entry.kind === "image" ? "photo" : "voice_note" : "text", received_at: new Date().toISOString() },
  });
  if (out.status === "stored_as_family_claim" && attachment) live.media!.keep(attachment.entry.id);
  return Response.json(out);
  });
}
