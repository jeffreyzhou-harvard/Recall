/** Operator credentials and member-bound family credentials (AGENTS.md §2 rules 5, 14, 15). */
import { timingSafeEqual } from "node:crypto";

function holds(request: Request, header: string, secret: string | undefined): boolean {
  if (!secret) return false;
  const [a, b] = [Buffer.from(request.headers.get(header) ?? ""), Buffer.from(secret)];
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Invalid or overlapping credentials disable both surfaces, including in development. */
function credentials(): { operator?: string; members: Record<string, string> } | null {
  const operator = process.env.RECALL_OPERATOR_SECRET;
  try {
    const members: unknown = JSON.parse(process.env.RECALL_FAMILY_CREDENTIALS || "{}");
    if (!members || typeof members !== "object" || Array.isArray(members)) return null;
    const entries = Object.entries(members);
    if (entries.some(([id, secret]) => !id.trim() || typeof secret !== "string" || !secret.trim())) return null;
    const secrets = entries.map(([, secret]) => secret as string);
    if (new Set(secrets).size !== secrets.length || (operator && secrets.includes(operator))) return null;
    // The old shared key has no member identity. Refuse it rather than silently keeping that access path.
    if (process.env.RECALL_FAMILY_SECRET) return null;
    return { operator, members: members as Record<string, string> };
  } catch {
    return null;
  }
}

export function isOperator(request: Request): boolean {
  const config = credentials();
  if (!config) return false;
  const local = !config.operator && Object.keys(config.members).length === 0 && process.env.NODE_ENV !== "production";
  return local || holds(request, "x-recall-operator", config.operator);
}

/** A requested member must match the credential owner. Only an explicit operator credential can act for others. */
export function isFamily(request: Request, memberId?: string): boolean {
  const config = credentials();
  if (!config) return false;
  if (holds(request, "x-recall-operator", config.operator)) return true;
  return Object.entries(config.members).some(([id, secret]) =>
    (memberId === undefined || memberId === id) && holds(request, "x-recall-family", secret));
}
