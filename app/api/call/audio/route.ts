import { patientCall } from "@/server/patient";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const live = await patientCall(request);
  if (!live) return new Response(null, { status: 403 });
  const audio = live.currentCall()?.audio(new URL(request.url).searchParams.get("step") ?? "");
  return audio ? new Response(new Uint8Array(audio), { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }) : new Response(null, { status: 404 });
}
