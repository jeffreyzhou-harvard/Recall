import { browserPrincipal } from "./session";
import { getLiveRecall } from "./recall-live";
import { accountForMember } from "./accounts";
import { activeHousehold } from "./active-household";
/** Only the patient's own credential can answer or control a call. */
export async function patientCall(request: Request) {
  const principal = browserPrincipal(request);
  if (principal?.role !== "patient") return null;
  const account = accountForMember(principal.member_id);
  if (!account || account.household_id !== activeHousehold()) return null;
  const live = await getLiveRecall();
  await live.refreshSetup();
  if (live.setup.current().person_id !== principal.member_id) return null;
  return live;
}
