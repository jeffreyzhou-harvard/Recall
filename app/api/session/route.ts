import { activeHousehold } from "@/server/active-household";
import { browserPrincipal, localSetupAvailable, principalForKey, sameOrigin, sessionCookie, SESSION_COOKIE } from "@/server/session";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  return Response.json({ principal: browserPrincipal(request), local_setup_available: localSetupAvailable(request), household_id: browserPrincipal(request)?.role === "operator" ? activeHousehold() || null : null }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ error: "Open this form from Recall." }, { status: 403 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "Enter your access key." }, { status: 400 }); }
  const p = body?.local === true && localSetupAvailable(request) ? { role: "operator" as const, member_id: null } : typeof body?.key === "string" && body.key.length <= 512 ? principalForKey(body.key) : null;
  if (!p) return Response.json({ error: "This access key was not accepted." }, { status: 403 });
  return Response.json({ principal: p }, { headers: { "Set-Cookie": sessionCookie(p, request), "Cache-Control": "no-store" } });
}
export async function DELETE(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ error: "not allowed" }, { status: 403 });
  return Response.json({ signed_out: true }, { headers: { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`, "Cache-Control": "no-store" } });
}
