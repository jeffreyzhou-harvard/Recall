/**
 * Onboarding routes. LIVE ONLY.
 *
 * Household routes accept the operator or a current caregiver with a household-bound account. Actor
 * fields are bound to that caregiver. First setup is a separate, blank-install-only transaction; an
 * invitation token is the credential for joining. Joint consent rules remain in lib/onboarding.
 */
import { OnboardingError, type OnboardingErrorCode } from "@/lib/onboarding/types";
import { isOperator } from "@/server/operator";

export { bodyOf } from "../family/shared";

export const guard = (request: Request): Response | null => (isOperator(request) ? null : Response.json({ error: "not allowed" }, { status: 403 }));

const STATUS: Record<OnboardingErrorCode, number> = { not_found: 404, not_a_member: 403, not_allowed: 403, invalid: 400, already_exists: 409, needs_joint_agreement: 409, clinical_language: 422 };

/** Runs one onboarding action and turns a refusal into its status code. Anything else is a real fault. */
export async function respond(work: () => Promise<unknown>, created = false): Promise<Response> {
  try {
    return Response.json(await work(), { status: created ? 201 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof OnboardingError) return Response.json({ error: e.code, detail: e.message }, { status: STATUS[e.code] });
    throw e;
  }
}

export const text = (v: unknown): string => (typeof v === "string" ? v : "");
export const texts = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
export const optional = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
