/** Operator and member-bound family access (AGENTS.md §2 rules 5, 14, 15). */
import { browserPrincipal, credentials, equal } from "./session";
export function isOperator(request: Request): boolean {
  const config = credentials();
  if (!config) return false;
  if (browserPrincipal(request)?.role === "operator") return true;
  // A cookie request must pass the session's origin and expiry checks, even on a local development server.
  if (request.headers.has("cookie")) return equal(request.headers.get("x-recall-operator") ?? "", config.operator);
  return equal(request.headers.get("x-recall-operator") ?? "", config.operator);
}
export function isFamily(request: Request, memberId?: string): boolean {
  const config = credentials();
  if (!config) return false;
  const p = browserPrincipal(request);
  if (p?.role === "operator" || (p?.role === "family" && (memberId === undefined || p.member_id === memberId))) return true;
  if (equal(request.headers.get("x-recall-operator") ?? "", config.operator)) return true;
  return Object.entries(config.members).some(([id, key]) => (memberId === undefined || memberId === id) && equal(request.headers.get("x-recall-family") ?? "", key));
}
