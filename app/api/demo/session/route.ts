import { samplePatient } from "@/server/sample-access";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const account = samplePatient(request);
  return Response.json({ principal: account ? { role: "patient", member_id: account.member_id } : null, local_setup_available: false, first_setup_available: false, can_manage_setup: false, managed_household_id: null, household_id: account?.household_id ?? null }, { headers: { "Cache-Control": "no-store" } });
}
