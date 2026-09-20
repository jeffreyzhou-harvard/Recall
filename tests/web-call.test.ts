import { KnowledgeUpdater } from "@/lib/knowledge/updates";
import { planQuestion } from "@/lib/knowledge/questions";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CallAttempts } from "@/server/call-attempts";
import { SqliteGraphStore } from "@/server/graph-store";
import { WebCall, LiveTranscription } from "@/server/web-call";
import { MediaStore, parseWav, wavFromPcm, cleanPhoto } from "@/server/media";
import { createTopic } from "@/server/topics";
import { buildFixtureRig } from "@/fixtures/harness";
import { CALL_SCRIPT, FAMILY_COPY, RECORD_THRESHOLDS, SAFETY_PHRASES, SAFETY_THRESHOLDS } from "@/fixtures";
import { RecallService } from "@/lib/service/recall-service";
import { issueAccount, revokeAccount } from "@/server/accounts";
import { principalForKey, sessionCookie, browserPrincipal } from "@/server/session";
import { isFamily, isOperator } from "@/server/operator";
import { DurableAlerts } from "@/server/alerts";
import { attestationsMissing } from "@/lib/tools/policy";
import { callPhotoSource } from "@/server/call-photos";
import { edgeId } from "@/lib/graph/seed";
import { GET as photoGET } from "@/app/api/call/photo/route";
import { GET as statusGET } from "@/app/api/call/status/route";
import { POST as actionPOST } from "@/app/api/call/action/route";
import { CallCaptions } from "@/server/call-captions";
import type { LiveHandlers } from "@/lib/providers/deepgram";
import { getLiveRecall } from "@/server/recall-live";
vi.mock("@/server/recall-live", async (original) => ({ ...await original<typeof import("@/server/recall-live")>(), getLiveRecall: vi.fn() }));
const folders: string[] = [], stores: Array<{ close(): void }> = [];
function folder() { const path = mkdtempSync(join(tmpdir(), "recall-web-")); folders.push(path); return path; }
afterEach(() => { for (const store of stores.splice(0)) store.close(); vi.unstubAllEnvs(); vi.useRealTimers(); for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true }); });
const audio = wavFromPcm(new Uint8Array(16000 * 2 * 3));
const words = (text: string) => text.split(" ").filter(Boolean).map((w, i) => ({ w, start_ms: i * 100, end_ms: i * 100 + 90 }));
async function rig(replies: string[] = [], captions?: CallCaptions) {
  const root = folder(), graph = new SqliteGraphStore(join(root, "recall-graph.db"), "test"); stores.push(graph);
  const fixture = await buildFixtureRig({ graph });
  const media = new MediaStore(root, "test", fixture.assets, graph); stores.push(media);
  const transcript = new LiveTranscription();
  const recognition = vi.fn(async () => ({ transcript: "", words: words(replies.shift() ?? "") }));
  const driver = new WebCall("person:susan", media, transcript, fixture.graph, "standard", 8, recognition, async () => audio, captions);
  return { ...fixture, safetyThresholds: SAFETY_THRESHOLDS, media, transcript, driver, recognition };
}
async function drive(driver: WebCall, done: Promise<unknown>, onListen: (step: string, number: number) => Promise<void>) {
  let ended = false, failure: unknown; const settled = done.then(() => { ended = true; }, (e) => { ended = true; failure = e; });
  let seen = "", number = 0;
  for (let n = 0; n < 300 && !ended; n++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    const command = driver.command;
    if (!command || command.id === seen) continue; seen = command.id;
    if (command.kind === "listen") await onListen(command.id, number++); else driver.acknowledge(command.id);
  }
  if (!ended) driver.stop(); await settled; if (failure) throw failure;
  expect(ended).toBe(true);
}
async function topicPhoto(r: Awaited<ReturnType<typeof rig>>) {
  const topic = await createTopic(r.graph, r.setup.current(), { contributor_id: "person:maya", label: "baking bread", story: "Maya and I baked bread together." });
  const policy = r.setup.current(); policy.topics.allow = [topic.id]; policy.topics.block = []; r.setup.replace(policy);
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lVUAAAAASUVORK5CYII=", "base64");
  const media = r.media.make(bytes, "person:maya", "image/png", null); await r.media.save(media, true);
  const id = `artifact:${media.entry.id}`, prov = { ...(await r.graph.getNode(topic.id))!.prov, source_id: id, asset_id: media.entry.id, media_hash: media.entry.sha256 };
  const claim = (await r.graph.getNode(`claim:${topic.id}`))!;
  await r.graph.putEdge({ id: edgeId("ABOUT", claim.id, "person:maya"), type: "ABOUT", from: claim.id, to: "person:maya", props: {}, prov: claim.prov });
  await r.graph.putNode({ id, type: "Artifact", label: "Family photograph", props: { kind: "photo", text: null, alt: null }, prov });
  for (const [type, to] of [["DEPICTS", topic.id], ["PERMITTED_IN", policy.policy_id]] as const) await r.graph.putEdge({ id: edgeId(type, id, to), type, from: id, to, props: {}, prov });
  r.driver.photoSource = callPhotoSource(r.graph, r.media, r.setup, () => r.clock.iso());
  return { topic, id, media, context: { topic_id: topic.id, artifact_ids: [id] } };
}
describe("live browser transport", () => {
  it("exposes interim captions only to the current household patient and never stores them", async () => {
    let handlers!: LiveHandlers;
    const stream = { sendAudio: vi.fn(), end: vi.fn() };
    const r = await rig([], new CallCaptions((_rate, callbacks) => { handlers = callbacks; return stream; }));
    vi.stubEnv("RECALL_DATA_DIR", folder()); vi.stubEnv("RECALL_HOUSEHOLD", "caption-household");
    vi.stubEnv("RECALL_FAMILY_CREDENTIALS", "{}"); vi.stubEnv("RECALL_FAMILY_SECRET", "");
    vi.mocked(getLiveRecall).mockResolvedValue({ currentCall: () => r.driver, setup: r.setup, refreshSetup: async () => {} } as Awaited<ReturnType<typeof getLiveRecall>>);
    const listening = r.driver.listen().catch(() => undefined), step = r.driver.command!.id;
    const base = "https://recall.test";
    const cookie = (household: string, member: string, role: "patient" | "family") => {
      const key = issueAccount(household, member, role);
      return sessionCookie(principalForKey(key)!, new Request(base)).split(";")[0]!;
    };
    const patient = cookie("caption-household", "person:susan", "patient"), family = cookie("caption-household", "person:maya", "family"), outsider = cookie("other-household", "person:outsider", "patient");
    const upload = (credential: string, origin = base) => new Request(`${base}/api/call/action?action=caption&step=${step}&rate=16000&sequence=0`, { method: "POST", headers: { cookie: credential, Origin: origin }, body: new Uint8Array(16000) });
    expect((await actionPOST(upload(family))).status).toBe(403);
    expect((await actionPOST(upload(outsider))).status).toBe(403);
    expect((await actionPOST(upload(patient, "https://another.test"))).status).toBe(403);
    expect((await actionPOST(upload(patient))).status).toBe(200);
    handlers.onTranscript!("Only the patient can see this draft", false);
    const status = (credential: string) => statusGET(new Request(`${base}/api/call/status`, { headers: { cookie: credential } }));
    expect((await (await status(patient)).json()).caption).toMatchObject({ text: "Only the patient can see this draft", final: false });
    expect((await (await status(family)).json()).caption).toBeUndefined();
    expect(r.recognition).not.toHaveBeenCalled();
    expect((await r.graph.nodesOfType("Contribution")).some(node => node.props.literal_transcript.includes("this draft"))).toBe(false);
    r.driver.stop(); await listening; handlers.onTranscript!("Late words", true);
    expect((await (await status(patient)).json()).caption).toBeNull();
    expect((await actionPOST(upload(patient))).status).toBe(409);
    expect(stream.end).toHaveBeenCalledOnce(); await r.driver.hangUp();
  });
  it.each([false, true])("surfaces verified topic photos after free recall and preserves confirmation (support=%s)", async (support) => {
    const r = await rig([...(support ? ["I don’t remember."] : ["Yes."]), "I mixed the flour with Maya.", "Yes.", "Yes."]);
    const photo = await topicPhoto(r);
    const service = new RecallService({ ...r, transcription: r.transcript, callDriver: () => r.driver, script: CALL_SCRIPT, copy: FAMILY_COPY, thresholds: RECORD_THRESHOLDS, safetyPhrases: SAFETY_PHRASES, isCallStopped: () => r.driver.cannotCommit });
    const run = service.runScheduledCall(`session:photo-${support}`), seen: string[][] = [];
    await drive(r.driver, run, async (id) => { seen.push((await r.driver.photos()).map((p) => p.id)); await r.driver.receive(id, audio); });
    expect(seen[0]).toEqual([]);
    if (!support) expect(seen[1]).toEqual([]); // A bare "yes" must not silently become a photo-assisted answer.
    expect(seen.slice(support ? 1 : 2)).toEqual([[photo.id], [photo.id], ...(support ? [[photo.id]] : [])]);
    expect((await run)?.recording.final_state).toBe("stored");
    expect((await run)?.ctx.session.telemetry.rungs_fired.map((rung) => rung.rung)).toEqual(support ? [1, 3] : [1]);
    expect(await r.driver.photos()).toEqual([]);
    expect(await r.driver.photo(r.driver.call_asset_id, photo.id)).toBeNull();
  });
  it("limits photo delivery to the current call and rechecks revocation while she is listening", async () => {
    const r = await rig(), photo = await topicPhoto(r);
    const source = r.driver.photoSource!;
    expect(await source({ ...photo.context, topic_id: "event:unrelated" })).toEqual([]);
    expect(await source({ ...photo.context, artifact_ids: ["artifact:unrelated"] })).toEqual([]);
    const speaking = r.driver.speak({ prompt_id: "verified-question", text: "What comes to mind?", photos: photo.context });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const visible = await r.driver.photos(); expect(visible).toHaveLength(1);
    expect(await r.driver.photo("old-call", photo.id)).toBeNull();
    expect(await r.driver.photo(r.driver.call_asset_id, "other-photo")).toBeNull();
    expect((await r.driver.photo(r.driver.call_asset_id, photo.id))?.bytes).toEqual(photo.media.bytes);
    r.driver.acknowledge(r.driver.command!.id); await speaking;
    const listening = r.driver.listen().catch(() => undefined);
    expect(await r.driver.photos()).toEqual(visible);
    const policy = r.setup.current();
    policy.approved_people = [...new Set([...policy.approved_people, "person:priya"])];
    policy.recall_set_up_by = "person:priya";
    policy.safety.designated_caregivers = [{ ...policy.safety.designated_caregivers[0]!, person_id: "person:priya" }];
    r.setup.replace(policy); r.setup.revokeContributor("person:maya", r.clock.iso());
    expect(await r.driver.photos()).toEqual([]);
    expect(await r.driver.photo(r.driver.call_asset_id, photo.id)).toBeNull();
    r.driver.stop(); await listening; await r.driver.hangUp();
  });
  it("rejects missing or mismatched photo evidence and newly blocked topics", async () => {
    const r = await rig(), photo = await topicPhoto(r), source = r.driver.photoSource!;
    const get = vi.spyOn(r.media, "get");
    get.mockReturnValueOnce({ ...photo.media, bytes: Buffer.from("changed evidence") });
    expect(await source(photo.context)).toEqual([]);
    get.mockReturnValueOnce({ ...photo.media, owner: "person:someone-else" });
    expect(await source(photo.context)).toEqual([]);
    expect(await source(photo.context)).toHaveLength(1);
    r.setup.revokeTopic(photo.topic.id); expect(await source(photo.context)).toEqual([]);
    const policy = r.setup.current(); policy.topics.allow = [photo.topic.id]; policy.topics.block = []; r.setup.replace(policy);
    r.media.remove(photo.media.entry.id); expect(await source(photo.context)).toEqual([]);
  });
  it("photo failures and in-flight photo requests cannot reopen a stopped call", async () => {
    const r = await rig(), photo = await topicPhoto(r);
    const speaking = r.driver.speak({ prompt_id: "photo", text: "What comes to mind?", photos: photo.context });
    await new Promise((resolve) => setTimeout(resolve, 0));
    r.driver.photoSource = async () => { throw new Error("image unavailable"); };
    expect(await r.driver.photos()).toEqual([]);
    expect(r.driver.command?.kind).toBe("speak");
    let release!: () => void;
    r.driver.photoSource = () => new Promise((resolve) => { release = () => resolve([{ id: photo.id, media: photo.media }]); });
    const pending = r.driver.photos();
    const stopped = speaking.catch(() => undefined); r.driver.stop(); release();
    expect(await pending).toEqual([]); await stopped; await r.driver.hangUp();
  });
  it("serves photo bytes only to this household's patient through the active call route", async () => {
    const r = await rig(), photo = await topicPhoto(r);
    vi.stubEnv("RECALL_DATA_DIR", folder()); vi.stubEnv("RECALL_HOUSEHOLD", "photo-household");
    vi.stubEnv("RECALL_FAMILY_CREDENTIALS", "{}"); vi.stubEnv("RECALL_FAMILY_SECRET", "");
    const live = { currentCall: () => r.driver, setup: r.setup, refreshSetup: async () => {} };
    vi.mocked(getLiveRecall).mockResolvedValue(live as Awaited<ReturnType<typeof getLiveRecall>>);
    const url = `https://recall.test/api/call/photo?call=${encodeURIComponent(r.driver.call_asset_id)}&photo=${encodeURIComponent(photo.id)}`;
    const request = (household: string, member: string, role: "patient" | "family") => {
      const key = issueAccount(household, member, role);
      const cookie = sessionCookie(principalForKey(key)!, new Request(url)).split(";")[0]!;
      return new Request(url, { headers: { cookie } });
    };
    expect((await photoGET(new Request(url))).status).toBe(403);
    expect((await photoGET(request("photo-household", "person:maya", "family"))).status).toBe(403);
    expect((await photoGET(request("other-household", "other-patient", "patient"))).status).toBe(403);
    expect((await photoGET(request("photo-household", "different-patient", "patient"))).status).toBe(403);
    const patient = request("photo-household", "person:susan", "patient");
    expect((await photoGET(patient)).status).toBe(404); // Approved photo, but no visual cue yet.
    const speaking = r.driver.speak({ prompt_id: "photo", text: "What comes to mind?", photos: photo.context });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const state = await (await statusGET(patient)).json();
    expect(state.photos).toEqual([{ id: photo.id, url: new URL(url).pathname + new URL(url).search }]);
    const response = await photoGET(patient);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(photo.media.bytes);
    r.driver.acknowledge(r.driver.command!.id); await speaking; await r.driver.hangUp();
    expect((await photoGET(patient)).status).toBe(404);
  });
  it("requires the current command, real audio, and completed playback", async () => {
    const r = await rig(["Yes."]); const connect = r.driver.connect();
    expect(() => r.driver.acknowledge("stale")).toThrow(); r.driver.acknowledge(r.driver.command!.id); await connect;
    const listen = r.driver.listen(); expect(() => r.driver.acknowledge(r.driver.command!.id)).toThrow();
    await r.driver.receive(r.driver.command!.id, audio); const window = await listen;
    expect((await r.transcript.turnsIn(window))[0]?.words[0]?.w).toBe("Yes.");
    const playing = r.driver.playback({ asset_id: window.asset_id, spans: [{ start_ms: 0, end_ms: 100 }] });
    expect(parseWav(r.driver.audio(r.driver.command!.id)!).duration).toBe(100);
    r.driver.acknowledge(r.driver.command!.id); await playing;
    await r.driver.hangUp(); expect(r.media.get(window.asset_id)).toBeNull(); await expect(r.transcript.allTurns(window.asset_id)).rejects.toThrow();
  });
  it("runs a real family-sourced topic through spoken confirmation and stores only the confirmed audio", async () => {
    const r = await rig(["Yes.", "I mixed the flour with Maya.", "Yes.", "Yes."]);
    const topic = await createTopic(r.graph, r.setup.current(), { contributor_id: "person:maya", label: "baking bread", story: "We baked bread together." });
    const policy = structuredClone(r.setup.current()); policy.topics.allow = [topic.id]; policy.topics.block = []; r.setup.replace(policy);
    const updater = new KnowledgeUpdater(r.graph, () => r.setup.current(), undefined, undefined, r.clock);
    await updater.process(100);
    const service = new RecallService({ ...r, knowledgeQuestions: true, enrichKnowledge: () => updater.process(100), transcription: r.transcript, callDriver: () => r.driver, script: CALL_SCRIPT, copy: FAMILY_COPY, thresholds: RECORD_THRESHOLDS, safetyPhrases: SAFETY_PHRASES, isCallStopped: () => r.driver.cannotCommit, onContributionCommitted: async (ctx) => r.driver.retainConfirmed({ contribution_hash: ctx.session.stored!.contribution_hash, store: ctx.session.store_confirmation, share: ctx.session.share_confirmation, share_audio: ctx.session.share_audio_window }) });
    const run = service.runScheduledCall("session:web-test"); await drive(r.driver, run, async (id) => { await r.driver.receive(id, audio); });
    const result = await run; expect(result?.recording.final_state).toBe("stored");
    const contribution = (await r.graph.nodesOfType("Contribution")).find((n) => n.id.includes("web-test"));
    expect(contribution?.props.literal_transcript).toBe("I mixed the flour with Maya."); expect(contribution?.props.shared).toBe(true);
    expect((await r.graph.edgesOf(result!.ctx.session.stored!.claim_id)).some((e) => e.type === "ABOUT" && e.to === "person:maya" && e.props.mention_only === true)).toBe(true);
    expect(await planQuestion(r.graph, r.setup.current(), topic.id, r.clock.iso())).toMatchObject({ purpose: "fill_gap", gap: "place" });
    expect(r.media.get(contribution!.prov.asset_id!)?.entry.sha256).toBe(contribution?.prov.media_hash);
    expect(r.media.get(result!.ctx.session.store_confirmation!.audio.asset_id)).not.toBeNull();
    expect(r.media.get(result!.ctx.session.share_audio_window!.asset_id)).not.toBeNull();
  });
  it("honors a stop at the share question without storing her contribution", async () => {
    const r = await rig(["Yes.", "I played with my daughter on the sand.", "Yes."]);

    const service = new RecallService({ ...r, transcription: r.transcript, callDriver: () => r.driver, script: CALL_SCRIPT, copy: FAMILY_COPY, thresholds: RECORD_THRESHOLDS, safetyPhrases: SAFETY_PHRASES, isCallStopped: () => r.driver.cannotCommit, onContributionCommitted: async (ctx) => r.driver.retainConfirmed({ contribution_hash: ctx.session.stored!.contribution_hash, store: ctx.session.store_confirmation, share: ctx.session.share_confirmation, share_audio: ctx.session.share_audio_window }) });
    const run = service.runScheduledCall("session:web-stop"); await drive(r.driver, run, async (id, i) => { if (i === 3) r.driver.stop(); else await r.driver.receive(id, audio); });
    expect((await run)?.recording.final_state).toBe("stopped"); expect((await r.graph.nodesOfType("Contribution")).some((n) => n.id.includes("web-stop"))).toBe(false);
  });
  it("rolls back graph, receipt, and retained audio if a stop arrives at the commit boundary", async () => {
    const r = await rig(["Yes.", "I mixed the flour with my sister.", "Yes.", "Yes."]);
    const service = new RecallService({ ...r, transcription: r.transcript, callDriver: () => r.driver, script: CALL_SCRIPT, copy: FAMILY_COPY, thresholds: RECORD_THRESHOLDS, safetyPhrases: SAFETY_PHRASES, isCallStopped: () => r.driver.cannotCommit,
      onContributionCommitted: async (ctx) => { await r.driver.retainConfirmed({ contribution_hash: ctx.session.stored!.contribution_hash, store: ctx.session.store_confirmation, share: ctx.session.share_confirmation, share_audio: ctx.session.share_audio_window }); r.driver.stop(); } });
    const run = service.runScheduledCall("session:atomic-stop"); await drive(r.driver, run, async (id) => { await r.driver.receive(id, audio); });
    expect((await run)?.recording.final_state).toBe("stopped");
    expect((await r.graph.nodesOfType("Contribution")).some((n) => n.id.includes("atomic-stop"))).toBe(false);
    const db = (r.graph as SqliteGraphStore).mediaDatabase();
    expect(db.prepare("SELECT count(*) AS n FROM confirmation_receipts").get()!.n).toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM media").get()!.n).toBe(0);
  });
  it("keeps hang-up latched when a non-safety transcript completes afterward", async () => {
    const r = await rig(["Yes.", "I mixed the flour with my sister.", "Yes.", "Yes."]);
    const service = new RecallService({ ...r, transcription: r.transcript, callDriver: () => r.driver, script: CALL_SCRIPT, copy: FAMILY_COPY, thresholds: RECORD_THRESHOLDS, safetyPhrases: SAFETY_PHRASES, isCallStopped: () => r.driver.cannotCommit });
    const run = service.runScheduledCall("session:stop-during-upload");
    await drive(r.driver, run, async (id, i) => {
      if (i !== 3) { await r.driver.receive(id, audio); return; }
      let finish!: (result: { transcript: string; words: ReturnType<typeof words> }) => void;
      r.recognition.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      const receiving = r.driver.receive(id, audio);
      r.driver.stop(); finish({ transcript: "Yes.", words: words("Yes.") });
      await receiving;
    });
    expect((await run)?.recording.final_state).toBe("stopped");
    expect(r.driver.cannotCommit).toBe(true);
    expect((await r.graph.nodesOfType("Contribution")).some((n) => n.id.includes("stop-during-upload"))).toBe(false);
    expect((r.graph as SqliteGraphStore).mediaDatabase().prepare("SELECT count(*) AS n FROM media").get()!.n).toBe(0);
  });

  it.each(["I fell.", "I mixed the flour with my sister."])("keeps an in-flight HTTP upload available for safety checks after hang-up: %s", async (reply) => {
    const r = await rig([reply]);
    const service = new RecallService({ ...r, transcription: r.transcript, callDriver: () => r.driver, script: CALL_SCRIPT, copy: FAMILY_COPY, thresholds: RECORD_THRESHOLDS, safetyPhrases: SAFETY_PHRASES, isCallStopped: () => r.driver.cannotCommit });
    const run = service.runScheduledCall("session:stop-during-body");
    await drive(r.driver, run, async (id) => {
      let finish!: (body: Buffer) => void;
      const receiving = r.driver.receive(id, () => new Promise((resolve) => { finish = resolve; }));
      r.driver.stop(); finish(audio); await receiving;
    });
    expect((await run)?.recording.final_state).toBe(reply === "I fell." ? "safety_handoff" : "stopped");
    expect(r.alerts.count()).toBe(reply === "I fell." ? 1 : 0);
    expect(r.driver.cannotCommit).toBe(true);
    expect((r.graph as SqliteGraphStore).mediaDatabase().prepare("SELECT count(*) AS n FROM media").get()!.n).toBe(0);
  });

  it("does not cancel a submitted final recording when hang-up arrives during transcription", async () => {
    const r = await rig();
    let finish!: (result: { transcript: string; words: ReturnType<typeof words> }) => void;
    r.recognition.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const service = new RecallService({ ...r, transcription: r.transcript, callDriver: () => r.driver, script: CALL_SCRIPT, copy: FAMILY_COPY, thresholds: RECORD_THRESHOLDS, safetyPhrases: SAFETY_PHRASES });
    const run = service.runScheduledCall("session:late-safety");
    await drive(r.driver, run, async (id) => { const receiving = r.driver.receive(id, audio); r.driver.stop(); finish({ transcript: "", words: words("I fell.") }); await receiving; });
    expect((await run)?.recording.final_state).toBe("safety_handoff"); expect(r.alerts.count()).toBeGreaterThan(0);
  });
  it("honors a hang-up submitted with audio even when transcription fails", async () => {
    const r = await rig(); r.recognition.mockRejectedValueOnce(new Error("provider unavailable"));
    const service = new RecallService({ ...r, transcription: r.transcript, callDriver: () => r.driver, script: CALL_SCRIPT, copy: FAMILY_COPY, thresholds: RECORD_THRESHOLDS, safetyPhrases: SAFETY_PHRASES, isCallStopped: () => r.driver.cannotCommit });
    const run = service.runScheduledCall("session:stop-provider-failed");
    await drive(r.driver, run, async (id) => { await r.driver.receive(id, audio, true); });
    expect((await run)?.recording.final_state).toBe("stopped");
    expect(r.driver.cannotCommit).toBe(true);
  });

  it("counts a ring that happened before a process failure toward the minimum call interval", async () => {
    const r = await rig(), dir = folder(), first = new CallAttempts(dir, "test"); first.record("session:interrupted-process", r.clock.iso()); first.close();
    const reopened = new CallAttempts(dir, "test"); stores.push(reopened);
    const service = new RecallService({ ...r, transcription: r.transcript, callDriver: () => r.driver, script: CALL_SCRIPT, copy: FAMILY_COPY, thresholds: RECORD_THRESHOLDS, safetyPhrases: SAFETY_PHRASES, callAttempts: () => reopened.all() });
    const result = await service.runScheduledCall("session:after-restart"); expect(result?.recording.final_state).toBe("blocked"); expect(r.driver.command).toBeNull();
  });
  it("checks a safety phrase before a hang-up submitted with its recording", async () => {
    const r = await rig(["I fell."]);
    const service = new RecallService({ ...r, transcription: r.transcript, callDriver: () => r.driver, script: CALL_SCRIPT, copy: FAMILY_COPY, thresholds: RECORD_THRESHOLDS, safetyPhrases: SAFETY_PHRASES });
    const run = service.runScheduledCall("session:web-safety"); await drive(r.driver, run, async (id) => { await r.driver.receive(id, audio, true); });
    expect((await run)?.recording.final_state).toBe("safety_handoff"); expect(r.alerts.count()).toBeGreaterThan(0);
    expect(JSON.stringify(r.alerts.sentTo("person:maya"))).not.toContain("I fell.");
  });
});
describe("private media and accounts", () => {
  it("rejects invalid audio and strips optional WAV metadata", () => {
    expect(parseWav(audio).duration).toBe(3000); expect(() => parseWav(Buffer.from("not audio"))).toThrow();
    expect(() => parseWav(wavFromPcm(new Uint8Array(16000 * 2 * 91)))).toThrow(); expect(() => cleanPhoto(Buffer.from("<svg>"))).toThrow();
  });
  it("removes optional PNG metadata without changing image chunks", () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhfcAAAAASUVORK5CYII=", "base64");
    const payload = Buffer.from("location=must-not-be-ingested"), chunk = Buffer.alloc(payload.length + 12); chunk.writeUInt32BE(payload.length, 0); chunk.write("tEXt", 4); chunk.set(payload, 8);
    const decorated = Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
    expect(cleanPhoto(decorated).bytes.equals(png)).toBe(true);
  });
  it("preserves committed audio and deletes unconfirmed patient audio when recovering a process", async () => {
    const r = await rig();
    const pending = r.media.make(audio, "person:susan", "audio/wav", 3000), kept = r.media.make(audio, "person:susan", "audio/wav", 3000);
    await r.media.save(pending); await r.media.save(kept); r.media.reconcile(new Set([kept.entry.id]), "person:susan");
    expect(r.media.get(pending.entry.id)).toBeNull(); expect(r.media.get(kept.entry.id)).not.toBeNull();
  });
  it("revokes old sessions on key replacement and keeps patient credentials out of family and operator routes", () => {
    vi.stubEnv("RECALL_DATA_DIR", folder()); vi.stubEnv("RECALL_OPERATOR_SECRET", "operator"); vi.stubEnv("RECALL_FAMILY_CREDENTIALS", "{}"); vi.stubEnv("RECALL_FAMILY_SECRET", "");
    const key = issueAccount("h", "patient", "patient"), principal = principalForKey(key)!;
    const req = new Request("https://recall.test"), cookie = sessionCookie(principal, req).split(";")[0]!;
    const signed = new Request("https://recall.test", { headers: { cookie } });
    expect(browserPrincipal(signed)?.role).toBe("patient"); expect(isFamily(signed)).toBe(false); expect(isOperator(signed)).toBe(false);
    issueAccount("h", "patient", "patient"); expect(browserPrincipal(signed)).toBeNull(); expect(principalForKey(key)).toBeNull(); revokeAccount("patient");
  });
  it("keeps browser introductions mandatory without requiring a telephone contact", async () => {
    const r = await buildFixtureRig(), p = structuredClone(r.setup.current()); p.call_transport = "web"; p.attestations.number_saved_in_her_phone = false; p.attestations.saved_contact_photo = false;
    expect(attestationsMissing(p)).toEqual([]); p.attestations.recall_introduced_to_her = false; expect(attestationsMissing(p).length).toBeGreaterThan(0);
  });
  it("retries every pending caregiver handoff even when the first remains unavailable", async () => {
    const post = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubEnv("RECALL_SAFETY_WEBHOOKS", JSON.stringify({ first: { url: "https://first.example/handoff", token: "a".repeat(32) }, second: { url: "https://second.example/handoff", token: "b".repeat(32) } }));
    const channel = new DurableAlerts(folder(), "h", post); stores.push(channel);
    for (const caregiver of ["first", "second"]) await expect(channel.send({ alert_id: caregiver, script_id: "fixed", caregiver_id: caregiver, channel: "webhook", category: "fall", at: "2026-09-19T15:00:00Z", text: "Fixed handoff." })).rejects.toThrow();
    post.mockClear();
    post.mockImplementation(async (url) => new Response(null, { status: String(url).includes("first") ? 503 : 200 }));
    await expect(channel.retryPending()).rejects.toThrow();
    expect(post.mock.calls.map(([url]) => url)).toContain("https://second.example/handoff");
    post.mockClear();
    await expect(channel.retryPending()).rejects.toThrow();
    expect(post.mock.calls.map(([url]) => url)).toEqual(["https://first.example/handoff"]);
  });

  it("retries durable handoffs with the same idempotency key and does not send duplicates after success", async () => {
    const post = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValue(new Response(null));
    vi.stubEnv("RECALL_SAFETY_WEBHOOKS", JSON.stringify({ caregiver: { url: "https://caregiver.example/handoff", token: "a".repeat(32) } }));
    const dir = folder(), channel = new DurableAlerts(dir, "h", post); stores.push(channel);
    const alert = { alert_id: "a", script_id: "fixed", caregiver_id: "caregiver", channel: "webhook", category: "fall", at: "2026-09-19T15:00:00Z", text: "Fixed safety handoff." };
    await expect(channel.send(alert)).rejects.toThrow(); await channel.retryPending(); await channel.send(alert);
    expect(post).toHaveBeenCalledTimes(2); expect(post.mock.calls[0]?.[1].headers["Idempotency-Key"]).toBe(post.mock.calls[1]?.[1].headers["Idempotency-Key"]);
    expect(channel.sentTo("someone-else")).toEqual([]);
  });
});
