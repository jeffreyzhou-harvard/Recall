import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { GET, POST } from "@/app/api/circle/[...path]/route";
import { getOnboarding } from "@/server/onboarding";
import { issueAccount } from "@/server/accounts";
import { sessionCookie } from "@/server/session";
import { readCircle, updateCircle } from "@/server/circle/store";
import { mediaFolder, reanalyze, uploadPhotos } from "@/server/circle/photos";
import { discardAudio, expireAudioDrafts } from "@/server/circle/audio";
import { passwordPrincipal, saveLogin } from "@/server/circle/access";
let root: string, household: string, owner: string, cookie: string;
const context = (action: string) => ({ params: Promise.resolve({ path: action.split("/") }) });
function request(action: string, body?: unknown, auth = cookie) {
  const form = body instanceof FormData;
  return new Request(`http://localhost:3000/api/circle/${action}`, { method: body === undefined ? "GET" : "POST", headers: { Origin: "http://localhost:3000", Cookie: auth, ...(body === undefined || form ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }) });
}
const post = (action: string, body: unknown, auth = cookie) => POST(request(action, body, auth), context(action));
async function photo(color = "#234567", metadata = false) {
  let image = sharp({ create: { width: 12, height: 16, channels: 3, background: color } }).jpeg();
  if (metadata) image = image.withExif({ IFD2: { DateTimeOriginal: "2025:08:16 14:00:00" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "38/1 56/1 6/1", GPSLongitudeRef: "W", GPSLongitude: "74/1 54/1 21/1" } });
  return new File([await image.toBuffer()], "test.jpg", { type: "image/jpeg" });
}
function aiReply(init: RequestInit) {
  const input = JSON.parse(String(init.body));
  const ids = input.input[0].content.filter((c: { type: string; text?: string }) => c.type === "input_text" && c.text?.startsWith('{"photoId"')).map((c: { text: string }) => JSON.parse(c.text).photoId);
  return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ groups: [{ photoIds: ids, coverPhotoId: ids[0], title: "Garden gathering", description: "A garden photograph.", place: "Garden", question: "What comes to mind?", peopleCount: 1, captions: ids.map((photoId: string) => ({ photoId, caption: "A garden photograph." })) }] }) }] }] });
}
beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), "recall-circle-audit-"));
  vi.stubEnv("RECALL_DATA_DIR", root); vi.stubEnv("RECALL_ONBOARDING_DB", path.join(root, "onboarding.db")); vi.stubEnv("RECALL_CIRCLE_DB", path.join(root, "circle.db"));
  vi.stubEnv("OPENAI_API_KEY", ""); vi.stubEnv("LINQ_API_KEY", ""); vi.stubEnv("RECALL_OPERATOR_SECRET", ""); vi.stubEnv("RECALL_FAMILY_CREDENTIALS", "{}"); vi.stubEnv("RECALL_FAMILY_SECRET", "");
  delete (globalThis as any).__recallOnboarding;
  const made = await getOnboarding().createHousehold({ participant: { display_name: "Susan Test", phone: "+15555550101" }, caregiver: { display_name: "Maya Test" } });
  household = made.household.household_id; owner = made.caregiver.person_id;
  issueAccount(household, owner, "family");
  cookie = sessionCookie({ role: "family", member_id: owner }, request("state", undefined, "")).split(';')[0]!;
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); delete (globalThis as any).__recallOnboarding; rmSync(root, { recursive: true, force: true }); });

describe("photo collection integration regressions", () => {
  it("preserves capture dates, GPS and original photo bytes", async () => {
    const file = await photo("#234567", true);
    await uploadPhotos(household, owner, "Maya", [file], "exif");
    const state = readCircle(household), stored = state.photos[0]!;
    expect(stored.capturedAt).toContain("2025-08-16");
    expect(stored.latitude).toBeCloseTo(38.935); expect(stored.longitude).toBeCloseTo(-74.9058333);
    expect(state.moments[0]!.latitude).toBeCloseTo(38.935);
    expect(readFileSync(path.join(mediaFolder(household), stored.id + ".original"))).toEqual(Buffer.from(await file.arrayBuffer()));
  });
  it("replays the complete import receipt, including rejected photos and AI warnings", async () => {
    const files = [await photo(), new File(["not a photo"], "broken.jpg")];
    const first = await uploadPhotos(household, owner, "Maya", files, "retry");
    expect(first.rejected).toHaveLength(1); expect(first.warning).toBeTruthy();
    expect(await uploadPhotos(household, owner, "Maya", files, "retry")).toEqual(first);
  });
  it("keeps every cover and caption attached to retained photos in overlapping uploads", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const pending: { resolve: (r: Response) => void; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise<Response>(resolve => pending.push({ resolve, init }))));
    const common = await photo(), a = await photo("red"), b = await photo("blue");
    const first = uploadPhotos(household, owner, "Maya", [common, a], "first");
    const second = uploadPhotos(household, owner, "Maya", [common, b], "second");
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[0]!.resolve(aiReply(pending[0]!.init));
    await vi.waitFor(() => expect(readCircle(household).photos).toHaveLength(2));
    pending[1]!.resolve(aiReply(pending[1]!.init));
    await Promise.all([first, second]);
    const state = readCircle(household);
    expect(state.photos).toHaveLength(3);
    for (const m of state.moments) expect(m.photoIds).toContain(m.coverId);
    expect(readdirSync(mediaFolder(household))).toHaveLength(6);
  });
  it("reanalyzes all photos after the twentieth and rejects stale analysis commits", async () => {
    const files = await Promise.all(Array.from({ length: 21 }, (_, i) => photo(`#${((i + 1) * 0x071321).toString(16).padStart(6, '0')}`)));
    const named = files.map((f, i) => new File([f], `photo-${i}.jpg`, { type: f.type }));
    const metadata = Object.fromEntries(named.map(f => [f.name, { date: "2025-08-16T14:00:00Z", latitude: 38.935, longitude: -74.906 }]));
    await uploadPhotos(household, owner, "Maya", named, "large", metadata);
    const moment = readCircle(household).moments[0]!;
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const mock = vi.fn(async (_url, init) => aiReply(init)); vi.stubGlobal("fetch", mock);
    await reanalyze(household, moment.id);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(readCircle(household).photos.every(p => p.caption === "A garden photograph.")).toBe(true);
    mock.mockImplementation(async (_url, init) => { updateCircle(household, s => { s.moments[0]!.revision++; s.moments[0]!.title = "Family edit"; }); return aiReply(init); });
    await expect(reanalyze(household, moment.id)).rejects.toThrow("changed");
    expect(readCircle(household).moments[0]!.title).toBe("Family edit");
  });
  it("rolls back a failed signup instead of reserving the participant's phone", async () => {
    const args = (phone: string) => ({ email: "same@example.test", password: "a synthetic password", participant: { display_name: "Susan", phone }, caregiver: { display_name: "Maya" } });
    const responses = await Promise.all([post("family-start", args("+15555550102"), ""), post("family-start", args("+15555550103"), "")]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    const failedPhone = responses[0]!.status === 409 ? "+15555550102" : "+15555550103";
    const retry = await post("family-start", { ...args(failedPhone), email: "fresh@example.test" }, "");
    expect(retry.status).toBe(201);
    const duplicate = await post("family-start", { ...args(failedPhone), email: "third@example.test" }, "");
    expect(duplicate.status).toBe(409);
  });
  it("does not accept a password with extra characters past the stored maximum", async () => {
    const password = 'x'.repeat(128); await saveLogin(owner, "maya@example.test", password);
    await expect(passwordPrincipal("maya@example.test", password + "extra")).rejects.toThrow("doesn’t match");
  });
  it("keeps draft recordings private, requires review, and removes only unshared audio", async () => {
    await uploadPhotos(household, owner, "Maya", [await photo()], "audio-moment");
    const moment = readCircle(household).moments[0]!;
    async function record() {
      const form = new FormData(); form.set("audio", new File([new Uint8Array(100)], "test.wav", { type: "audio/wav" }));
      const result = await post("audio", form); expect(result.status).toBe(200); return result.json();
    }
    const kept = await record(), abandoned = await record();
    const input = { momentId: moment.id, text: "Synthetic test story.", requestId: "voice-story", audioId: kept.id, confirmed: true };
    expect((await post("story", input)).status).toBe(400);
    expect((await post("story", { ...input, audioReviewed: true })).status).toBe(200);
    await discardAudio(household, owner, kept.id);
    expect((await GET(request(`media/${kept.id}`), context(`media/${kept.id}`))).status).toBe(200);
    await discardAudio(household, owner, abandoned.id);
    expect((await GET(request(`media/${abandoned.id}`), context(`media/${abandoned.id}`))).status).toBe(404);
    const expired = await record();
    updateCircle(household, s => { for (const d of s.drafts!) d.createdAt = "2020-01-01T00:00:00Z"; });
    await expireAudioDrafts(household);
    expect(readCircle(household).drafts!.map(d => d.id)).toEqual([kept.id]);
    expect(readdirSync(mediaFolder(household))).not.toContain(expired.id + ".audio");
    expect((await post("story", { ...input, requestId: "too-long", audioReviewed: true, text: "a".repeat(6001) })).status).toBe(400);
  });
});
