/** Short-lived signed browser sessions. Credentials remain on the server and are rechecked on every request. */
import { createHmac, timingSafeEqual } from "node:crypto";
import { accountForKey, accountForMember } from "./accounts";
export type Principal = { role: "operator"; member_id: null } | { role: "family" | "patient"; member_id: string };
export const SESSION_COOKIE = "recall_session";
const lifetime = 8 * 60 * 60;
export function credentials(): { operator?: string; members: Record<string, string> } | null {
  try {
    const members: unknown = JSON.parse(process.env.RECALL_FAMILY_CREDENTIALS || "{}");
    if (!members || typeof members !== "object" || Array.isArray(members) || process.env.RECALL_FAMILY_SECRET) return null;
    const entries = Object.entries(members);
    if (entries.some(([id, key]) => !id.trim() || typeof key !== "string" || !key.trim())) return null;
    const keys = entries.map(([, key]) => key as string);
    const operator = process.env.RECALL_OPERATOR_SECRET;
    if (new Set(keys).size !== keys.length || (operator && keys.includes(operator))) return null;
    return { operator, members: members as Record<string, string> };
  } catch { return null; }
}
export function equal(a: string, b: string | undefined): boolean {
  if (!b) return false;
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function sameOrigin(request: Request): boolean { return request.headers.get("origin") === new URL(request.url).origin; }
export function principalForKey(key: string): Principal | null {
  const c = credentials();
  if (!c || !key) return null;
  if (equal(key, c.operator)) return { role: "operator", member_id: null };
  for (const [id, secret] of Object.entries(c.members)) if (equal(key, secret)) return { role: "family", member_id: id };
  const account = accountForKey(key);
  return account ? { role: account.role, member_id: account.member_id } : null;
}
function signingKey(principal: Principal, request: Request): string | undefined {
  const c = credentials();
  if (!c) return;
  return principal.role === "operator" ? c.operator : principal.role === "family" && Object.hasOwn(c.members, principal.member_id) ? c.members[principal.member_id] : (() => { const a = accountForMember(principal.member_id); return a?.role === principal.role ? a.verifier : undefined; })();
}
export function sessionCookie(principal: Principal, request: Request): string {
  const key = signingKey(principal, request);
  if (!key) throw new Error("No credential for this session");
  const payload = Buffer.from(JSON.stringify({ ...principal, exp: Math.floor(Date.now() / 1000) + lifetime })).toString("base64url");
  const signature = createHmac("sha256", key).update(payload).digest("base64url");
  return `${SESSION_COOKIE}=${payload}.${signature}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${lifetime}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
export function browserPrincipal(request: Request): Principal | null {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !sameOrigin(request)) return null;
  const value = request.headers.get("cookie")?.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  if (!value || value.length > 2048) return null;
  try {
    const [payload, signature, extra] = value.split(".");
    if (!payload || !signature || extra) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if ((data.role !== "operator" && data.role !== "family" && data.role !== "patient") || (data.role !== "operator" && typeof data.member_id !== "string") || (data.role === "operator" && data.member_id !== null) || !Number.isFinite(data.exp) || data.exp <= Date.now() / 1000 || data.exp > Date.now() / 1000 + lifetime) return null;
    const principal = { role: data.role, member_id: data.member_id } as Principal;
    const key = signingKey(principal, request);
    return key && equal(signature, createHmac("sha256", key).update(payload).digest("base64url")) ? principal : null;
  } catch { return null; }
}
