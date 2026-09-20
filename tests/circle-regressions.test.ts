import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { GET, POST } from "@/app/api/circle/[...path]/route";
import { getOnboarding } from "@/server/onboarding";
import { issueAccount } from "@/server/accounts";
import { sessionCookie } from "@/server/session";
import { readCircle, updateCircle, withCircleDb } from "@/server/circle/store";
import { mediaFolder, reanalyze, uploadPhotos } from "@/server/circle/photos";
import { discardAudio, expireAudioDrafts } from "@/server/circle/audio";
import { passwordPrincipal, saveLogin } from "@/server/circle/access";
import { loadSampleFamily } from "@/server/circle/sample";
import { emptyFaceIndex } from "@/lib/people/types";
import sampleKit from "@/fixtures/sample-family.json";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryGraph } from "@/components/archive/MemoryGraph";
import type { CircleView } from "@/components/circle/types";
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
function kitFiles() {
  return sampleKit.map(entry => new File([readFileSync(path.join(process.cwd(), "public/sample-family", entry.file))], entry.file, { type: "image/jpeg" }));
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
  it("starts fresh local sample families even after the old demo launch limit was exhausted", async () => {
    vi.stubEnv("NODE_ENV", "development");
    withCircleDb(db => db.prepare("INSERT INTO attempts VALUES (?, ?, ?)").run("demo", 10, Date.now()));
    const opened: string[] = [];
    for (let i = 0; i < 2; i++) {
      const response = await post("demo", {}, "");
      expect(response.status).toBe(200);
      const demoCookie = response.headers.get("set-cookie")!.split(";")[0]!;
      const stateResponse = await GET(request("state", undefined, demoCookie), context("state"));
      expect(stateResponse.status).toBe(200);
      const data = await stateResponse.json() as CircleView;
      expect(data.demo).toBe(true);
      expect(data.photos).toHaveLength(6);
      expect(data.moments.map(m => m.title).sort()).toEqual(["Home Garden Morning", "Quiet Library Rooms"]);
      expect(data.connections!.people).toHaveLength(4);
      opened.push(data.household);
    }
    expect(new Set(opened).size).toBe(2);
  });
  it("keeps sample family creation restricted to local development and same-origin requests", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await post("demo", {}, "")).status).toBe(404);
    vi.stubEnv("NODE_ENV", "development");
    const remote = new Request("https://example.test/api/circle/demo", { method: "POST", headers: { Origin: "https://example.test", Host: "example.test", "Content-Type": "application/json" }, body: "{}" });
    expect((await POST(remote, context("demo"))).status).toBe(404);
    const crossOrigin = request("demo", {}, ""); crossOrigin.headers.set("Origin", "https://elsewhere.test");
    expect((await POST(crossOrigin, context("demo"))).status).toBe(403);
  });
  it("provides sourced sample family ties in the Connections graph without creating accounts or photo identifications", async () => {
    const real = await GET(request("state"), context("state"));
    expect((await real.json()).connections).toBeUndefined();
    const members = await getOnboarding().people(household);
    updateCircle(household, state => { state.demo = true; });
    await loadSampleFamily(household, owner, "Maya");
    const response = await GET(request("state"), context("state"));
    expect(response.status).toBe(200);
    const data = await response.json() as CircleView;
    expect(data.connections!.source).toBe("Fictional sample family connections");
    expect(data.connections!.people.map(p => p.name).sort()).toEqual(["Anika", "Maya", "Priya", "Susan"]);
    expect(data.connections!.relationships).toEqual([
      { from: "Susan", to: "Maya", label: "Maya is Susan’s daughter.", relation: "daughter" },
      { from: "Susan", to: "Priya", label: "Priya is Susan’s sister.", relation: "sister" },
      { from: "Maya", to: "Anika", label: "Anika is Maya’s daughter.", relation: "daughter" },
      { from: "Susan", to: "Anika", label: "Anika is Susan’s granddaughter.", relation: "granddaughter" },
    ]);
    const garden = data.moments.find(m => m.title === "Home Garden Morning")!;
    const library = data.moments.find(m => m.title === "Quiet Library Rooms")!;
    expect(data.connections!.people.find(p => p.name === "Susan")!.momentIds).toEqual([garden.id, library.id]);
    expect(data.connections!.people.find(p => p.name === "Priya")!.momentIds).toEqual([garden.id]);
    expect(data.connections!.people.find(p => p.name === "Anika")!.momentIds).toEqual([library.id]);
    const markup = renderToStaticMarkup(createElement(MemoryGraph, { ...data, onSelect: () => {} }));
    for (const name of ["Susan", "Maya", "Priya", "Anika"]) expect(markup).toContain(`data-node="person:${name}"`);
    for (const tie of data.connections!.relationships) expect(markup).toContain(tie.label);
    expect(data.photos).toHaveLength(6); expect(data.moments).toHaveLength(2);
    expect(data.moments.every(m => m.peopleCount === 0 && m.people.length === 0)).toBe(true);
    expect(await getOnboarding().people(household)).toEqual(members);
    expect(await getOnboarding().currentSetup(household)).toBeNull();
    expect((await post("delete", { kind: "moment", id: garden.id, momentId: garden.id, revision: garden.revision, storyCount: 0 })).status).toBe(200);
    const updated = await (await GET(request("state"), context("state"))).json() as CircleView;
    expect(updated.connections!.people.flatMap(p => p.momentIds)).not.toContain(garden.id);
    expect(updated.connections!.relationships).toEqual(data.connections!.relationships);
  });
  it("starts with just the garden and library and retains both byte-for-byte when resetting the upload demo", async () => {
    await expect(loadSampleFamily(household, owner, "Maya")).rejects.toThrow("sample family");
    updateCircle(household, state => { state.demo = true; });
    const loaded = await loadSampleFamily(household, owner, "Maya");
    expect(loaded.added).toBe(6); expect(loaded.moments).toBe(2);
    const before = readCircle(household), keep = before.moments.filter(m => ["Home Garden Morning", "Quiet Library Rooms"].includes(m.title));
    expect(before.moments.every(m => m.photoIds.length === 3 && m.photoIds.includes(m.coverId))).toBe(true);
    expect(keep).toHaveLength(2);
    expect(before.photos.filter(p => /^(beach|birthday|holiday|acadia)-/.test(p.name))).toHaveLength(0);
    const photos = before.photos.filter(p => keep.some(m => m.photoIds.includes(p.id)));
    const bytes = photos.map(p => readFileSync(path.join(mediaFolder(household), p.id + ".jpg")));
    expect(await loadSampleFamily(household, owner, "Maya")).toEqual(loaded);
    expect(await uploadPhotos(household, owner, "Maya", kitFiles(), "kit-upload")).toMatchObject({ added: 12, moments: 4, rejected: [], warning: null });
    expect(readCircle(household).photos).toHaveLength(18);
    updateCircle(household, s => { s.stories.push({ id: "retained", eventId: keep[0]!.id, text: "A sample garden story.", author: "Maya", owner, requestId: "retained", source: "written", createdAt: new Date().toISOString() }); });
    await loadSampleFamily(household, owner, "Maya", true);
    const after = readCircle(household);
    expect(after.photos).toHaveLength(6); expect(after.moments).toHaveLength(2);
    expect(keep.map(m => after.moments.find(n => n.id === m.id))).toEqual(keep);
    expect(photos.map(p => after.photos.find(n => n.id === p.id))).toEqual(photos);
    expect(photos.map(p => readFileSync(path.join(mediaFolder(household), p.id + ".jpg")))).toEqual(bytes);
    expect(after.stories.map(s => s.id)).toContain("retained");
    expect(readdirSync(mediaFolder(household))).toHaveLength(12);
  });
  it("recreates the four named kit groups through the upload API across batches, with no duplicate photos or AI calls", async () => {
    updateCircle(household, state => { state.demo = true; });
    await loadSampleFamily(household, owner, "Maya");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const files = kitFiles().reverse().map((file, i) => new File([file], `renamed-${i}.jpg`, { type: file.type }));
    for (const parity of [0, 1]) {
      const form = new FormData(); form.set("requestId", `kit-${parity}`);
      files.filter((_, i) => i % 2 === parity).forEach(file => form.append("photos", file));
      const response = await post("photos", form);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ added: 6, rejected: [], warning: null });
    }
    const state = readCircle(household);
    expect(state.photos).toHaveLength(18); expect(state.moments).toHaveLength(6);
    for (const title of ["Our Cape May summer", "A birthday around the table", "The kitchen before Diwali", "A long weekend in Acadia"]) {
      const matches = state.moments.filter(m => m.title === title);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.photoIds).toHaveLength(3);
      expect(matches[0]!.photoIds).toContain(matches[0]!.coverId);
      expect(matches[0]!.evidence).toContain("Sample photo kit");
    }
    const form = new FormData(); form.set("requestId", "kit-duplicates");
    files.forEach(file => form.append("photos", file));
    const repeated = await post("photos", form);
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({ added: 0, duplicates: 12 });
    expect(readCircle(household).moments).toEqual(state.moments);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses ordinary organization for non-sample households and unrelated files with kit filenames", async () => {
    await uploadPhotos(household, owner, "Maya", [kitFiles()[0]!], "real-family");
    let state = readCircle(household);
    expect(state.photos[0]!.demo).toBeUndefined();
    expect(state.moments[0]!.title).not.toBe("Our Cape May summer");
    expect(state.moments[0]!.evidence).not.toContain("Sample photo kit");
    updateCircle(household, s => { s.demo = true; });
    const renamed = new File([await photo()], "beach-01.jpg", { type: "image/jpeg" });
    await uploadPhotos(household, owner, "Maya", [renamed], "unrelated-file");
    state = readCircle(household);
    expect(state.moments.every(m => !m.evidence.includes("Sample photo kit"))).toBe(true);
    expect(state.photos.every(p => !p.demo)).toBe(true);
  });
  it("deletes a cover photo, repairs the group, and removes its face references and original bytes", async () => {
    const a = await photo("red"), b = new File([await photo("blue")], "second.jpg", { type: "image/jpeg" });
    const metadata = Object.fromEntries([a, b].map(f => [f.name, { date: "2025-08-16T14:00:00Z", latitude: 38.935, longitude: -74.906 }]));
    await uploadPhotos(household, owner, "Maya", [a, b], "deletion", metadata);
    const moment = readCircle(household).moments[0]!, id = moment.coverId, groupId = randomUUID();
    updateCircle(household, state => { state.faceIndex = { ...emptyFaceIndex(), scannedPhotoIds: [id], groups: [{ id: groupId, name: "Sample person" }], faces: [{ id: randomUUID(), groupId, photoId: id, descriptor: Array(128).fill(0.1), score: .9, box: { x: .1, y: .1, width: .5, height: .5 } }] }; });
    const response = await post("delete", { kind: "photo", id, momentId: moment.id, revision: moment.revision, storyCount: 0 });
    expect(response.status).toBe(200);
    const state = readCircle(household);
    expect(state.photos).toHaveLength(1); expect(state.moments).toHaveLength(1);
    expect(state.moments[0]!.coverId).toBe(state.photos[0]!.id);
    expect(state.moments[0]!.revision).toBe(moment.revision + 1);
    expect(state.faceIndex).toMatchObject({ faces: [], groups: [], scannedPhotoIds: [] });
    expect(state.faceIndex!.generation).not.toBe("initial");
    expect(readdirSync(mediaFolder(household))).toHaveLength(2);
    expect((await GET(request(`media/${id}`), context(`media/${id}`))).status).toBe(404);
  });
  it("requires caregiver access, same-origin requests and current group/story confirmation before deletion", async () => {
    await uploadPhotos(household, owner, "Maya", [await photo()], "delete-permissions");
    const moment = readCircle(household).moments[0]!;
    const edit = { kind: "moment", id: moment.id, momentId: moment.id, revision: moment.revision, storyCount: 0 };
    const patient = (await getOnboarding().people(household)).find(p => p.role === "participant")!;
    issueAccount(household, patient.person_id, "patient");
    const patientCookie = sessionCookie({ role: "patient", member_id: patient.person_id }, request("state")).split(';')[0]!;
    expect((await post("delete", edit, patientCookie)).status).toBe(403);
    expect((await post("delete", edit, "")).status).toBe(401);
    const crossOrigin = request("delete", edit); crossOrigin.headers.set("Origin", "https://elsewhere.test");
    expect((await POST(crossOrigin, context("delete"))).status).toBe(403);
    expect((await post("delete", { ...edit, id: "unrelated-group" })).status).toBe(404);
    expect((await post("delete", { ...edit, revision: moment.revision + 1 })).status).toBe(409);
    expect((await post("story", { momentId: moment.id, text: "A new family story.", requestId: "concurrent", confirmed: true })).status).toBe(200);
    expect((await post("delete", edit)).status).toBe(409);
    expect((await post("delete", { ...edit, revision: moment.revision + 1 })).status).toBe(409);
    expect(readCircle(household).photos).toHaveLength(1);
  });
  it("deleting the last photo removes its empty group and explicitly confirmed stories and audio", async () => {
    await uploadPhotos(household, owner, "Maya", [await photo()], "delete-last");
    const moment = readCircle(household).moments[0]!, audioId = randomUUID();
    writeFileSync(path.join(mediaFolder(household), audioId + ".audio"), Buffer.from("test audio"));
    updateCircle(household, state => {
      state.drafts = [{ id: audioId, owner, mime: "audio/wav", text: "Sample words.", createdAt: new Date().toISOString() }];
      state.stories.push({ id: randomUUID(), eventId: moment.id, owner, author: "Maya", requestId: "delete-last-story", text: "Sample words.", createdAt: new Date().toISOString(), source: "voice", audioUrl: `/api/circle/media/${audioId}` });
    });
    const response = await post("delete", { kind: "photo", id: moment.coverId, momentId: moment.id, revision: moment.revision, storyCount: 1 });
    expect(response.status).toBe(200);
    expect(readCircle(household)).toMatchObject({ photos: [], moments: [], stories: [], drafts: [] });
    expect(readdirSync(mediaFolder(household))).toEqual([]);
    expect((await GET(request(`media/${audioId}`), context(`media/${audioId}`))).status).toBe(404);
  });
  it("deletes a photo group while preserving photographs also kept in another group", async () => {
    const a = await photo("red"), b = new File([await photo("blue")], "shared.jpg", { type: "image/jpeg" });
    const metadata = Object.fromEntries([a, b].map(f => [f.name, { date: "2025-08-16T14:00:00Z", latitude: 38.935, longitude: -74.906 }]));
    await uploadPhotos(household, owner, "Maya", [a, b], "shared", metadata);
    const original = readCircle(household).moments[0]!, sharedId = original.photoIds[1]!;
    const other = { ...original, id: `moment:${randomUUID()}`, title: "Another group", photoIds: [sharedId], coverId: sharedId };
    updateCircle(household, state => { state.moments.push(other); });
    const response = await post("delete", { kind: "moment", id: original.id, momentId: original.id, revision: original.revision, storyCount: 0 });
    expect(response.status).toBe(200);
    const state = readCircle(household);
    expect(state.moments).toEqual([other]); expect(state.photos.map(p => p.id)).toEqual([sharedId]);
    expect(readdirSync(mediaFolder(household)).sort()).toEqual([sharedId + ".jpg", sharedId + ".original"].sort());
  });
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
