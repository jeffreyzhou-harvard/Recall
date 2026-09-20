import { patientCall } from "@/server/patient";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const live = await patientCall(request);
    if (!live) return new Response(null, { status: 403, headers });
    const params = new URL(request.url).searchParams;
    const photo = await live.currentCall()?.photo(params.get("call") ?? "", params.get("photo") ?? "");
    return photo ? new Response(new Uint8Array(photo.bytes), { headers: { ...headers, "Content-Type": photo.mime } }) : new Response(null, { status: 404, headers });
  } catch { return new Response(null, { status: 404, headers }); }
}
