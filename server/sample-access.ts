/** Separate signed demo sessions let caregiver and patient tabs stay open together. */
import { accountForMember, issueAccount } from "./accounts";
import { getOnboarding } from "./onboarding";
import { browserPrincipal, sameOrigin } from "./session";
import { CircleError, readCircle, updateCircle } from "./circle/store";
import { loadSampleFamily } from "./circle/sample";

export const SAMPLE_PATIENT_COOKIE = "recall_sample_patient";
export function localSampleRequest(request: Request) {
  return process.env.NODE_ENV === "development" && ["localhost", "127.0.0.1"].includes(new URL("http://" + (request.headers.get("host") || new URL(request.url).host)).hostname);
}
export function requireLocalSample(request: Request) {
  if (!localSampleRequest(request)) throw new CircleError("The sample family is available in the local demo.", 404);
  if (!["GET", "HEAD"].includes(request.method) && !sameOrigin(request)) throw new CircleError("Open this action from Recall.", 403);
}
export function samplePatient(request: Request) {
  if (!localSampleRequest(request)) return null;
  const principal = browserPrincipal(request, SAMPLE_PATIENT_COOKIE);
  if (principal?.role !== "patient") return null;
  const account = accountForMember(principal.member_id);
  return account?.role === "patient" && readCircle(account.household_id).demo ? account : null;
}
export async function openSampleFamily(request: Request, { fresh = false }: { fresh?: boolean } = {}) {
  requireLocalSample(request);
  const principal = browserPrincipal(request);
  const current = principal?.role === "family" ? accountForMember(principal.member_id) : null;
  const existing = current && readCircle(current.household_id).demo ? current : samplePatient(request);
  const onboarding = getOnboarding();
  if (existing && !fresh) {
    const people = await onboarding.people(existing.household_id);
    const caregiver = people.find(p => p.role === "caregiver"), participant = people.find(p => p.role === "participant");
    if (caregiver && participant) return { household: existing.household_id, caregiver, participant };
  }
  const made = await onboarding.createHousehold({ participant: { display_name: "Susan", phone: "+1555" + String(Date.now()).slice(-7) }, caregiver: { display_name: "Maya" } });
  const household = made.household.household_id;
  issueAccount(household, made.caregiver.person_id, "family");
  updateCircle(household, state => { state.demo = true; });
  await loadSampleFamily(household, made.caregiver.person_id, "Maya");
  return { household, caregiver: made.caregiver, participant: made.participant };
}
