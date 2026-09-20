/** A caregiver manages only the household bound to their persisted account. Never grants operator access. */
import { accountForMember } from "./accounts";
import { activeHousehold } from "./active-household";
import { getOnboarding } from "./onboarding";
import { isOperator } from "./operator";
import { browserPrincipal, credentials } from "./session";

const denied = () => Response.json({ error: "Sign in with this household’s caregiver account." }, { status: 403 });

export function firstSetupConfigured(): boolean {
  const config = credentials();
  return !!config && !config.operator && !Object.keys(config.members).length && !process.env.RECALL_POLICY_FILE && !activeHousehold();
}
export async function firstSetupAvailable(): Promise<boolean> {
  return firstSetupConfigured() && await getOnboarding().isEmpty();
}
export async function managedHousehold(request: Request): Promise<string | null> {
  const principal = browserPrincipal(request);
  if (principal?.role !== "family") return null;
  const account = accountForMember(principal.member_id);
  if (account?.role !== "family") return null;
  try {
    const members = await getOnboarding().people(account.household_id);
    return members.some((p) => p.person_id === principal.member_id && p.role === "caregiver" && !p.removed_at) ? account.household_id : null;
  } catch { return null; }
}
export async function canManageHousehold(request: Request, householdId: string): Promise<boolean> {
  return isOperator(request) || await managedHousehold(request) === householdId;
}
export async function householdGuard(request: Request, householdId: string): Promise<Response | null> {
  return await canManageHousehold(request, householdId) ? null : denied();
}
export async function activeHouseholdGuard(request: Request): Promise<Response | null> {
  if (isOperator(request)) return null;
  const id = activeHousehold();
  return id ? householdGuard(request, id) : denied();
}
/** A signed-in caregiver cannot record an action or a contributed story as a different person. */
export function actorGuard(request: Request, actorId: unknown): Response | null {
  if (isOperator(request)) return null;
  const principal = browserPrincipal(request);
  return principal?.role === "family" && principal.member_id === actorId ? null : denied();
}
export function managerActor(request: Request, fallback: string): string {
  return isOperator(request) ? fallback : browserPrincipal(request)?.member_id ?? "";
}
