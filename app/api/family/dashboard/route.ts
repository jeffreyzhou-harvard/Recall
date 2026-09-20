/**
 * What an approved member sees when they open the dashboard: the Weekly Note (posted now if one is due),
 * the per-topic record if their detail level includes it, and - for a designated caregiver only - any
 * safety alert. Nothing here is pushed; it exists when it is opened (AGENTS.md rule 5). LIVE ONLY.
 */
import { activeHousehold } from "@/server/active-household";
import { getOnboarding } from "@/server/onboarding";
import { guard, liveRecall, familyResponse } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const refused = guard(request);
  if (refused) return refused;
  const member = new URL(request.url).searchParams.get("member");
  if (!member) return Response.json({ error: "expected ?member=" }, { status: 400 });
  const deniedMember = guard(request, member);
  if (deniedMember) return deniedMember;
  return familyResponse(async () => {
  const recall = await liveRecall();
  const designated = recall.setup.current().safety.designated_caregivers.some((c) => c.person_id === member);
  const info = await recall.service.dashboardInfo(member);
  if (!info) return Response.json({ error: "Your access is no longer approved." }, { status: 403 });
  const household = activeHousehold();
  const canPause = household ? (await getOnboarding().people(household)).some((p) => p.person_id === member && p.role === "caregiver" && !p.removed_at) : false;
  return Response.json({
    can_pause: canPause, calls_paused: recall.setup.current().calls_paused,
    info,
    weekly_note: await recall.service.weeklyNote(member),
    topic_record: await recall.service.topicRecord(member),
    // Count-only, pull-only, same tone as a Weekly Note gap line. Not a Weekly Note and not a push.
    missed_call_notice: await recall.service.unansweredStreakNotice(member),
    // The alert card is shown to a designated caregiver and to nobody else.
    safety_alerts: designated ? recall.alerts.sentTo(member) : [],
  }, { headers: { "Cache-Control": "no-store" } });
  });
}
