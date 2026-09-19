/**
 * What an approved member sees when they open the dashboard: the Weekly Note (posted now if one is due),
 * the per-topic record if their detail level includes it, and - for a designated caregiver only - any
 * safety alert. Nothing here is pushed; it exists when it is opened (AGENTS.md rule 5). LIVE ONLY.
 */
import { guard, liveRecall } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const refused = guard(request);
  if (refused) return refused;
  const member = new URL(request.url).searchParams.get("member");
  if (!member) return Response.json({ error: "expected ?member=" }, { status: 400 });
  const deniedMember = guard(request, member);
  if (deniedMember) return deniedMember;
  const recall = await liveRecall();
  const designated = recall.setup.current().safety.designated_caregivers.some((c) => c.person_id === member);
  return Response.json({
    weekly_note: await recall.service.weeklyNote(member),
    topic_record: await recall.service.topicRecord(member),
    // The alert card is shown to a designated caregiver and to nobody else.
    safety_alerts: designated ? recall.alerts.sentTo(member) : [],
  });
}
