import { getOnboarding } from "@/server/onboarding";
import { OnboardingError } from "@/lib/onboarding/types";
import { activeHousehold, selectHousehold } from "@/server/active-household";
import { householdGuard } from "@/server/household-access";
import { isOperator } from "@/server/operator";
import { bodyOf, respond } from "../shared";
export async function POST(request: Request): Promise<Response> {
  const body = await bodyOf(request);
  if (typeof body?.household_id !== "string") return Response.json({ error: "Choose a household." }, { status: 400 });
  const denied = await householdGuard(request, body.household_id); if (denied) return denied;
  if (!isOperator(request) && activeHousehold() && activeHousehold() !== body.household_id) return Response.json({ error: "This Recall is already connected to another household." }, { status: 409 });
  return respond(async () => {
    const id = body.household_id as string;
    if (!await getOnboarding().currentSetup(id)) throw new OnboardingError("needs_joint_agreement", "Save the joint setup first.");
    selectHousehold(id);
    return { household_id: id };
  });
}
