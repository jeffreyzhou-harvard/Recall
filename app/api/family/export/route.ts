import { bodyOf, guard, liveRecall, familyResponse } from "../shared";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  const denied = guard(request); if (denied) return denied;
  const body = await bodyOf(request);
  if (typeof body?.member !== "string") return Response.json({ error: "Choose a member." }, { status: 400 });
  const memberDenied = guard(request, body.member); if (memberDenied) return memberDenied;
  return familyResponse(async () => {
    const out = await (await liveRecall(request)).service.exportRecord(body.member as string);
    if (out.status === "refused" || !out.file) return Response.json({ error: "Record access is required to export." }, { status: 403 });
    // The member prints this record and saves it as a PDF, so the body is handed
    // back for rendering rather than as a file attachment.
    return new Response(out.file.text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  });
}
