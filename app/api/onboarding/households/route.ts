/** Start a household: her, and the caregiver setting Recall up with her. Operators only; see ../shared.ts. LIVE ONLY. */
import { getOnboarding } from "@/server/onboarding";
import { bodyOf, guard, optional, respond, text } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const person = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export async function POST(request: Request): Promise<Response> {
  const refused = guard(request);
  if (refused) return refused;
  const body = await bodyOf(request);
  if (!body) return Response.json({ error: "expected { participant: { display_name, phone, subject_pronoun? }, caregiver: { display_name, subject_pronoun? } }" }, { status: 400 });
  const [her, caregiver] = [person(body.participant), person(body.caregiver)];
  return respond(async () => {
    const made = await getOnboarding().createHousehold({
      participant: { display_name: text(her.display_name), subject_pronoun: optional(her.subject_pronoun), phone: text(her.phone) },
      caregiver: { display_name: text(caregiver.display_name), subject_pronoun: optional(caregiver.subject_pronoun) },
    });
    // Her number is not echoed back: it was just typed in, and nothing downstream needs to read it from here.
    return { household: made.household, participant_id: made.participant.person_id, caregiver_id: made.caregiver.person_id };
  }, true);
}
