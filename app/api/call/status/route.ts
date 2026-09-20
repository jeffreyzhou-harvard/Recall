import { patientCall } from "@/server/patient";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const live = await patientCall(request);
    if (!live) return Response.json({ status: "unavailable", message: "Sign in to receive your Recall call.", command: null }, { headers: { "Cache-Control": "no-store" } });
    const call = live.currentCall();
    const photos = await call?.photos() ?? [];
    return Response.json({ status: call ? "active" : "waiting", message: call ? "Recall is here." : "There is no call to answer right now.", command: call?.command ?? null, topic: call?.topicLabel ?? null, photos, caption: call?.captions.snapshot ?? null, display_name: live.setup.current().attestations.saved_contact_name }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Recall is unavailable right now." }, { status: 503 }); }
}
