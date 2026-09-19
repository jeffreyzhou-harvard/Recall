/**
 * End-to-end check of the LIVE path, against the real services:
 *
 *   a turn of the schedule -> the joint setup grants the call -> a real WebRTC video call -> her audio to
 *   Deepgram -> the ladder climbs (free recall, context, association) -> her exact words captured ->
 *   played back to her -> her yes to remembering it, her yes to sharing it -> stored -> the family side
 *
 *   npm run build && npm run e2e:live      (macOS: uses `say` and Chrome; needs DEEPGRAM_API_KEY in .env.local)
 *
 * Her browser's microphone is fed a WAV of synthesized speech on a fixed timeline, so a whole
 * conversation really happens: Deepgram hears it, the orchestrator reacts, Relay's lines are spoken
 * on her page. The synthetic voice is test scaffolding only - generated here, into a temp directory,
 * never committed and never shipped. It costs a few cents of Deepgram credit per run.
 *
 * Not part of `npm run check`.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:3191";
const SECRET = "e2e-live-operator-secret-012345";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
const tmp = mkdtempSync(join(tmpdir(), "relay-live-"));

// --- her side of the conversation, on a fixed timeline (seconds from when she joins) ---------------------------
// Each line lands inside the 12 s Relay waits after it stops talking, whether her device's voice is quick or
// slow. A line that misses its window is not a bug in Relay - it hears silence, and ends the call kindly.
const RATE = 48_000;
const LINES = [
  [22, "Cape May?"],
  [34, "I'm not sure."],
  [46, "Maya, my daughter!"],
  [58, "We went to Cape May every summer."],
  [73, "Yes."],
  [86, "Yes."],
];
function pcmOf(text, i) {
  const file = join(tmp, `line-${i}.wav`);
  execFileSync("say", ["-o", file, `--data-format=LEI16@${RATE}`, text]);
  const wav = readFileSync(file);
  const at = wav.indexOf("data") + 8;
  return wav.subarray(at, at + wav.readUInt32LE(at - 4));
}
const total = 100 * RATE * 2;
const mic = Buffer.alloc(44 + total);
mic.write("RIFF", 0); mic.writeUInt32LE(36 + total, 4); mic.write("WAVEfmt ", 8); mic.writeUInt32LE(16, 16); mic.writeUInt16LE(1, 20); mic.writeUInt16LE(1, 22);
mic.writeUInt32LE(RATE, 24); mic.writeUInt32LE(RATE * 2, 28); mic.writeUInt16LE(2, 32); mic.writeUInt16LE(16, 34); mic.write("data", 36); mic.writeUInt32LE(total, 40);
LINES.forEach(([at, text], i) => pcmOf(text, i).copy(mic, 44 + at * RATE * 2));
const micFile = join(tmp, "her-mic.wav");
writeFileSync(micFile, mic);

// --- a joint setup that allows calls at any hour, so this can run at 3 a.m. It is the test's own file, git-ignored. ---
const policy = JSON.parse(readFileSync("fixtures/policy/susan-setup.json", "utf8"));
policy.call_windows = [{ days: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"], start: "00:00", end: "23:59" }];
// Which topic is due depends on today's date, so the test allows only the one her scripted lines are about.
policy.topics.allow = ["event:cape-may-summers"];
mkdirSync(".data", { recursive: true });
writeFileSync(".data/e2e-policy.json", JSON.stringify(policy));

if (await fetch(BASE).then(() => true).catch(() => false)) {
  console.error(`Something is already listening on ${BASE}. Stop it first:  lsof -ti tcp:3191 | xargs kill`);
  process.exit(2);
}
const log = openSync(".data/e2e-live-server.log", "w"); // timings and levels only; see RELAY_CALL_DEBUG
const server = spawn("npx", ["next", "start", "-p", "3191"], { stdio: ["ignore", log, log], detached: true, env: { ...process.env, RELAY_CALL: "video", RELAY_CALL_DEBUG: "1", RELAY_OPERATOR_SECRET: SECRET, RELAY_POLICY_FILE: ".data/e2e-policy.json" } });
for (let i = 0; i < 60 && !(await fetch(BASE).then((r) => r.ok).catch(() => false)); i++) await sleep(500);

async function browser(port, url, extra = []) {
  procs.push(spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--no-first-run", `--user-data-dir=${mkdtempSync(join(tmpdir(), "relay-chrome-"))}`, ...extra, url], { stdio: "ignore" }));
  let target;
  for (let i = 0; i < 100 && !target; i++) { await sleep(200); target = await fetch(`http://localhost:${port}/json`).then((r) => r.json()).then((t) => t.find((x) => x.type === "page" && x.url.startsWith(BASE))).catch(() => null); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data); pending.get(d.id)?.(d.result); pending.delete(d.id);
    if (d.method === "Runtime.exceptionThrown") errors.push((d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 200));
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push(d.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 200));
  };
  const evaluate = (expression) => new Promise((resolve) => { const n = ++id; pending.set(n, (r) => resolve(r?.result?.value)); ws.send(JSON.stringify({ id: n, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } })); });
  await new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method: "Runtime.enable" })); });
  const until = async (expression, want, ms = 40000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await evaluate(expression); if (want(v)) return v; await sleep(300); } return v; };
  return { evaluate, until, errors };
}

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`); };

try {
  const host = await browser(9341, `${BASE}/call/host?operator=${SECRET}`);
  await host.until("!!document.querySelector('[data-testid=waiting]')", Boolean);

  // One turn of the schedule. Nobody asks for this call: the graph, the joint setup, and the clock decide it.
  // The request stays open until the call has ended.
  const operator = { "content-type": "application/json", "x-relay-operator": SECRET };
  const session = fetch(`${BASE}/api/live/schedule`, { method: "POST", headers: operator }).then((r) => r.json());

  const link = await host.until("document.querySelector('[data-testid=participant-link]')?.href", Boolean);
  check("the joint setup granted the call, and Relay's page joined it", !!link);
  // Chrome's audio service is sandboxed and cannot read the mic file on macOS - it plays silence instead, without a word.
  const her = await browser(9342, link, [`--use-file-for-fake-audio-capture=${micFile}%noloop`, "--disable-features=AudioServiceSandbox"]);
  // Tap Join once the button is live. Before hydration the page has no state to read, and a tap would be lost.
  await her.until("(()=>{const b=document.querySelector('button');return !!b&&Object.keys(b).some(k=>k.startsWith('__reactProps'))})()", Boolean);
  await her.evaluate("document.querySelector('button')?.click()");
  const herState = await her.until("document.querySelector('main')?.dataset.callState", (s) => s === "connected");
  check("the two browsers connected", herState === "connected", herState);
  if (herState !== "connected") {
    const probe = "(async()=>{const p=window.__relayCall;if(!p)return 'no peer on this page';const s=[...(await p.pc.getStats()).values()];return JSON.stringify({call:p.callState,conn:p.pc.connectionState,ice:p.pc.iceConnectionState,signaling:p.pc.signalingState,local:s.filter(x=>x.type==='local-candidate').length,remote:s.filter(x=>x.type==='remote-candidate').length})})()";
    console.log("      her page:  ", await her.evaluate("document.querySelector('main')?.innerText.slice(0,120)"), "|", await her.evaluate(probe));
    console.log("      her errors:", JSON.stringify(her.errors), "| buttons:", await her.evaluate("document.querySelectorAll('button').length"), "| hash:", await her.evaluate("location.hash.length"));
    console.log("      relay errors:", JSON.stringify(host.errors));
    console.log("      relay page:", await host.evaluate("document.querySelector('main')?.dataset.callState"), "|", await host.evaluate(probe), "|", await host.evaluate("[...document.querySelectorAll('p')].at(-1)?.textContent"));
  }

  const line = await her.until("document.querySelector('[data-testid=relay-line]')?.textContent", Boolean);
  check("Relay's first line on her page says it is an AI assistant, labeled as Relay", /^Relay/.test(line ?? "") && /I'm Relay, an AI assistant Maya set up/.test(line ?? ""), line);

  const { recording: r } = await session;
  writeFileSync(".data/e2e-live-recording.json", JSON.stringify(r, null, 2)); // git-ignored; synthetic speech only
  check("the call ended with her words stored", r?.final_state === "stored", `${r?.final_state}${r?.trace ? "  via " + [...new Set(r.trace.filter((t) => t.accepted).map((t) => t.to))].join(" > ") : ""}`);
  const spoken = (r?.spoken ?? []).map((s) => s.text);
  check("Relay said its reviewed lines, in order, climbing one rung at a time", spoken.join(" | ") === "Hi Susan, I'm Relay, an AI assistant Maya set up to keep you company. | I'd love to hear about the summers at Cape May. What comes to mind? | It's a place your family went together. | You and Maya used to go there together. | What do you remember about those summers? | Want me to remember that? | Would you like me to share it with your family? | Thank you, Susan. It was lovely talking with you. Goodbye for now.", spoken.join(" | "));
  const rungs = (r?.tool_log ?? []).filter((c) => c.tool === "select_scaffold").map((c) => c.output?.rung);
  check("the ladder stopped the moment she reached it", rungs.join(",") === "1,2,3", rungs.join(","));
  const p = r?.provenance_receipt;
  check("Deepgram heard her, and her own words were stored", /cape may/i.test(p?.literal_transcript ?? "") && /summer/i.test(p?.literal_transcript ?? ""), JSON.stringify(p?.literal_transcript));
  check("no words were generated; both confirmations are on the receipt", p?.edits?.generated_first_person_words === 0 && p?.share_confirmation?.decision === "yes" && !!p?.store_confirmation?.recorded_at, JSON.stringify({ edits: p?.edits, share: p?.share_confirmation?.decision }));

  const ask = await fetch(`${BASE}/api/family/ask`, { method: "POST", headers: operator, body: JSON.stringify({ question: "What did Mom say about her wedding?", member: "person:maya" }) }).then((x) => x.json());
  check("the family's question gets the redirect line, and no graph content", ask?.line?.text === "Susan's talked about this before. Want to give her a call?" && ask?.graph_content?.length === 0, JSON.stringify(ask));
  const dash = await fetch(`${BASE}/api/family/dashboard?member=person:maya`, { headers: operator }).then((x) => x.json());
  const kinds = (dash?.weekly_note?.note?.lines ?? []).map((l) => l.kind);
  check("the Weekly Note carries the line she chose to share, and nothing was sent to anyone", kinds.includes("warm") && kinds.includes("share") && (dash?.safety_alerts ?? []).length === 0, JSON.stringify(kinds));
} catch (e) {
  check("ran without error", false, String(e));
} finally {
  for (const p of procs) p.kill("SIGKILL");
  try { process.kill(-server.pid, "SIGKILL"); } catch { /* already gone */ }
}
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
