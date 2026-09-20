import { guard, bodyOf, familyResponse, liveRecall } from "../shared";
import { LibraryError, mutateFamilyLibrary, readFamilyLibrary } from "@/server/family-library";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
async function respond(work: () => Promise<unknown>) {
  return familyResponse(async () => {
    try { return Response.json(await work(), { headers }); }
    catch (error) { if (error instanceof LibraryError) return Response.json({ error: error.message }, { status: error.status, headers }); throw error; }
  });
}
export async function GET(request: Request) {
  const member = new URL(request.url).searchParams.get("member") ?? "", denied = guard(request, member);
  if (denied) return denied;
  return respond(async () => readFamilyLibrary(await liveRecall(), member));
}
export async function POST(request: Request) {
  const denied = guard(request); if (denied) return denied;
  const body = await bodyOf(request);
  if (!body || typeof body.member !== "string") return Response.json({ error: "Choose your contributor account." }, { status: 400, headers });
  const refused = guard(request, body.member); if (refused) return refused;
  return respond(async () => mutateFamilyLibrary(await liveRecall(), body));
}
