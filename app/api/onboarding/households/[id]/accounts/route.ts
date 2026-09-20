import { householdGuard } from "@/server/household-access";
import { browserPrincipal, credentials, sessionCookie } from "@/server/session";
import { getOnboarding } from "@/server/onboarding";
import { issueAccount, revokeAccount } from "@/server/accounts";
import { bodyOf } from "../../../shared";
export const runtime = "nodejs";
async function change(request: Request, context: { params: Promise<{ id: string }> }, remove: boolean) {
  const { id } = await context.params;
  const denied = await householdGuard(request, id); if (denied) return denied;
  const body = await bodyOf(request);
  const people = await getOnboarding().people(id);
  const person = people.find((p) => p.person_id === body?.member_id && !p.removed_at);
  if (!person) return Response.json({ error: "Choose a current household member." }, { status: 400 });
  if (Object.hasOwn(credentials()?.members ?? {}, person.person_id)) return Response.json({ error: "This member uses an environment-managed key. Remove or rotate it in server configuration first." }, { status: 409 });
  const principal = browserPrincipal(request);
  if (remove) revokeAccount(person.person_id);
  const key = remove ? undefined : issueAccount(id, person.person_id, person.role === "participant" ? "patient" : "family");
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (!remove && principal?.role === "family" && principal.member_id === person.person_id) headers["Set-Cookie"] = sessionCookie(principal, request);
  return Response.json({ key, revoked: remove }, { headers });
}
export const POST = (request: Request, context: { params: Promise<{ id: string }> }) => change(request, context, false);
export const DELETE = (request: Request, context: { params: Promise<{ id: string }> }) => change(request, context, true);
