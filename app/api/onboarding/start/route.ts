/** Same-origin, blank-install-only setup. The first caregiver receives a scoped browser session. */
import { getOnboarding } from "@/server/onboarding";
import { issueAccount, revokeAccount } from "@/server/accounts";
import { firstSetupConfigured } from "@/server/household-access";
import { sameOrigin, sessionCookie } from "@/server/session";
import { bodyOf, optional, respond, text } from "../shared";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const person = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ error: "Open setup from Recall." }, { status: 403 });
  if (!firstSetupConfigured()) return Response.json({ error: "This Recall already has private access. Sign in to continue." }, { status: 403 });
  const body = await bodyOf(request);
  if (!body) return Response.json({ error: "Enter the person’s name, phone number, and your name." }, { status: 400 });
  const participant = person(body.participant), caregiver = person(body.caregiver);
  let cookie = "", member: string | undefined, issuedKey: string | undefined;
  const result = await respond(async () => {
    try {
      const made = await getOnboarding().createFirstHousehold({
        participant: { display_name: text(participant.display_name), phone: text(participant.phone), subject_pronoun: optional(participant.subject_pronoun) },
        caregiver: { display_name: text(caregiver.display_name), subject_pronoun: optional(caregiver.subject_pronoun) },
      }, async (created) => {
        member = created.caregiver.person_id;
        issuedKey = issueAccount(created.household.household_id, member, "family");
        cookie = sessionCookie({ role: "family", member_id: member }, request);
      });
      return { household: made.household, participant_id: made.participant.person_id, caregiver_id: made.caregiver.person_id };
    } catch (error) {
      if (member && issuedKey) revokeAccount(member, issuedKey);
      throw error;
    }
  }, true);
  if (result.ok) result.headers.set("Set-Cookie", cookie);
  return result;
}
