/** Runs against a production build with a temporary, isolated database. Never writes the user's household. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
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
async function start(member) {
  child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env: { ...process.env, NODE_ENV: "production", RECALL_DATA_DIR: dir, RECALL_ONBOARDING_DB: join(dir, "onboarding.db"), RECALL_HOUSEHOLD: "", RECALL_POLICY_FILE: "", RECALL_CALL: "none", RECALL_OPERATOR_SECRET: operator, RECALL_FAMILY_SECRET: "", RECALL_FAMILY_CREDENTIALS: JSON.stringify(member ? { [member]: family } : {}), MUSE_API_KEY: "" }, stdio: ["ignore", "pipe", "pipe"] });
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
  await start();
  for (const path of ["/", "/caregiver", "/onboarding", "/revisit"]) assert.equal((await fetch(base + path)).status, 200);
  assert.equal((await json(await request("/api/call/status"))).status, "unavailable");
  assert.equal((await request("/api/family/dashboard?member=unknown", undefined, {})).status, 403);
  const made = await json(await request("/api/onboarding/households", { participant: { display_name: "HTTP test participant", phone: "+16095550123" }, caregiver: { display_name: "HTTP test caregiver" } }), 201);
  const hid = made.household.household_id, member = made.caregiver_id;
  const prefs = { days: ["mon"], start: "09:00", end: "12:00", timezone: "America/New_York", max_minutes: 8, max_calls_per_week: 1, min_hours_between_calls: 24, pace: "standard", emergency_number: "911", saved_contact_name: "Recall", number_saved: false, photo_saved: false, introduced: false, dashboard: "weekly_note_and_record", patient_agreed: true, caregiver_agreed: true, expected_version: 0 };
  assert.equal((await request(`/api/onboarding/households/${hid}/preferences`, { ...prefs, patient_agreed: false })).status, 400);
  const saved = await json(await request(`/api/onboarding/households/${hid}/preferences`, prefs));
  assert.equal(saved.document.calls_paused, true);
  await json(await request("/api/onboarding/activate", { household_id: hid }));
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
  const csrf = await fetch(base + "/api/family/memory", { method: "POST", headers: { cookie, origin: "https://other.test", "Content-Type": "application/json" }, body: JSON.stringify({ member, who: "x", what_happened: "Must not save." }) });
  assert.equal(csrf.status, 403);
  const exported = await request("/api/family/export", { member }, { cookie });
  assert.equal(exported.status, 200); assert.doesNotMatch(await exported.text(), /tulips|Susan|Maya/);
  const current = await json(await request(`/api/onboarding/households/${hid}`));
  const doc = current.setup.document; doc.dashboard.grants[0].revoked_at = new Date().toISOString();
  await json(await request(`/api/onboarding/households/${hid}/setup`, { kind: "tightening", document: doc, by: member }), 201);
  dashboard = await json(await request(`/api/family/dashboard?member=${member}`, undefined, { cookie }));
  assert.equal(dashboard.weekly_note.status, "no_access"); assert.equal(dashboard.topic_record.status, "no_access");
  assert.equal((await request("/api/family/export", { member }, { cookie })).status, 403);
  console.log("Live HTTP verification passed: setup, consent, persistence across restart, sessions, member isolation, CSRF, export and revocation.");
} catch (error) { console.error(error); process.exitCode = 1; }
finally { await stop(); rmSync(dir, { recursive: true, force: true }); }
