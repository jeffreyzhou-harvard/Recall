/**
 * Two keys, because they open different things. LIVE ONLY.
 *
 *   operator   turns the schedule - the one thing that can cause a call to her - and runs onboarding
 *   family     opens the family routes, until there is a sign-in
 *
 * They are separate so that whatever a family member's browser holds can never place a call (rule 5: Recall
 * has no mechanism by which a family member can trigger a same-moment call to her). The operator's key also
 * opens the family routes; the family's key opens nothing else. In production a key is required, and with
 * none configured nobody gets in (fail closed). In development both are open, for local testing.
 */
import { timingSafeEqual } from "node:crypto";

function holds(request: Request, header: string, secret: string | undefined): boolean {
  if (!secret) return false;
  const [a, b] = [Buffer.from(request.headers.get(header) ?? ""), Buffer.from(secret)];
  return a.length === b.length && timingSafeEqual(a, b);
}
const open = (...secrets: Array<string | undefined>): boolean => secrets.every((s) => !s) && process.env.NODE_ENV !== "production";

export function isOperator(request: Request): boolean {
  const secret = process.env.RECALL_OPERATOR_SECRET;
  return open(secret) || holds(request, "x-recall-operator", secret);
}

export function isFamily(request: Request): boolean {
  const [family, operator] = [process.env.RECALL_FAMILY_SECRET, process.env.RECALL_OPERATOR_SECRET];
  if (family && operator && family === operator) return holds(request, "x-recall-operator", operator); // one shared key would undo the point of having two
  return open(family, operator) || holds(request, "x-recall-family", family) || holds(request, "x-recall-operator", operator);
}
