import { getOnboarding } from "@/server/onboarding";
import { OnboardingError } from "@/lib/onboarding/types";
import { selectHousehold } from "@/server/active-household";
import { bodyOf, guard, respond } from "../shared";
export async function POST(request: Request): Promise<Response> {
  const denied = guard(request); if (denied) return denied;
  const body = await bodyOf(request);
  if (typeof body?.household_id !== "string") return Response.json({ error: "Choose a household." }, { status: 400 });
  return respond(async () => {
    const id = body.household_id as string;
    if (!await getOnboarding().currentSetup(id)) throw new OnboardingError("needs_joint_agreement", "Save the joint setup first.");
    selectHousehold(id);
    return { household_id: id };
  });
}
