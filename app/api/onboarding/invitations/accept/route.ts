/** Accept an invitation. The token is the credential, so this is the one onboarding route that is not operator-only. LIVE ONLY. */
import { issueAccount } from "@/server/accounts";
import { sameOrigin } from "@/server/session";
import { getOnboarding, hashToken } from "@/server/onboarding";
import { bodyOf, optional, respond, text } from "../../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ error: "not allowed" }, { status: 403 });
  const body = await bodyOf(request);
  const token = text(body?.token);
  if (!body || token === "") return Response.json({ error: "expected { token, subject_pronoun? }" }, { status: 400 });
  return respond(async () => {
    const person = await getOnboarding().acceptInvitation(hashToken(token), { subject_pronoun: optional(body.subject_pronoun) });
    const key = issueAccount(person.household_id, person.person_id, "family");
    return { key, person_id: person.person_id, household_id: person.household_id, role: person.role, display_name: person.display_name };
  }, true);
}
