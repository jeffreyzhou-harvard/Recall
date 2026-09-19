/**
 * AGENTS.md section 12.6: the judged path runs with the network disabled, and
 * replays identically. Telephony, ASR, model latency, and network access must
 * never touch it (section 9).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runJudgedPath } from "@/fixtures/harness";

const ROOT = join(import.meta.dirname, "..");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("judged path with the network disabled", () => {
  const touched: string[] = [];
  beforeEach(() => {
    touched.length = 0;
    const refuse = (what: string) => () => {
      touched.push(what);
      throw new Error(`network access attempted: ${what}`);
    };
    vi.stubGlobal("fetch", refuse("fetch"));
    vi.stubGlobal("WebSocket", refuse("WebSocket"));
    vi.stubGlobal("XMLHttpRequest", refuse("XMLHttpRequest"));
    vi.stubGlobal("EventSource", refuse("EventSource"));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("runs end to end - the call, then the whole family side - without attempting any network access", async () => {
    const run = await runJudgedPath();
    expect(run.recording.final_state).toBe("stored");
    await run.service.askAboutHer("What did Mom say about her wedding?", "person:maya");
    await run.service.weeklyNote("person:maya");
    await run.service.topicRecord("person:maya");
    await run.service.exportRecord("person:maya");
    expect(touched).toEqual([]);
  });

  it("replays byte-for-byte: same trace, same tool log, same hashes, same timestamps", async () => {
    // The recording is everything a run produced - trace, tool log, receipts, the sealed PROV chain - and then the family side's view of it.
    const snapshot = async (): Promise<string> => {
      const run = await runJudgedPath();
      return JSON.stringify([run.recording, await run.service.weeklyNote("person:maya"), await run.service.topicRecord("person:maya"), await run.graph.snapshot()]);
    };
    const [first, second] = [await snapshot(), await snapshot()];
    expect(second).toBe(first);
    expect(first).toContain("2026-11-05T15:3");
  });
});

describe("static determinism guard", () => {
  // A wall-clock read or a random number anywhere under /lib would make the judged path
  // unrepeatable. lib/clock.ts is the single sanctioned place the wall clock is read.
  const BANNED: Array<[RegExp, string]> = [
    [/\bDate\.now\s*\(/, "Date.now()"],
    [/\bnew Date\s*\(\s*\)/, "new Date() with no argument"],
    [/\bMath\.random\s*\(/, "Math.random()"],
    [/\bperformance\.now\s*\(/, "performance.now()"],
    [/\bcrypto\.randomUUID\s*\(/, "crypto.randomUUID()"],
  ];

  it("nothing under /lib reads the wall clock or a random source, except lib/clock.ts", () => {
    const offenders: string[] = [];
    for (const file of filesUnder(join(ROOT, "lib"))) {
      if (file.endsWith(join("lib", "clock.ts"))) continue;
      const source = readFileSync(file, "utf8");
      for (const [pattern, name] of BANNED) if (pattern.test(source)) offenders.push(`${file.slice(ROOT.length + 1)}: ${name}`);
    }
    expect(offenders).toEqual([]);
  });

  it("nothing under /lib imports a fixture or an asset: the product never depends on mock data", () => {
    const offenders = filesUnder(join(ROOT, "lib")).filter((f) => /from\s+"@\/(fixtures|assets|tests)/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });

  // Live-only code: the one place each external system is touched. Everything else under /lib is
  // judged-path safe, and must not reach these even indirectly.
  const LIVE_ONLY = [join("lib", "graph", "ladybug-store.ts"), join("lib", "onboarding", "sqlite-store.ts"), join("lib", "providers", "muse") + "/", join("lib", "providers", "deepgram.ts")];
  const isLiveOnly = (rel: string): boolean => LIVE_ONLY.some((p) => rel === p || rel.startsWith(p));
  const NETWORK = /\bfetch\s*\(|new WebSocket\s*\(|new XMLHttpRequest\s*\(|new EventSource\s*\(/;
  // The service composes both loops, so it names the discovery and call modules by type; it opens no connection itself.
  const LIVE_IMPORT = /@ladybugdb\/core|ladybug-store|node:sqlite|sqlite-store|providers\/muse|providers\/deepgram|@\/server\//;

  it("only two named files under /lib touch the network: Deepgram and Muse Spark - and neither can reach family", () => {
    const callers = filesUnder(join(ROOT, "lib"))
      .filter((f) => NETWORK.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(ROOT.length + 1))
      .sort();
    expect(callers).toEqual([join("lib", "providers", "deepgram.ts"), join("lib", "providers", "muse", "spark.ts")]);
  });

  it("nothing judged-path safe imports live-only code: not the rest of /lib, not the harness, not /present", () => {
    const judged = [...filesUnder(join(ROOT, "lib")), ...filesUnder(join(ROOT, "fixtures")), join(ROOT, "app", "present", "page.tsx"), join(ROOT, "app", "page.tsx")];
    const offenders = judged
      .map((f) => f.slice(ROOT.length + 1))
      .filter((rel) => !isLiveOnly(rel) && LIVE_IMPORT.test(readFileSync(join(ROOT, rel), "utf8")));
    expect(offenders).toEqual([]);
  });
});
