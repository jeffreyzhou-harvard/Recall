import { browserPrincipal } from "@/server/session";
import { activeHousehold } from "@/server/active-household";
import { getOnboarding } from "@/server/onboarding";
import { liveRecall, familyResponse } from "../shared";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const principal = browserPrincipal(request), household = activeHousehold();
  if (!principal || !household) return Response.json({ error: "not allowed" }, { status: 403 });
  return familyResponse(async () => {
    const onb = getOnboarding(), people = await onb.people(household), setup = await onb.currentSetup(household);
    const actor = principal.role === "operator" ? setup?.document.recall_set_up_by : principal.member_id;
    if (!setup || !people.some((p) => p.person_id === actor && !p.removed_at && ["caregiver", "participant"].includes(p.role))) return Response.json({ error: "Only the participant or a caregiver may pause calls." }, { status: 403 });
    const live = await liveRecall(); live.currentCall()?.stop();
    await onb.tightenSetup(household, { ...setup.document, calls_paused: true }, actor!);
    await live.refreshSetup();
    return Response.json({ paused: true });
  });
}
