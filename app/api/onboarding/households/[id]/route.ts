/** Where a household's onboarding stands: the steps, the people, the current setup. Operators only. LIVE ONLY. */
import { getOnboarding } from "@/server/onboarding";
import { guard, respond } from "../../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const refused = guard(request);
  if (refused) return refused;
  const { id } = await ctx.params;
  return respond(async () => {
    const onboarding = getOnboarding();
    const [status, people, setup] = [await onboarding.status(id), await onboarding.people(id), await onboarding.currentSetup(id)];
    // Her number stays in the database: this says only whether there is one.
    return { ...status, people: people.map(({ phone, ...rest }) => ({ ...rest, has_phone: phone !== null })), setup };
  });
}
