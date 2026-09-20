import { browserPrincipal } from "./session";
import { getLiveRecall } from "./recall-live";
import { accountForMember } from "./accounts";
import { activeHousehold } from "./active-household";
import { samplePatient } from "./sample-access";
import { getSampleRecall } from "./sample-call";
/** Only the patient's own credential can answer or control a call. */
export async function patientCall(request: Request) {
  if (new URL(request.url).pathname.startsWith("/api/demo/call/")) {
    const account = samplePatient(request);
    if (!account) return null;
    const live = await getSampleRecall(account.household_id);
    await live.refreshSetup();
    return live.setup.current().person_id === account.member_id ? live : null;
  }
  const principal = browserPrincipal(request);
  if (principal?.role !== "patient") return null;
  const account = accountForMember(principal.member_id);
  if (!account || account.household_id !== activeHousehold()) return null;
  const live = await getLiveRecall();
  await live.refreshSetup();
  if (live.setup.current().person_id !== principal.member_id) return null;
  return live;
}
