import { getOnboarding } from "@/server/onboarding";
import { preferencesSchema, setupFromPreferences } from "@/lib/onboarding/form";
import { OnboardingError } from "@/lib/onboarding/types";
import { bodyOf, guard, respond } from "../../../shared";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = guard(request); if (denied) return denied;
  const parsed = preferencesSchema.safeParse(await bodyOf(request));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Check your choices." }, { status: 400 });
  const { id } = await context.params;
  return respond(async () => {
    const onboarding = getOnboarding();
    const people = await onboarding.people(id);
    const participant = people.find((p) => p.role === "participant" && !p.removed_at);
    const caregiver = people.find((p) => p.role === "caregiver" && !p.removed_at);
    if (!participant || !caregiver) throw new OnboardingError("invalid", "The participant and caregiver are required.");
    const previous = await onboarding.currentSetup(id);
    if ((previous?.version ?? 0) !== parsed.data.expected_version) throw new OnboardingError("already_exists", "Setup changed in another window. Reload before saving.");
    if (previous && previous.document.safety.emergency_number !== parsed.data.emergency_number) throw new OnboardingError("invalid", "Use the existing emergency number. Safety changes require the full joint setup review.");
    const doc = setupFromPreferences(parsed.data, { household: id, participant: participant.person_id, caregiver: caregiver.person_id }, new Date().toISOString(), previous?.document);
    return onboarding.recordJointSetup(id, doc, [participant.person_id, caregiver.person_id], caregiver.person_id, null, parsed.data.expected_version);
  });
}
