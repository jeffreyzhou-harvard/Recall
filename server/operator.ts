/**
 * Who may operate Recall's server-side controls: turning the schedule, and - until there is a sign-in - the
 * family routes. In production a shared secret is required; with none configured, nobody can (fail closed).
 * In development it is open, for local testing. LIVE ONLY.
 */
import { timingSafeEqual } from "node:crypto";

export function isOperator(request: Request): boolean {
  const secret = process.env.RECALL_OPERATOR_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const [a, b] = [Buffer.from(request.headers.get("x-recall-operator") ?? ""), Buffer.from(secret)];
  return a.length === b.length && timingSafeEqual(a, b);
}
