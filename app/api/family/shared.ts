/**
 * The family side's routes. LIVE ONLY.
 *
 * There is no sign-in yet, so `member` is whoever the caller says they are. Until there is, these routes
 * are open in development and need the operator secret in production, like the call routes. What a member
 * may see is still decided, every time, by the joint setup (rule 14): an id that is not an approved
 * member with a live grant gets nothing.
 */
import { mayCreateRoom } from "@/server/call-rooms";

export const guard = (request: Request): Response | null => (mayCreateRoom(request) ? null : Response.json({ error: "not allowed" }, { status: 403 }));

export async function bodyOf(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
