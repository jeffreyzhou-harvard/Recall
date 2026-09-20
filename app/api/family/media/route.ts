import { guard, liveRecall, familyResponse } from "../shared";
import { cleanPhoto, limitedBody, parseWav } from "@/server/media";
import { transcribe } from "@/server/transcribe";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const member = new URL(request.url).searchParams.get("member") ?? "", denied = guard(request, member); if (denied) return denied;
  return familyResponse(async () => {
    const live = await liveRecall();
    if (!live.setup.current().approved_people.includes(member) || !live.media) return Response.json({ error: "Your contributions are not approved." }, { status: 403 });
    let input: Buffer;
    try { input = await limitedBody(request); } catch { return Response.json({ error: "Choose a file under 6 MB." }, { status: 413 }); }
    try {
      const isVoice = request.headers.get("content-type") === "audio/wav";
      const file = isVoice ? { ...parseWav(input), mime: "audio/wav" } : { ...cleanPhoto(input), duration: null };
      const literal = isVoice ? (await transcribe(file.bytes)).words.map((w) => w.w).join(" ") : null;
      if (isVoice && !literal) return Response.json({ error: "No spoken words were transcribed. You can record again or type your memory." }, { status: 422 });
      const media = live.media.make(file.bytes, member, file.mime, file.duration); await live.media.save(media);
      return Response.json({ asset_id: media.entry.id, medium: isVoice ? "voice_note" : "photo", transcript: literal }, { headers: { "Cache-Control": "no-store" } });
    } catch { return Response.json({ error: "The upload could not be read. Use JPEG, PNG, or a mono PCM WAV recording; voice notes also need the configured transcription provider." }, { status: 422 }); }
  });
}
export async function GET(request: Request) {
  const url = new URL(request.url), member = url.searchParams.get("member") ?? "", denied = guard(request, member); if (denied) return denied;
  return familyResponse(async () => {
    const live = await liveRecall();
    if (!live.setup.current().approved_people.includes(member)) return new Response(null, { status: 403 });
    const media = live.media?.get(url.searchParams.get("asset") ?? "");
    if (!media || media.owner !== member) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(media.bytes), { headers: { "Content-Type": media.mime, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" } });
  });
}
