/** Runs against a production build with a temporary, isolated database. Never writes the user's household. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
const dir = mkdtempSync(join(tmpdir(), "recall-http-"));
const listener = createServer();
await new Promise((r) => listener.listen(0, "127.0.0.1", r));
const port = listener.address().port;
await new Promise((r) => listener.close(r));
const base = `http://localhost:${port}`;
const operator = randomBytes(32).toString("hex"), family = randomBytes(32).toString("hex");
let child, logs = "";
async function start(member, blank = false) {
  child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env: { ...process.env, NODE_ENV: "production", RECALL_DATA_DIR: dir, RECALL_ONBOARDING_DB: join(dir, "onboarding.db"), RECALL_HOUSEHOLD: "", RECALL_POLICY_FILE: "", RECALL_CALL: "none", RECALL_SCHEDULER: "0", DEEPGRAM_API_KEY: "", RECALL_SAFETY_WEBHOOKS: "{}", RECALL_OPERATOR_SECRET: blank ? "" : operator, RECALL_FAMILY_SECRET: "", RECALL_FAMILY_CREDENTIALS: JSON.stringify(member ? { [member]: family } : {}), MUSE_API_KEY: "" }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => { logs += chunk; }); child.stderr.on("data", (chunk) => { logs += chunk; });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error("Test server exited unexpectedly");
    try { if ((await fetch(base + "/api/session")).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Test server did not start");
}
async function stop() { if (!child || child.exitCode !== null) return; const done = new Promise((r) => child.once("exit", r)); child.kill("SIGTERM"); await done; }
async function request(path, body, headers = { "x-recall-operator": operator }) {
  return fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: { origin: base, "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function json(response, expected = 200) { const text = await response.text(); assert.equal(response.status, expected, text); return JSON.parse(text); }
try {
  await start(undefined, true);
  for (const path of ["/", "/caregiver", "/onboarding", "/revisit", "/join", "/onboarding/manage"]) assert.equal((await fetch(base + path)).status, 200);
  assert.equal((await request("/api/family/dashboard?member=unknown", undefined, {})).status, 403);
  assert.equal((await json(await request("/api/session", undefined, {}))).first_setup_available, true);
  const firstInput = { participant: { display_name: "HTTP test participant", phone: "+16095550123" }, caregiver: { display_name: "HTTP test caregiver" } };
  assert.equal((await request("/api/onboarding/start", firstInput, { origin: "https://another.test" })).status, 403);
  const first = await request("/api/onboarding/start", firstInput, {});
  const made = await json(first, 201), ownerCookie = first.headers.get("set-cookie").split(";")[0], ownerHeaders = { cookie: ownerCookie };
  assert.equal(made.key, undefined);
  assert.equal((await request("/api/onboarding/start", firstInput, {})).status, 409);
  assert.equal((await request("/api/session", { local: true }, {})).status, 403);
  assert.equal((await request("/api/live/schedule", {}, ownerHeaders)).status, 403);
  assert.equal((await request("/api/onboarding/households/household:other", undefined, ownerHeaders)).status, 403);
  assert.equal((await request("/api/onboarding/households/household:other/preferences", {}, ownerHeaders)).status, 403);
  assert.equal((await json(await request("/api/session", undefined, ownerHeaders))).can_manage_setup, true);
  const hid = made.household.household_id, member = made.caregiver_id;
  const prefs = { days: ["mon"], start: "09:00", end: "12:00", timezone: "America/New_York", max_minutes: 8, max_calls_per_week: 1, min_hours_between_calls: 24, pace: "standard", emergency_number: "911", saved_contact_name: "Recall", number_saved: false, photo_saved: false, introduced: false, dashboard: "weekly_note_and_record", patient_agreed: true, caregiver_agreed: true, expected_version: 0 };
  assert.equal((await request(`/api/onboarding/households/${hid}/preferences`, { ...prefs, patient_agreed: false }, ownerHeaders)).status, 400);
  const saved = await json(await request(`/api/onboarding/households/${hid}/preferences`, prefs, ownerHeaders));
  assert.equal(saved.document.calls_paused, true);
  await json(await request("/api/onboarding/activate", { household_id: hid }, ownerHeaders));
  assert.equal((await request(`/api/onboarding/households/${hid}/invitations`, { display_name: "Cannot impersonate", role: "family", invited_by: made.participant_id }, ownerHeaders)).status, 403);
  await stop(); await start();
  assert.equal((await json(await request("/api/session", undefined, ownerHeaders))).can_manage_setup, true);
  assert.equal((await json(await request("/api/call/status"))).status, "unavailable");
  let dashboard = await json(await request(`/api/family/dashboard?member=${member}`));
  assert.equal(dashboard.info.sessions.length, 0); assert.equal(dashboard.info.contributions.length, 0);
  await json(await request("/api/family/memory", { member, who: "Our family", what_happened: "We planted tulips together." }));
  await stop(); await start(member);
  const login = await request("/api/session", { key: family }, {});
  assert.equal(login.status, 200); const cookie = login.headers.get("set-cookie").split(";")[0];
  dashboard = await json(await request(`/api/family/dashboard?member=${member}`, undefined, { cookie }));
  assert.deepEqual(dashboard.info.contributions.map((c) => c.text), ["We planted tulips together."]);
  assert.equal(dashboard.info.sessions.length, 0);
  assert.doesNotMatch(JSON.stringify(dashboard), /Susan|Maya|Cape May/);
  assert.equal((await request("/api/family/dashboard?member=another-member", undefined, { cookie })).status, 403);
  assert.equal((await request("/api/live/schedule", {}, { cookie })).status, 403);
  assert.equal((await request("/api/family/knowledge?member=another-member", undefined, { cookie })).status, 403);
  assert.equal((await request("/api/onboarding/knowledge", undefined, { cookie })).status, 200);
  assert.equal((await request("/api/onboarding/knowledge", undefined, {})).status, 403);
  assert.equal((await request(`/api/onboarding/households/${hid}`, undefined, {})).status, 403);
  assert.equal((await request("/api/onboarding/start", firstInput, {})).status, 403);
  assert.deepEqual(await json(await request(`/api/family/knowledge?member=${member}`, undefined, { cookie })), []);
  const csrf = await fetch(base + "/api/family/memory", { method: "POST", headers: { cookie, origin: "https://other.test", "Content-Type": "application/json" }, body: JSON.stringify({ member, who: "x", what_happened: "Must not save." }) });
  assert.equal(csrf.status, 403);
  const exported = await request("/api/family/export", { member }, { cookie });
  assert.equal(exported.status, 200); assert.doesNotMatch(await exported.text(), /tulips|Susan|Maya/);
  const invitation = await json(await request(`/api/onboarding/households/${hid}/invitations`, { display_name: "Invited relative", role: "family", invited_by: member }), 201);
  const joined = await json(await request("/api/onboarding/invitations/accept", { token: invitation.token }, {}), 201);
  assert.equal((await request("/api/onboarding/invitations/accept", { token: invitation.token }, {})).status, 404);
  const relativeLogin = await request("/api/session", { key: joined.key }, {});
  assert.equal(relativeLogin.status, 200); const relativeCookie = relativeLogin.headers.get("set-cookie").split(";")[0];
  assert.equal((await request(`/api/family/dashboard?member=${joined.person_id}`, undefined, { cookie: relativeCookie })).status, 403);
  assert.equal((await request("/api/onboarding/knowledge", undefined, { cookie: relativeCookie })).status, 403);
  assert.equal((await request(`/api/onboarding/households/${hid}`, undefined, { cookie: relativeCookie })).status, 403);
  const topic = await json(await request("/api/onboarding/topics", { contributor_id: member, label: "planting tulips", story: "We planted tulips together." }), 201);
  const importBody = { request_id: randomUUID(), contributor_id: member, reviewed: true, items: [{ kind: "calendar", label: "a family gathering", text: "Family gathering in the garden.", date: "2020-07-14", place: "garden" }] };
  const imported = await json(await request("/api/onboarding/knowledge", importBody), 201);
  assert.equal(imported.imported, 1);
  assert.deepEqual(await json(await request("/api/onboarding/knowledge", importBody), 201), imported);
  assert.deepEqual(await json(await request("/api/onboarding/knowledge", importBody, { cookie }), 201), imported);
  assert.equal((await request("/api/onboarding/knowledge", importBody, { cookie: relativeCookie })).status, 403);
  assert.equal((await request("/api/onboarding/knowledge", { ...importBody, request_id: randomUUID(), reviewed: false })).status, 400);
  const importedTopics = await json(await request("/api/onboarding/topics"));
  assert.ok(importedTopics.some((t) => t.id === imported.topics[0].id));
  const choices = { expected_version: saved.version, patient_agreed: true, caregiver_agreed: true, members: [{ id: member, approved: true, detail: "weekly_note_and_record" }, { id: joined.person_id, approved: true, detail: "weekly_note" }], topics: [topic.id], web_calls_enabled: false, alert_channel: "dashboard" };
  await json(await request(`/api/onboarding/households/${hid}/choices`, choices));
  assert.equal((await request(`/api/onboarding/households/${hid}/choices`, choices)).status, 409);
  assert.equal((await request(`/api/family/dashboard?member=${joined.person_id}`, undefined, { cookie: relativeCookie })).status, 200);
  assert.equal((await request("/api/family/pause", {}, { cookie: relativeCookie })).status, 403);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhfcAAAAASUVORK5CYII=", "base64");
  const uploaded = await json(await fetch(base + `/api/family/media?member=${joined.person_id}`, { method: "POST", headers: { cookie: relativeCookie, origin: base, "Content-Type": "image/png" }, body: png }));
  await json(await request("/api/family/memory", { member: joined.person_id, who: "Our family", what_happened: "We planted daffodils.", asset_id: uploaded.asset_id, about_topic_id: topic.id }, { cookie: relativeCookie }));
  const own = await json(await request(`/api/family/dashboard?member=${joined.person_id}`, undefined, { cookie: relativeCookie }));
  assert.equal(own.info.contributions[0].media.kind, "photo");
  const photoPath = `/api/family/media?member=${joined.person_id}&asset=${uploaded.asset_id}`;
  assert.equal((await request(photoPath, undefined, { cookie: relativeCookie })).status, 200);
  assert.equal((await request(photoPath, undefined, { cookie })).status, 403);
  assert.equal((await request(`/api/family/media?member=${member}&asset=${uploaded.asset_id}`, undefined, { cookie })).status, 404);
  const patientKey = await json(await request(`/api/onboarding/households/${hid}/accounts`, { member_id: made.participant_id }));
  const patientLogin = await request("/api/session", { key: patientKey.key }, {});
  assert.equal(patientLogin.status, 200); const patientCookie = patientLogin.headers.get("set-cookie").split(";")[0];
  assert.equal((await request(`/api/family/dashboard?member=${member}`, undefined, { cookie: patientCookie })).status, 403);
  assert.equal((await request("/api/call/action?action=ack", {}, { cookie })).status, 403);
  assert.equal((await json(await request("/api/call/status", undefined, { cookie: patientCookie }))).status, "waiting");
  const current = await json(await request(`/api/onboarding/households/${hid}`));
  const doc = current.setup.document; doc.dashboard.grants = doc.dashboard.grants.map((g) => g.member_id === member && !g.revoked_at ? { ...g, revoked_at: new Date().toISOString() } : g);
  await json(await request(`/api/onboarding/households/${hid}/setup`, { kind: "tightening", document: doc, by: member }), 201);
  dashboard = await json(await request(`/api/family/dashboard?member=${member}`, undefined, { cookie }));
  assert.equal(dashboard.weekly_note.status, "no_access"); assert.equal(dashboard.topic_record.status, "no_access");
  assert.equal((await request("/api/family/export", { member }, { cookie })).status, 403);
  console.log("Live HTTP verification passed: code-free initial setup, scoped caregiver sessions, setup, consent, persistence across restart, sessions, member isolation, CSRF, export, invitations, topic approval, selected graph imports, patient isolation and revocation.");
} catch (error) { console.error(error); process.exitCode = 1; }
finally { await stop(); rmSync(dir, { recursive: true, force: true }); }
