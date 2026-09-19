/** Relay's call page listens here. When a granted session places a call, the page joins it as Relay's end. Operators only. */
import { mayCreateRoom } from "@/server/call-rooms";
import { onCallPlaced, type Announcement } from "@/server/live-calls";
import { eventStream } from "../../call/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  // EventSource cannot set headers, so the operator secret may also arrive as ?operator=.
  const secret = new URL(request.url).searchParams.get("operator");
  const asOperator = secret ? new Request(request.url, { headers: { "x-relay-operator": secret } }) : request;
  if (!mayCreateRoom(asOperator)) return Response.json({ error: "not allowed" }, { status: 403 });
  return eventStream<Announcement>(request, (push) => onCallPlaced(push));
}
