import { patientCall } from "@/server/patient";
import { limitedBody } from "@/server/media";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const live = await patientCall(request);
    if (!live) return Response.json({ error: "not allowed" }, { status: 403 });
    const call = live.currentCall();
    if (!call) return Response.json({ error: "The call has ended." }, { status: 409 });
    const url = new URL(request.url), id = url.searchParams.get("step") ?? "", action = url.searchParams.get("action");
    if (action === "audio") await call.receive(id, await limitedBody(request), url.searchParams.get("stop") === "true");
    else if (action === "stop") call.stop();
    else if (action === "ack") call.acknowledge(id);
    else return Response.json({ error: "Unknown call action." }, { status: 400 });
    return Response.json({ accepted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "The call step could not be completed." }, { status: 409 }); }
}
