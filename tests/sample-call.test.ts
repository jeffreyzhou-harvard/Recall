import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { POST as circlePost, GET as circleGet } from "@/app/api/circle/[...path]/route";
import { GET as demoGet, POST as demoPost } from "@/app/api/demo/call/[action]/route";
import { GET as demoSession } from "@/app/api/demo/session/route";
import { browserPrincipal } from "@/server/session";
import { samplePatient } from "@/server/sample-access";
import { getSampleRecall, sampleCallRunning, syncSampleSharedMemories } from "@/server/sample-call";
import { getOnboarding } from "@/server/onboarding";
import { activeHousehold } from "@/server/active-household";
import { SqliteGraphStore } from "@/server/graph-store";
import { readCircle, updateCircle } from "@/server/circle/store";
import { transcribe } from "@/server/transcribe";
import { recallVoice } from "@/server/recall-voice";
import { wavFromPcm } from "@/server/media";
import type { CircleView } from "@/components/circle/types";
import { GET as familyDashboard } from "@/app/api/family/dashboard/route";
import { POST as familyExport } from "@/app/api/family/export/route";
import { POST as familyPause } from "@/app/api/family/pause/route";
vi.mock("@/server/transcribe", () => ({ transcribe: vi.fn() }));
vi.mock("@/server/recall-voice", () => ({ recallVoice: vi.fn() }));

let root: string;
const audio = wavFromPcm(new Uint8Array(16000 * 2 * 3));
const request = (route: string, cookie = "", body?: unknown) => new Request(`http://localhost:3001${route}`, { method: body === undefined ? "GET" : "POST", headers: { Origin: "http://localhost:3001", Cookie: cookie, "Content-Type": body instanceof Uint8Array ? "audio/wav" : "application/json" }, ...(body === undefined ? {} : { body: body instanceof Uint8Array ? new Uint8Array(body) : JSON.stringify(body) }) });
const post = (name: string, cookie = "") => circlePost(request(`/api/circle/${name}`, cookie, {}), { params: Promise.resolve({ path: [name] }) });
const cookies = (response: Response) => response.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
const state = async (cookie: string) => (await (await circleGet(request("/api/circle/state", cookie), { params: Promise.resolve({ path: ["state"] }) })).json()) as CircleView;
const call = (name: string, cookie: string, body?: unknown, query = "") => (body === undefined ? demoGet : demoPost)(request(`/api/demo/call/${name}${query}`, cookie, body), { params: Promise.resolve({ action: name }) });
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "recall-sample-call-"));
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("RECALL_DATA_DIR", root);
  vi.stubEnv("RECALL_ONBOARDING_DB", path.join(root, "onboarding.db")); vi.stubEnv("RECALL_CIRCLE_DB", path.join(root, "circle.db"));
  vi.stubEnv("RECALL_GRAPH_READS", "sqlite"); vi.stubEnv("RECALL_HOUSEHOLD", ""); vi.stubEnv("RECALL_POLICY_FILE", "");
  vi.stubEnv("RECALL_FAMILY_CREDENTIALS", "{}"); vi.stubEnv("DEEPGRAM_API_KEY", "test-key");
  for (const name of ["MUSE_API_KEY", "OPENAI_API_KEY", "LINQ_API_KEY", "RECALL_FAMILY_SECRET", "RECALL_OPERATOR_SECRET"]) vi.stubEnv(name, "");
  delete (globalThis as any).__recallOnboarding;
  vi.mocked(recallVoice).mockResolvedValue(audio);
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-20T15:00:00.000Z"));
});
afterEach(async () => {
  const cache = globalThis as any;
  for (const [key, pending] of cache.__sampleCalls ?? []) {
    if (!key.startsWith(root)) continue;
    const live = await pending; live.currentCall()?.stop();
    await cache.__sampleRunning?.get(key);
    (live.graph as SqliteGraphStore).close(); cache.__sampleCalls.delete(key);
  }
  delete cache.__recallOnboarding;
  vi.unstubAllEnvs(); vi.useRealTimers(); vi.clearAllMocks(); rmSync(root, { recursive: true, force: true });
});
async function openPair() {
  const caregiver = await post("demo"); expect(caregiver.status).toBe(200);
  const familyCookie = cookies(caregiver), family = await state(familyCookie);
  const patient = await post("demo-patient", familyCookie); expect(patient.status).toBe(200);
  return { familyCookie, patientCookie: cookies(patient), household: family.household };
}
async function completeCall(cookie: string, household: string, replies: string[]) {
  vi.mocked(transcribe).mockImplementation(async () => {
    const text = replies.shift() ?? "No.";
    return { transcript: text, words: text.split(" ").map((w, i) => ({ w, start_ms: i * 100, end_ms: i * 100 + 90 })) };
  });
  expect((await call("start", cookie, {})).status).toBe(200);
  const live = await getSampleRecall(household);
  const seen = new Set<string>(), photos: string[] = [], spoken: string[] = [];
  for (let i = 0; i < 700 && sampleCallRunning(household); i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
    const response = await call("status", cookie), data = await response.json();
    expect(response.status).toBe(200);
    const command = data.command;
    if (!command || seen.has(command.id)) continue;
    seen.add(command.id);
    if (command.kind === "speak") {
      spoken.push(command.text);
      if (spoken.length === 2) expect(data.photos.length).toBeGreaterThan(0);
    }
    if (data.photos?.length) {
      expect(data.photos[0].url).toContain("/api/demo/call/photo?");
      const url = new URL(data.photos[0].url, "http://localhost:3001");
      expect((await call("photo", cookie, undefined, url.search)).status).toBe(200);
      photos.push(...data.photos.map((p: { id: string }) => p.id));
    }
    if (command.kind === "speak" || command.kind === "playback") expect((await call("audio", cookie, undefined, `?step=${command.id}`)).status).toBe(200);
    const responseAction = await call("action", cookie, command.kind === "listen" ? audio : {}, `?action=${command.kind === "listen" ? "audio" : "ack"}&step=${command.id}`);
    expect(responseAction.status).toBe(200);
  }
  expect(sampleCallRunning(household)).toBe(false);
  expect(live.currentCall()).toBeNull();
  return { live, photos, spoken };
}
describe("paired local caregiver and patient demos", () => {
  it("repairs an unexpected question and a confirmation repeat without saving either as a memory", async () => {
    const pair = await openPair();
    const memory = "I don't remember the year, but we grew tomatoes with Maya every summer.";
    const { live, spoken } = await completeCall(pair.patientCookie, pair.household, ["Could you repeat that?", "Which picture do you mean?", memory, "Can you say that again?", "Yes.", "No."]);
    expect(spoken[1]).toBe(spoken[2]);
    expect(spoken.filter(text => text === "Want me to remember that?")).toHaveLength(2);
    const contributions = await live.graph.nodesOfType("Contribution");
    expect(contributions).toHaveLength(1);
    expect(contributions[0]!.props).toMatchObject({ literal_transcript: memory, shared: false });
    expect((await live.graph.nodesOfType("TopicOutcome"))[0]!.props).toMatchObject({ first_rung_reached_unaided: 3, highest_rung_used: 3 });
    expect((await state(pair.familyCookie)).stories).toEqual([]);
  });
  it("gives a thinking turn room, then still honors an explicit stop", async () => {
    const pair = await openPair();
    const { live, spoken } = await completeCall(pair.patientCookie, pair.household, ["Let me think.", "I have to go."]);
    expect(spoken).toHaveLength(3);
    expect(await live.graph.nodesOfType("Contribution")).toEqual([]);
    expect(await live.graph.nodesOfType("TopicOutcome")).toEqual([]);
  });
  it("closes repeated conversational detours without a stuck call or stored question", async () => {
    const pair = await openPair();
    const { live } = await completeCall(pair.patientCookie, pair.household, Array(4).fill("What do you mean?"));
    expect(await live.graph.nodesOfType("Contribution")).toEqual([]);
    expect((await live.graph.nodesOfType("Session"))[0]!.props.outcome).toBe("no_answer_today");
  });
  it("can open the patient demo first and then join that same family from the home page", async () => {
    const patient = await post("demo-patient");
    expect(patient.status).toBe(200);
    const cookie = cookies(patient), household = samplePatient(request("/api/demo/session", cookie))!.household_id;
    const family = await post("demo", cookie);
    expect(family.status).toBe(200);
    expect((await state(cookies(family))).household).toBe(household);
    expect((await getSampleRecall(household)).currentCall()).toBeNull();
    vi.stubEnv("DEEPGRAM_API_KEY", "");
    expect((await call("start", cookie, {})).status).toBe(503);
    expect(sampleCallRunning(household)).toBe(false);
  });
  it("uses separate sessions in one household and preserves the caregiver collection on re-entry", async () => {
    const pair = await openPair();
    expect(browserPrincipal(request("/api/circle/state", pair.patientCookie))?.role).toBe("family");
    expect(samplePatient(request("/api/demo/call/status", pair.patientCookie))?.household_id).toBe(pair.household);
    expect((await (await demoSession(request("/api/demo/session", pair.patientCookie))).json()).principal.role).toBe("patient");
    updateCircle(pair.household, s => { s.moments[0]!.title = "Family edit"; });
    const reopened = await post("demo", pair.familyCookie);
    expect((await state(cookies(reopened))).household).toBe(pair.household);
    expect(readCircle(pair.household).moments[0]!.title).toBe("Family edit");
    expect(activeHousehold()).toBeUndefined();
    expect((await call("start", pair.familyCookie, {})).status).toBe(403);
    const cross = request("/api/demo/call/start", pair.patientCookie, {}); cross.headers.set("Origin", "https://elsewhere.test");
    expect((await demoPost(cross, { params: Promise.resolve({ action: "start" }) })).status).toBe(403);
    vi.stubEnv("NODE_ENV", "production");
    expect((await call("start", pair.patientCookie, {})).status).toBe(404);
  });
  it.each([true, false])("stores confirmed memories in the shared household graph and publishes only with share confirmation (%s)", async share => {
    const pair = await openPair(), text = "I watered the flowers with Maya every morning.";
    const { live, photos } = await completeCall(pair.patientCookie, pair.household, [text, "Yes.", share ? "Yes." : "No."]);
    const contributions = await live.graph.nodesOfType("Contribution");
    expect(contributions).toHaveLength(1);
    expect(contributions[0]!.props).toMatchObject({ literal_transcript: text, shared: share });
    expect(photos.length).toBeGreaterThan(0);
    const family = await state(pair.familyCookie);
    expect(family.stories.map(story => story.text)).toEqual(share ? [text] : []);
    if (share) {
      const evidence = family.stories[0]!.callEvidence!;
      expect(evidence).toMatchObject({ edgeType: "ABOUT", properties: {}, author: "Susan", status: "participant_confirmed", source: "Shared Recall call" });
      expect(evidence.shareConfirmedAt).toBeTruthy();
      updateCircle(pair.household, s => { delete s.stories[0]!.callEvidence; });
      expect((await state(pair.familyCookie)).stories[0]!.callEvidence).toEqual(evidence);
    }
    expect(family.photos).toHaveLength(6); expect(family.moments).toHaveLength(2);
    const dashboard = await familyDashboard(request(`/api/family/dashboard?member=${family.member}`, pair.familyCookie));
    expect(dashboard.status).toBe(200);
    const record = await dashboard.json();
    expect(record.info.sessions).toHaveLength(1);
    expect(record.info.sessions[0]).toMatchObject({ recentCalls: 1, unaidedCalls: null, outcome: "cue" });
    expect(record.topic_record.topics[0].lines[0].script_id).toBe("FAM-REC-NOT-ENOUGH");
    expect(record.can_pause).toBe(true);
    expect(JSON.stringify(record.info.sessions)).not.toContain(text);
    const exported = await familyExport(request("/api/family/export", pair.familyCookie, { member: family.member }));
    expect(exported.status).toBe(200);
    const document = await exported.text();
    expect(document).toContain("not a clinical assessment or diagnosis");
    expect(document).not.toContain(text);
    expect(await live.graph.nodesOfType("ExportEvent")).toHaveLength(1);
    await syncSampleSharedMemories(pair.household);
    expect(readCircle(pair.household).stories).toHaveLength(share ? 1 : 0);
    if (share) {
      const policy = (await getOnboarding().currentSetup(pair.household))!.document;
      policy.dashboard.grants[0]!.revoked_at = new Date().toISOString();
      await getOnboarding().tightenSetup(pair.household, policy, policy.recall_set_up_by);
      expect((await state(pair.familyCookie)).stories).toEqual([]);
      const restricted = await (await familyDashboard(request(`/api/family/dashboard?member=${family.member}`, pair.familyCookie))).json();
      expect(restricted.info.detail_level).toBeNull();
      expect(restricted.info.sessions).toEqual([]);
      expect((await familyExport(request("/api/family/export", pair.familyCookie, { member: family.member }))).status).toBe(403);
    }
  });
  it("keeps sample record access, exports and pause bound to the signed household", async () => {
    const first = await openPair();
    vi.setSystemTime(new Date(Date.now() + 1000));
    const second = await openPair();
    const a = await state(first.familyCookie), b = await state(second.familyCookie);
    expect((await familyDashboard(request(`/api/family/dashboard?member=${b.member}`, first.familyCookie))).status).toBe(403);
    expect((await familyExport(request("/api/family/export", first.familyCookie, { member: b.member }))).status).toBe(403);
    const cross = request("/api/family/export", first.familyCookie, { member: a.member });
    cross.headers.set("Origin", "https://elsewhere.test");
    expect((await familyExport(cross)).status).toBe(403);
    expect((await familyPause(request("/api/family/pause", first.familyCookie, {}))).status).toBe(200);
    expect((await getOnboarding().currentSetup(a.household))!.document.calls_paused).toBe(true);
    expect((await getOnboarding().currentSetup(b.household))!.document.calls_paused).toBe(false);
    expect(activeHousehold()).toBeUndefined();
  });
  it("keeps deleted shared stories out of the collection after call sync without removing the private confirmed memory", async () => {
    const pair = await openPair(), text = "I watered the flowers with Maya every morning.";
    const { live } = await completeCall(pair.patientCookie, pair.household, [text, "Yes.", "Yes."]);
    const before = await state(pair.familyCookie), contributions = await live.graph.nodesOfType("Contribution");
    expect(before.stories).toHaveLength(1);
    const response = await circlePost(request("/api/circle/delete-story", pair.familyCookie, { id: before.stories[0]!.id }), { params: Promise.resolve({ path: ["delete-story"] }) });
    expect(response.status).toBe(200);
    for (let i = 0; i < 2; i++) {
      await syncSampleSharedMemories(pair.household);
      const after = await state(pair.familyCookie);
      expect(after.stories).toEqual([]);
      expect(after.photos).toEqual(before.photos);
      expect(after.moments.map(m => m.id)).toEqual(before.moments.map(m => m.id));
    }
    expect(await live.graph.nodesOfType("Contribution")).toEqual(contributions);
  });
  it("keeps a stopped confirmation out of both the graph and caregiver memories", async () => {
    const pair = await openPair();
    const { live } = await completeCall(pair.patientCookie, pair.household, ["I watered the flowers with Maya every morning.", "Yes.", "I have to go."]);
    expect(await live.graph.nodesOfType("Contribution")).toEqual([]);
    expect((await state(pair.familyCookie)).stories).toEqual([]);
  });
});
