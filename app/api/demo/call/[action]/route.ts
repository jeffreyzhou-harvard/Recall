import { GET as status } from "@/app/api/call/status/route";
import { GET as audio } from "@/app/api/call/audio/route";
import { GET as photo } from "@/app/api/call/photo/route";
import { POST as action } from "@/app/api/call/action/route";
import { requireLocalSample, samplePatient } from "@/server/sample-access";
import { sampleCallError, sampleCallRunning, startSampleCall } from "@/server/sample-call";
import { CircleError } from "@/server/circle/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
type Context = { params: Promise<{ action: string }> };
async function handle(request: Request, context: Context) {
  try {
    requireLocalSample(request);
    const account = samplePatient(request);
    if (!account) return Response.json({ error: "Open the patient demo from Recall’s home page." }, { status: 403 });
    const name = (await context.params).action;
    if (request.method === "POST") {
      if (name === "start") { await startSampleCall(account.household_id); return Response.json({ started: true }); }
      if (name === "action") return action(request);
    } else {
      if (name === "audio") return audio(request);
      if (name === "photo") return photo(request);
      if (name === "status") {
        const response = await status(request);
        if (!response.ok) return response;
        const body = await response.json();
        const preparing = body.status === "waiting" && sampleCallRunning(account.household_id);
        return Response.json({ ...body, preparing, message: body.status === "waiting" ? sampleCallError(account.household_id) ?? (preparing ? "Preparing your sample call…" : "Ready when you are.") : body.message, photos: body.photos?.map((p: { id: string; url: string }) => ({ ...p, url: p.url.replace("/api/call/", "/api/demo/call/") })) }, { headers: { "Cache-Control": "no-store" } });
      }
    }
    return Response.json({ error: "This demo action is unavailable." }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof CircleError ? error.message : "The sample call could not be opened." }, { status: error instanceof CircleError ? error.status : 503 });
  }
}
export const GET = handle;
export const POST = handle;
