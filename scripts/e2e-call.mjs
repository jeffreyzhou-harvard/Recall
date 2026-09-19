/**
 * End-to-end check of the live video call: two real headless Chromes with a synthetic camera and
 * microphone make one real WebRTC call through this app, driven over the DevTools protocol.
 *
 *   npm run build && npm run e2e:call
 *
 * Not part of `npm run check`: it needs Chrome and a production build. It is the only thing that
 * proves the live path actually connects - the unit tests use a fake RTCPeerConnection.
 * Set CHROME_PATH if Chrome is not in the default macOS location.
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:3190";
const SECRET = "e2e-operator-secret-0123456789";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];

// Refuse to run against a server that is already there: it may be a stale one, with a different build or
// secret, and every check below would then be testing the wrong thing.
if (await fetch(BASE).then(() => true).catch(() => false)) {
  console.error(`Something is already listening on ${BASE}. Stop it first:  lsof -ti tcp:3190 | xargs kill`);
  process.exit(2);
}
// Its own production server, with an operator secret, so the "only Relay can start a call" rule is exercised too.
// Detached, so the whole process group - including the next-server child - can be stopped at the end.
const server = spawn("npx", ["next", "start", "-p", "3190"], { stdio: "ignore", detached: true, env: { ...process.env, RELAY_OPERATOR_SECRET: SECRET } });
for (let i = 0; i < 60; i++) {
  if (await fetch(BASE).then((r) => r.ok).catch(() => false)) break;
  await sleep(500);
}

async function browser(port, url) {
  const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--no-first-run", `--user-data-dir=${mkdtempSync(join(tmpdir(), "relay-e2e-"))}`, url], { stdio: "ignore" });
  procs.push(proc);
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    target = await fetch(`http://localhost:${port}/json`).then((r) => r.json()).then((t) => t.find((x) => x.type === "page" && x.url.startsWith(BASE))).catch(() => null);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); } };
  const evaluate = (expression) => new Promise((resolve) => { const n = ++id; pending.set(n, (r) => resolve(r?.result?.value)); ws.send(JSON.stringify({ id: n, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } })); });
  const until = async (expression, want, ms = 25000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await evaluate(expression); if (want(v)) return v; await sleep(250); } return v; };
  // A click before React has hydrated does nothing, so keep clicking until it visibly took effect.
  const clickUntil = async (click, expression, want) => { for (let i = 0; i < 40; i++) { await evaluate(click); await sleep(300); const v = await evaluate(expression); if (want(v)) return v; } return undefined; };
  return { evaluate, until, clickUntil };
}
const state = "document.querySelector('main')?.dataset.callState";
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`); };

try {
  const host = await browser(9301, `${BASE}/call/host?operator=${SECRET}`);
  const link = await host.clickUntil("document.querySelector('button')?.click()", "document.querySelector('[data-testid=participant-link]')?.href", Boolean);
  check("Relay started a room and got her one-time link", !!link, link?.replace(/#.*/, "#<token>"));

  const her = await browser(9302, link);
  await her.until("!!document.querySelector('button')", Boolean);
  check("her page asks for one thing", (await her.evaluate("document.querySelectorAll('button').length")) === 1, await her.evaluate("document.querySelector('button').textContent"));
  await her.clickUntil("document.querySelector('button')?.click()", state, (v) => v !== "ready");

  const hostState = await host.until(state, (s) => s === "connected");
  const herState = await her.until(state, (s) => s === "connected");
  check("both browsers reached a live peer-to-peer connection", hostState === "connected" && herState === "connected", `relay=${hostState} her=${herState}`);
  if (hostState !== "connected" || herState !== "connected") {
    const probe = "(async()=>{const p=window.__relayCall;if(!p)return'no peer';const s=[...(await p.pc.getStats()).values()];return JSON.stringify({conn:p.pc.connectionState,ice:p.pc.iceConnectionState,gathering:p.pc.iceGatheringState,signaling:p.pc.signalingState,local:s.filter(x=>x.type==='local-candidate').length,remote:s.filter(x=>x.type==='remote-candidate').length,pairs:s.filter(x=>x.type==='candidate-pair').map(x=>x.state).join(',')})})()";
    console.log("      relay:", await host.evaluate(probe));
    console.log("      her:  ", await her.evaluate(probe));
  }
  check("she sees plain words, not a technical state", (await her.evaluate("document.querySelector('[role=status]')?.textContent")) === "You're connected.");

  const width = await host.until("document.querySelector('video')?.videoWidth", (w) => w > 0);
  check("Relay is receiving her video", width > 0, `${width}px wide`);
  await sleep(2500);
  const held = await host.evaluate("document.querySelector('p.font-mono')?.textContent");
  const seconds = Number(/memory: ([\d.]+)s/.exec(held ?? "")?.[1] ?? 0);
  check("her audio is being captured (in memory only)", seconds > 0.5, `${seconds}s`);

  await host.evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Hang up')).click()");
  const ended = await her.until(state, (s) => s === "ended");
  check("hanging up ended the call on her side too", ended === "ended", await her.evaluate("document.querySelector('[role=status]')?.textContent"));
  const note = await host.until("[...document.querySelectorAll('p')].map(p => p.textContent).find(t => t.includes('nothing was kept'))", Boolean);
  check("nothing approved, so nothing kept (rule 8)", /\(0 bytes\)/.test(note ?? ""), note);

  const again = await browser(9303, link);
  await again.clickUntil("document.querySelector('button')?.click()", state, (v) => v !== "ready");
  const reuse = await again.until(state, (s) => s === "invalid");
  check("the link cannot be used a second time", reuse === "invalid", await again.evaluate("document.querySelector('main p')?.textContent"));
} catch (e) {
  check("ran without error", false, String(e));
} finally {
  for (const p of procs) p.kill("SIGKILL");
  try {
    process.kill(-server.pid, "SIGKILL");
  } catch {
    // already gone
  }
}
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
