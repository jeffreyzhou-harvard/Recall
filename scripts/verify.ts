/**
 * Provenance verification. Run after any change to /assets or /fixtures, and
 * always after replacing a hashed asset (AGENTS.md section 13).
 *
 *   npm run verify          # development: placeholders allowed, loudly
 *   npm run verify:strict   # pre-demo: fails while any placeholder remains
 *
 * Checks, in order:
 *   1. every asset on disk still matches its manifest hash
 *   2. the family seed validates, and every citation in it resolves
 *   3. the call transcript fits inside its recording
 *   4. the judged path delivers, the family gets exactly the right messages,
 *      and the authorship invariants hold on what was sent
 *   5. (strict) no placeholder media, no placeholder timings
 *
 * The failure branches are covered by `npm test`, not here.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { FAMILY_SEED, GOLDEN_TRANSCRIPT, MANIFEST } from "@/fixtures";
import { runJudgedPath } from "@/fixtures/harness";
import { buildGraph } from "@/lib/graph/seed";
import { AssetIndex } from "@/lib/provenance/assets";
import { generatedFirstPersonWords } from "@/lib/provenance/authorship";
import { ROOT, sha256File } from "./lib/asset-tools";

const strict = process.argv.includes("--strict");
const failures: string[] = [];
const warnings: string[] = [];
const ok = (msg: string): void => console.log(`  ok    ${msg}`);
const fail = (msg: string): void => {
  failures.push(msg);
  console.log(`  FAIL  ${msg}`);
};
const attempt = async (what: string, fn: () => Promise<void> | void): Promise<void> => {
  try {
    await fn();
  } catch (e) {
    fail(`${what}: ${(e as Error).message}`);
  }
};

console.log("1. assets match the manifest");
const assets = new AssetIndex(MANIFEST);
for (const asset of assets.all()) {
  const abs = join(ROOT, asset.path);
  if (!existsSync(abs)) fail(`${asset.id}: missing file ${asset.path}`);
  else if (sha256File(abs).sha256 !== asset.sha256) fail(`${asset.id}: bytes on disk do not match the manifest hash (run assets:hash, then verify again)`);
  else ok(`${asset.id} ${asset.sha256.slice(0, 12)} [${asset.status}]`);
}

console.log("\n2. the family seed validates and every citation resolves");
await attempt("family seed", () => {
  const data = buildGraph(FAMILY_SEED, assets);
  const cited = [...data.nodes, ...data.edges].filter((x) => x.prov.asset_id !== null).length;
  ok(`${data.nodes.length} nodes, ${data.edges.length} edges, ${cited} media citations resolved`);
});

console.log("\n3. the call transcript fits inside its recording");
await attempt("call transcript", () => {
  let last = 0;
  for (const turn of GOLDEN_TRANSCRIPT.turns) {
    assets.resolveSpan(GOLDEN_TRANSCRIPT.asset_id, { start_ms: turn.start_ms, end_ms: turn.end_ms });
    if (turn.start_ms < last) throw new Error(`turn ${turn.turn_id} overlaps the turn before it`);
    for (const w of turn.words) {
      if (w.start_ms < turn.start_ms || w.end_ms > turn.end_ms) throw new Error(`word "${w.w}" lies outside turn ${turn.turn_id}`);
    }
    last = turn.end_ms;
  }
  ok(`${GOLDEN_TRANSCRIPT.turns.length} turns within ${GOLDEN_TRANSCRIPT.asset_id} [timings ${GOLDEN_TRANSCRIPT.timing_status}]`);
});

console.log("\n4. the judged path stores her words, authorship holds, and nothing leaks to the family side");
await attempt("judged path", async () => {
  const run = await runJudgedPath();
  const { recording } = run;
  if (recording.final_state !== "stored") throw new Error(`ended in "${recording.final_state}", expected "stored"`);
  const rejected = recording.trace.filter((t) => !t.accepted);
  if (rejected.length > 0) throw new Error(`${rejected.length} event(s) were rejected by the reducer`);

  if (run.alerts.count() !== 0) throw new Error("something was sent to family on the golden path; only a safety alert ever may be");
  if (!recording.spoken[0]?.text.includes("an AI assistant")) throw new Error("the first line of the call does not say Relay is an AI assistant (rule 16)");
  const redirect = await run.service.askAboutHer("What did Mom say about her wedding?", "person:maya");
  if (redirect.line.script_id !== "FAMILY-REDIRECT" || redirect.graph_content.length !== 0) throw new Error("the family-redirect path returned something other than the fixed line");
  const c = run.ctx.session.contribution!;
  const generated = generatedFirstPersonWords(c.words, await run.ctx.transcription.allTurns(c.source.asset_id));
  if (generated !== 0) throw new Error(`${generated} generated first-person word(s) in the outbound artifact`);
  const rungs = recording.spoken.filter((s) => s.rung !== null).length;
  ok(`stored: ${rungs} ladder rung(s) used, ${c.silence_trims} silence trim(s), 0 generated words, ${recording.spoken.length} lines spoken, ${recording.tool_log.length} tool calls, 0 sent to family`);
});

console.log(`\n5. demo readiness${strict ? " (strict)" : ""}`);
const notReady = [
  ...assets.placeholders().map((a) => `placeholder media: ${a.id} (${a.path})`),
  ...(GOLDEN_TRANSCRIPT.timing_status === "placeholder" ? ["placeholder word timings in the call transcript"] : []),
];
for (const item of notReady) (strict ? fail : (m: string) => (warnings.push(m), console.log(`  warn  ${m}`)))(item);
if (notReady.length === 0) ok("no placeholder media or timings on the judged path");

console.log("");
if (failures.length > 0) {
  console.error(`verify FAILED: ${failures.length} problem(s).`);
  process.exit(1);
}
console.log(`verify passed${warnings.length > 0 ? ` with ${warnings.length} warning(s): NOT demo-ready until \`npm run verify:strict\` passes` : ""}.`);
