import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { GET, POST } from "@/app/api/circle/[...path]/route";
import { getOnboarding } from "@/server/onboarding";
import { issueAccount, revokeAccount } from "@/server/accounts";
import { sessionCookie } from "@/server/session";
import { readCircle } from "@/server/circle/store";
import { uploadPhotos } from "@/server/circle/photos";
import { editPeople, getPeople, saveFaceScan } from "@/server/circle/people";
import { FACE_MODEL, type FaceDetection } from "@/lib/people/types";

let root: string, household: string, owner: string, cookie: string, patientCookie: string, photoIds: string[];
const context = (action: string) => ({ params: Promise.resolve({ path: action.split("/") }) });
function request(action: string, body?: unknown, auth = cookie) {
  return new Request(`http://localhost:3000/api/circle/${action}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Origin: "http://localhost:3000", Cookie: auth, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const post = (action: string, body: unknown, auth = cookie) => POST(request(action, body, auth), context(action));
const get = (action: string, auth = cookie) => GET(request(action, undefined, auth), context(action));
const face = (coordinate: number): FaceDetection => ({
  box: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, score: 0.95,
  descriptor: Array.from({ length: 128 }, (_, i) => i === 0 ? coordinate : 0),
});
const batch = (faces: FaceDetection[][], generation = "initial") => ({
  model: FACE_MODEL, generation, photos: faces.map((faces, i) => ({ photoId: photoIds[i]!, faces })),
});

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), "recall-people-"));
  vi.stubEnv("RECALL_DATA_DIR", root);
  vi.stubEnv("RECALL_ONBOARDING_DB", path.join(root, "onboarding.db"));
  vi.stubEnv("RECALL_CIRCLE_DB", path.join(root, "circle.db"));
  for (const key of ["OPENAI_API_KEY", "LINQ_API_KEY", "RECALL_OPERATOR_SECRET", "RECALL_FAMILY_SECRET"]) vi.stubEnv(key, "");
  vi.stubEnv("RECALL_FAMILY_CREDENTIALS", "{}");
  delete (globalThis as any).__recallOnboarding;
  const made = await getOnboarding().createHousehold({ participant: { display_name: "Susan Test", phone: "+15555550101" }, caregiver: { display_name: "Maya Test" } });
  household = made.household.household_id; owner = made.caregiver.person_id;
  issueAccount(household, owner, "family");
  issueAccount(household, made.participant.person_id, "patient");
  cookie = sessionCookie({ role: "family", member_id: owner }, request("state", undefined, "")).split(";")[0]!;
  patientCookie = sessionCookie({ role: "patient", member_id: made.participant.person_id }, request("state")).split(";")[0]!;
  const files = await Promise.all(["red", "blue", "green", "yellow"].map(async color => new File([
    await sharp({ create: { width: 80, height: 60, channels: 3, background: color } }).jpeg().toBuffer(),
  ], color + ".jpg", { type: "image/jpeg" })));
  await uploadPhotos(household, owner, "Maya Test", files, "people-fixtures");
  photoIds = readCircle(household).photos.map(p => p.id);
});
afterEach(() => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
  delete (globalThis as any).__recallOnboarding;
  rmSync(root, { recursive: true, force: true });
});

describe("private People photo grouping", () => {
  it("adds similar faces across photos without changing photos, stories or graph identities", async () => {
    const before = readCircle(household);
    const remote = vi.fn(); vi.stubGlobal("fetch", remote);
    const response = await post("face-scan", batch([[face(1)], [face(1.1)], [face(2)], []]));
    expect(response.status).toBe(200);
    const view = await response.json();
    expect(view.groups.map((g: any) => g.photoIds.length)).toEqual([2, 1]);
    expect(view.scannedPhotoIds).toEqual(photoIds);
    expect(JSON.stringify(view)).not.toMatch(/descriptor|score/);
    expect(view.groups.every((g: any) => g.name === "")).toBe(true);
    const { faceIndex, ...after } = readCircle(household);
    expect(after).toEqual(before);
    expect(faceIndex!.faces).toHaveLength(3);
    expect(remote).not.toHaveBeenCalled();
    expect(JSON.stringify(await (await get("state")).json())).not.toContain("descriptor");
  });

  it("retries a saved scan idempotently, including photos without faces", () => {
    const input = batch([[face(1)], []]);
    const first = saveFaceScan(household, input);
    expect(saveFaceScan(household, input)).toEqual(first);
    expect(first.scannedPhotoIds).toHaveLength(2);
  });

  it("never automatically joins two faces in the same photograph", () => {
    const view = saveFaceScan(household, batch([[face(1), face(1.01)]]));
    expect(view.groups).toHaveLength(2);
  });

  it("leaves an ambiguous match separate and prevents transitive chains", () => {
    const ambiguous = saveFaceScan(household, batch([[face(1)], [face(1.8)], [face(1.4)]]));
    expect(ambiguous.groups).toHaveLength(3);
    const reset = editPeople(household, owner, true, { action: "clear", revision: ambiguous.revision });
    const chain = saveFaceScan(household, batch([[face(1)], [face(1.4)], [face(1.8)]], reset.generation));
    expect(chain.groups.map(g => g.photoIds.length)).toEqual([2, 1]);
  });

  it("records family naming provenance, combines groups and preserves a supplied name", () => {
    let view = saveFaceScan(household, batch([[face(1)], [face(2)]]));
    const source = view.groups[0]!, target = view.groups[1]!;
    view = editPeople(household, owner, true, { action: "name", id: source.id, name: "  Aunt Jo  ", revision: view.revision });
    expect(view.groups.find(g => g.id === source.id)).toMatchObject({ name: "Aunt Jo", labeledBy: owner });
    view = editPeople(household, owner, true, { action: "merge", id: source.id, targetId: target.id, revision: view.revision });
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0]).toMatchObject({ id: target.id, name: "Aunt Jo", labeledBy: owner });
    expect(view.groups[0]!.photoIds).toHaveLength(2);
  });

  it("separates incorrect matches and dismisses detections without deleting photos", () => {
    let view = saveFaceScan(household, batch([[face(1)], [face(1.1)]]));
    const faceId = view.groups[0]!.faces[0]!.id;
    view = editPeople(household, owner, true, { action: "separate", faceId, revision: view.revision });
    expect(view.groups).toHaveLength(2);
    view = editPeople(household, owner, true, { action: "dismiss", faceId, revision: view.revision });
    expect(view.groups).toHaveLength(1);
    expect(readCircle(household).photos).toHaveLength(4);
    expect(view.scannedPhotoIds).toHaveLength(2);
  });

  it("rejects stale edits and prevents an in-flight scan restoring cleared groups", () => {
    const input = batch([[face(1)]]), view = saveFaceScan(household, input);
    expect(() => editPeople(household, owner, true, { action: "clear", revision: 0 })).toThrow("changed");
    expect(() => editPeople(household, owner, false, { action: "clear", revision: view.revision })).toThrow("organizer");
    const reset = editPeople(household, owner, true, { action: "clear", revision: view.revision });
    expect(reset.groups).toEqual([]); expect(reset.scannedPhotoIds).toEqual([]);
    expect(() => saveFaceScan(household, input)).toThrow("reset");
    expect(getPeople(household)).toEqual(reset);
    expect(saveFaceScan(household, { ...input, generation: reset.generation }).groups).toHaveLength(1);
  });

  it("rejects invalid boxes, descriptors and model versions without saving a partial scan", async () => {
    const invalid = [
      { ...face(1), box: { x: 0.9, y: 0, width: 0.3, height: 0.4 } },
      { ...face(1), descriptor: [1, 2] },
      face(0), { ...face(1), score: 0.1 },
    ];
    for (const detection of invalid) expect((await post("face-scan", batch([[face(1)], [detection]]))).status).toBe(400);
    expect((await post("face-scan", { ...batch([[face(1)]]), model: "unrecognized" })).status).toBe(400);
    expect(getPeople(household).scannedPhotoIds).toEqual([]);
  });

  it("rejects duplicate and foreign photo IDs atomically", async () => {
    const input = batch([[face(1)], [face(1.1)]]);
    input.photos[1]!.photoId = input.photos[0]!.photoId;
    expect((await post("face-scan", input)).status).toBe(404);
    input.photos[1]!.photoId = randomUUID();
    expect((await post("face-scan", input)).status).toBe(404);
    expect(getPeople(household).groups).toEqual([]);
  });

  it("requires family access, rejects cross-origin writes and honors revoked accounts", async () => {
    const input = batch([[face(1)]]);
    expect((await get("people", "")).status).toBe(401);
    expect((await post("face-scan", input, "")).status).toBe(401);
    expect((await get("people", patientCookie)).status).toBe(403);
    expect((await post("face-scan", input, patientCookie)).status).toBe(403);
    const crossOrigin = request("face-scan", input); crossOrigin.headers.set("Origin", "https://elsewhere.test");
    expect((await POST(crossOrigin, context("face-scan"))).status).toBe(403);
    revokeAccount(owner);
    expect((await get("people")).status).toBe(401);
  });

  it("serves private face crops only to their own household, including edge-of-image faces", async () => {
    const detection = { ...face(1), box: { x: 0.9, y: 0.9, width: 0.1, height: 0.1 } };
    const view = saveFaceScan(household, batch([[detection]]));
    const action = `face/${view.groups[0]!.faces[0]!.id}`;
    const response = await get(action);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await sharp(Buffer.from(await response.arrayBuffer())).metadata()).toMatchObject({ width: 240, height: 240, format: "jpeg" });
    expect((await get(action, "")).status).toBe(401);
    expect((await get(action, patientCookie)).status).toBe(403);
    const second = await getOnboarding().createHousehold({ participant: { display_name: "Another", phone: "+15555550102" }, caregiver: { display_name: "Other family" } });
    issueAccount(second.household.household_id, second.caregiver.person_id, "family");
    const otherCookie = sessionCookie({ role: "family", member_id: second.caregiver.person_id }, request("state")).split(";")[0]!;
    expect((await get(action, otherCookie)).status).toBe(404);
    expect((await (await get("people", otherCookie)).json()).groups).toEqual([]);
    expect((await post("people", { action: "name", id: view.groups[0]!.id, name: "Other", revision: 0 }, otherCookie)).status).toBe(404);
    expect((await get("face/not-a-valid-id")).status).toBe(404);
  });
});
