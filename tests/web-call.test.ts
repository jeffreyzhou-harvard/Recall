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
const folders: string[] = [], stores: Array<{ close(): void }> = [];
function folder() { const path = mkdtempSync(join(tmpdir(), "recall-web-")); folders.push(path); return path; }
afterEach(() => { for (const store of stores.splice(0)) store.close(); vi.unstubAllEnvs(); vi.useRealTimers(); for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true }); });
const audio = wavFromPcm(new Uint8Array(16000 * 2 * 3));
const words = (text: string) => text.split(" ").filter(Boolean).map((w, i) => ({ w, start_ms: i * 100, end_ms: i * 100 + 90 }));
async function rig(replies: string[] = []) {
  const root = folder(), graph = new SqliteGraphStore(join(root, "recall-graph.db"), "test"); stores.push(graph);
  const fixture = await buildFixtureRig({ graph });
  const media = new MediaStore(root, "test", fixture.assets, graph); stores.push(media);
  const transcript = new LiveTranscription();
  const recognition = vi.fn(async () => ({ transcript: "", words: words(replies.shift() ?? "") }));
  const driver = new WebCall("person:susan", media, transcript, fixture.graph, "standard", 8, recognition, async () => audio);
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
describe("live browser transport", () => {
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
  it("does not cancel a submitted final recording when hang-up arrives during transcription", async () => {
    const r = await rig();
    let finish!: (result: { transcript: string; words: ReturnType<typeof words> }) => void;
    r.recognition.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const service = new RecallService({ ...r, transcription: r.transcript, callDriver: () => r.driver, script: CALL_SCRIPT, copy: FAMILY_COPY, thresholds: RECORD_THRESHOLDS, safetyPhrases: SAFETY_PHRASES });
    const run = service.runScheduledCall("session:late-safety");
    await drive(r.driver, run, async (id) => { const receiving = r.driver.receive(id, audio); r.driver.stop(); finish({ transcript: "", words: words("I fell.") }); await receiving; });
    expect((await run)?.recording.final_state).toBe("safety_handoff"); expect(r.alerts.count()).toBeGreaterThan(0);
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
