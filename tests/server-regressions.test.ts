import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFixtureRig } from "@/fixtures/harness";
import { createLiveRecall, getLiveRecall } from "@/server/recall-live";
import { isFamily, isOperator } from "@/server/operator";
import { GET as dashboard } from "@/app/api/family/dashboard/route";
import { POST as memory } from "@/app/api/family/memory/route";
import { POST as ask } from "@/app/api/family/ask/route";
import { ToolRuntime, TOOL_IMPLS } from "@/lib/tools";
import { bench } from "./helpers";

vi.mock("@/server/recall-live", async (original) => ({
  ...await original<typeof import("@/server/recall-live")>(),
  getLiveRecall: vi.fn(),
}));
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.clearAllMocks(); });

function credentials() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("RECALL_OPERATOR_SECRET", "operator-key");
  vi.stubEnv("RECALL_FAMILY_SECRET", "");
  vi.stubEnv("RECALL_FAMILY_CREDENTIALS", JSON.stringify({ "person:maya": "maya-key", "person:priya": "priya-key" }));
}
const request = (member: string, key = "maya-key") => new Request(`http://recall.test/api/family/dashboard?member=${encodeURIComponent(member)}`, { headers: { "x-recall-family": key } });

describe("member-bound route access (§2 rules 5, 14, 15)", () => {
  it("rejects impersonation before loading any family data, including caregiver alerts", async () => {
    credentials();
    expect((await dashboard(request("person:maya", "priya-key"))).status).toBe(403);
    for (const route of [memory, ask]) {
      const req = new Request("http://recall.test/api/family", { method: "POST", headers: { "x-recall-family": "priya-key", "content-type": "application/json" }, body: JSON.stringify({ member: "person:maya", question: "How is she?", what_happened: "We went to the beach." }) });
      expect((await route(req)).status).toBe(403);
    }
    expect(getLiveRecall).not.toHaveBeenCalled();
  });

  it("serves the credential owner and enforces revocation on their next request", async () => {
    credentials();
    const rig = await buildFixtureRig();
    vi.mocked(getLiveRecall).mockResolvedValue({ ...rig, callMode: "none", refreshSetup: async () => {}, tick: async () => null });
    const first = await dashboard(request("person:maya"));
    expect(first.status).toBe(200);
    expect((await first.json()).topic_record.status).not.toBe("no_access");
    rig.setup.revokeDashboardAccess("person:maya", rig.clock.iso());
    const next = await (await dashboard(request("person:maya"))).json();
    expect(next.weekly_note.status).toBe("no_access");
    expect(next.topic_record.status).toBe("no_access");
    expect((await dashboard(request("person:priya"))).status).toBe(403);
  });

  it.each([
    '{"person:maya":"operator-key"}',
    '{"person:maya":"duplicate","person:priya":"duplicate"}',
    'not-json',
    '{"person:maya":""}',
  ])("fails closed for invalid credentials: %s", (value) => {
    credentials();
    vi.stubEnv("RECALL_FAMILY_CREDENTIALS", value);
    const req = new Request("http://recall.test", { headers: { "x-recall-operator": "operator-key", "x-recall-family": "operator-key" } });
    expect(isOperator(req)).toBe(false);
    expect(isFamily(req, "person:maya")).toBe(false);
  });

  it("rejects the old shared-key configuration through either header", () => {
    credentials();
    vi.stubEnv("RECALL_FAMILY_SECRET", "operator-key");
    const req = new Request("http://recall.test", { headers: { "x-recall-operator": "operator-key" } });
    expect(isFamily(req)).toBe(false);
    expect(isOperator(req)).toBe(false);
  });

  it("a family key cannot open the schedule even under the operator header", () => {
    credentials();
    expect(isFamily(request("person:maya"), "person:maya")).toBe(true);
    expect(isOperator(new Request("http://recall.test", { headers: { "x-recall-operator": "maya-key" } }))).toBe(false);
  });
});

describe("live family time", () => {
  it("posts a new Weekly Note after seven real days without running a call", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-06T15:00:00.000Z"));
    const live = await createLiveRecall({ callMode: "none", root: process.cwd() });
    const first = await live.service.weeklyNote("person:maya");
    expect(first.status).toBe("posted");
    expect(JSON.stringify(first)).toContain("2026-11-06");
    expect((await live.service.weeklyNote("person:maya")).status).toBe("cap_reached");
    vi.setSystemTime(new Date("2026-11-14T15:00:00.000Z"));
    const next = await live.service.weeklyNote("person:maya");
    expect(next.status).not.toBe("cap_reached");
    expect(next.status).toBe("posted");
    expect(JSON.stringify(next)).toContain("2026-11-14");
  });
});

describe("timeouts cannot leave tools mutating after an exit (§2 rules 3, 8)", () => {
  it("discards late transcription before it can update the session", async () => {
    const b = await bench();
    let resolve!: (turns: never[]) => void;
    b.ctx.transcription = { label: "delayed", turnsIn: () => new Promise((r) => { resolve = r; }), allTurns: async () => [] };
    const runtime = new ToolRuntime({ clock: b.clock, call: b.ctx }, TOOL_IMPLS, { timeout_ms: 5 });
    const before = structuredClone(b.ctx.session);
    await expect(runtime.call("check_safety_phrases", { audio_window: { asset_id: "call-golden", start_ms: 0, end_ms: 1000 } })).rejects.toThrow(/did not respond in time/);
    resolve([]);
    await new Promise((r) => setTimeout(r, 10));
    expect(b.ctx.session).toEqual(before);
    expect(runtime.log[0]!.output).toBeNull();
  });

  it("awaits a slow confirmed commit instead of closing while the claim is still being written", async () => {
    const rig = await buildFixtureRig();
    const deps = (rig.service as unknown as { deps: import("@/lib/service/recall-service").RecallDeps }).deps;
    deps.runtime = { ...deps.runtime, timeout_ms: 5 };
    const put = rig.graph.putNode.bind(rig.graph);
    let release!: () => void;
    let entered!: () => void;
    const writing = new Promise<void>((r) => { entered = r; });
    const blocked = new Promise<void>((r) => { release = r; });
    rig.graph.putNode = async (node) => {
      if (node.id === "claim:session:slow-commit") { entered(); await blocked; }
      await put(node);
    };
    let settled = false;
    const result = rig.service.runScheduledCall("session:slow-commit").finally(() => { settled = true; });
    await writing;
    await new Promise((r) => setTimeout(r, 15));
    expect(settled).toBe(false);
    expect(await rig.graph.getNode("claim:session:slow-commit")).toBeNull();
    release();
    const run = await result;
    expect(run!.recording.final_state).toBe("stored");
    expect(await rig.graph.getNode("claim:session:slow-commit")).not.toBeNull();
    expect(run!.runtime.log.some((entry) => entry.error?.name === "ToolTimeoutError")).toBe(false);
  });
});
