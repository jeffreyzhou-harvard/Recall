import { webhookFor } from "@/server/alerts";
import { attestationsMissing } from "@/lib/tools/policy";
import { z } from "zod";
import { getOnboarding } from "@/server/onboarding";
import { activeHousehold } from "@/server/active-household";
import { liveRecall } from "../../../../family/shared";
import { topicChoices } from "@/server/topics";
import { guard, bodyOf, respond } from "../../../shared";
import { OnboardingError } from "@/lib/onboarding/types";
const choices = z.strictObject({ expected_version: z.number().int().positive(), patient_agreed: z.literal(true), caregiver_agreed: z.literal(true), members: z.array(z.strictObject({ id: z.string(), approved: z.boolean(), detail: z.enum(["none", "weekly_note", "weekly_note_and_record"]) })), topics: z.array(z.string()), web_calls_enabled: z.boolean().optional(), alert_channel: z.enum(["dashboard", "webhook"]).optional() });
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = guard(request); if (denied) return denied;
  const input = choices.safeParse(await bodyOf(request));
  if (!input.success) return Response.json({ error: "Review the choices together and record both agreements." }, { status: 400 });
  const { id } = await context.params;
  if (id !== activeHousehold(process.cwd())) return Response.json({ error: "Open the active household." }, { status: 409 });
  return respond(async () => {
    const onb = getOnboarding(), current = await onb.currentSetup(id), people = (await onb.people(id)).filter((p) => !p.removed_at);
    if (!current) throw new OnboardingError("needs_joint_agreement", "Complete the initial joint setup.");
    const p = input.data, doc = structuredClone(current.document), now = new Date().toISOString();
    const patient = people.find((m) => m.role === "participant")!, caregiver = people.find((m) => m.person_id === doc.recall_set_up_by && m.role === "caregiver");
    if (!caregiver || new Set(p.members.map((m) => m.id)).size !== p.members.length || p.members.some((m) => !people.some((person) => person.person_id === m.id && person.role !== "participant") || (!m.approved && m.detail !== "none"))) throw new OnboardingError("invalid", "Check the household members and their access.");
    const known = await topicChoices((await liveRecall()).graph);
    if (p.topics.some((t) => !known.some((k) => k.id === t && p.members.some((m) => m.id === k.contributor_id && m.approved)))) throw new OnboardingError("invalid", "Choose topics from approved contributors.");
    doc.approved_people = p.members.filter((m) => m.approved).map((m) => m.id);
    doc.formerly_approved = [...new Set([...doc.formerly_approved, ...current.document.approved_people.filter((m) => !doc.approved_people.includes(m))])];
    doc.topics.allow = [...new Set(p.topics)]; doc.topics.block = [...new Set([...doc.topics.block.filter((t) => !p.topics.includes(t)), ...current.document.topics.allow.filter((t) => !p.topics.includes(t))])];
    doc.dashboard.grants = doc.dashboard.grants.map((g) => g.revoked_at === null ? { ...g, revoked_at: now } : g);
    for (const m of p.members) if (m.approved && m.detail !== "none") doc.dashboard.grants.push({ member_id: m.id, detail_level: m.detail, granted_at: now, revoked_at: null });
    if (p.alert_channel) doc.safety.designated_caregivers = doc.safety.designated_caregivers.map((c) => ({ ...c, alert_channel: p.alert_channel! }));
    if (p.web_calls_enabled !== undefined) {
      doc.call_transport = "web"; doc.calls_paused = !p.web_calls_enabled;
      if (p.web_calls_enabled && (process.env.RECALL_CALL !== "web" || !process.env.DEEPGRAM_API_KEY || !doc.topics.allow.length || attestationsMissing(doc).length || doc.safety.designated_caregivers.some((c) => c.alert_channel === "webhook" && !webhookFor(c.person_id)))) throw new OnboardingError("invalid", "Configure web calling and its voice provider, approve a topic, and complete the introduction first.");
    }
    doc.established_by = [patient.person_id, caregiver.person_id]; doc.established_at = now; doc.dashboard.last_reconfirmed_at = now;
    return onb.recordJointSetup(id, doc, doc.established_by, caregiver.person_id, null, p.expected_version);
  });
}
