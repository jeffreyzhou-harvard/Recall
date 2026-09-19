/**
 * What an approved member sees when they open the dashboard: the Weekly Note (posted now if one is due),
 * the per-topic record if their detail level includes it, and - for a designated caregiver only - any
 * safety alert. Nothing here is pushed; it exists when it is opened (AGENTS.md rule 5). LIVE ONLY.
 */
import { getLiveRelay } from "@/server/relay-live";
import { guard } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const refused = guard(request);
  if (refused) return refused;
  const member = new URL(request.url).searchParams.get("member");
  if (!member) return Response.json({ error: "expected ?member=" }, { status: 400 });
  const relay = await getLiveRelay();
  const designated = relay.setup.current().safety.designated_caregivers.some((c) => c.person_id === member);
  return Response.json({
    weekly_note: await relay.service.weeklyNote(member),
    topic_record: await relay.service.topicRecord(member),
    // The alert card is shown to a designated caregiver and to nobody else.
    safety_alerts: designated ? relay.alerts.sentTo(member) : [],
  });
}
