import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { FixtureClock } from "@/lib/clock";
import { Onboarding } from "@/lib/onboarding/onboarding";
import { MemoryOnboardingStore } from "@/lib/onboarding/store";
import { getOnboarding } from "@/server/onboarding";
import { issueAccount, revokeAccount } from "@/server/accounts";
import { selectHousehold } from "@/server/active-household";
import { browserPrincipal, sessionCookie } from "@/server/session";
import { isOperator } from "@/server/operator";
import { canManageHousehold } from "@/server/household-access";
import { POST as start } from "@/app/api/onboarding/start/route";
import { GET as session, POST as signIn } from "@/app/api/session/route";
import { GET as household } from "@/app/api/onboarding/households/[id]/route";
import { POST as preferences } from "@/app/api/onboarding/households/[id]/preferences/route";
import { POST as setup } from "@/app/api/onboarding/households/[id]/setup/route";
import { POST as choices } from "@/app/api/onboarding/households/[id]/choices/route";
import { POST as account } from "@/app/api/onboarding/households/[id]/accounts/route";
import { POST as invite, DELETE as withdraw } from "@/app/api/onboarding/households/[id]/invitations/route";
import { DELETE as removeMember } from "@/app/api/onboarding/households/[id]/members/route";
import { POST as relationship } from "@/app/api/onboarding/households/[id]/relationships/route";
import { POST as activate } from "@/app/api/onboarding/activate/route";
import { POST as schedule } from "@/app/api/live/schedule/route";
import { GET as topics } from "@/app/api/onboarding/topics/route";
import { GET as knowledge } from "@/app/api/onboarding/knowledge/route";

vi.mock("@/server/onboarding", async (original) => ({ ...await original<typeof import("@/server/onboarding")>(), getOnboarding: vi.fn() }));
const origin = "http://recall.test";
const input = { participant: { display_name: "Alex", phone: "+16095550123" }, caregiver: { display_name: "Sam" } };
const req = (body?: unknown, cookie = "", requestOrigin = origin) => new Request(origin + "/api/onboarding", { method: body === undefined ? "GET" : "POST", headers: { origin: requestOrigin, cookie, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const context = (id = "household:1") => ({ params: Promise.resolve({ id }) });
let dir: string, store: MemoryOnboardingStore, onb: Onboarding;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "recall-setup-access-"));
  vi.stubEnv("RECALL_DATA_DIR", dir); vi.stubEnv("RECALL_OPERATOR_SECRET", ""); vi.stubEnv("RECALL_FAMILY_SECRET", ""); vi.stubEnv("RECALL_FAMILY_CREDENTIALS", "{}"); vi.stubEnv("RECALL_POLICY_FILE", ""); vi.stubEnv("RECALL_HOUSEHOLD", ""); vi.stubEnv("NODE_ENV", "production");
  store = new MemoryOnboardingStore(); onb = new Onboarding(store, new FixtureClock("2026-09-19T12:00:00.000Z"));
  vi.mocked(getOnboarding).mockReturnValue(onb);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); rmSync(dir, { recursive: true, force: true }); });
async function owner() { const response = await start(req(input)); expect(response.status).toBe(201); return response.headers.get("set-cookie")!.split(";")[0]!; }

describe("first setup without a code", () => {
  it("creates just one household under competing requests and signs in only a scoped caregiver", async () => {
    expect((await (await session(req())).json()).first_setup_available).toBe(true);
    const responses = await Promise.all([start(req(input)), start(req(input))]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const won = responses.find((r) => r.status === 201)!;
    const data = await won.json(), cookie = won.headers.get("set-cookie")!;
    expect(data.key).toBeUndefined(); expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("SameSite=Strict");
    const request = req(undefined, cookie.split(";")[0]);
    expect(browserPrincipal(request)).toEqual({ role: "family", member_id: data.caregiver_id });
    expect(isOperator(request)).toBe(false);
    expect(await (await session(request)).json()).toMatchObject({ first_setup_available: false, can_manage_setup: true, managed_household_id: data.household.household_id });
    expect((await schedule(req({}, cookie.split(";")[0]))).status).toBe(403);
  });
  it("refuses an existing unactivated household and never recreates a local operator shortcut", async () => {
    await onb.createHousehold(input);
    expect((await (await session(req())).json()).first_setup_available).toBe(false);
    expect((await start(req(input))).status).toBe(409);
    vi.stubEnv("NODE_ENV", "development");
    expect((await signIn(new Request("http://localhost/api/session", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ local: true }) }))).status).toBe(403);
  });
  it.each(["RECALL_OPERATOR_SECRET", "RECALL_POLICY_FILE", "RECALL_HOUSEHOLD"])("refuses deployments with %s", async (name) => {
    vi.stubEnv(name, "already-configured");
    expect((await (await session(req())).json()).first_setup_available).toBe(false);
    expect((await start(req(input))).status).toBe(403);
    expect(await onb.isEmpty()).toBe(true);
  });
  it("requires the same origin before creating any account or household", async () => {
    expect((await start(req(input, "", "https://another.test"))).status).toBe(403);
    expect(await onb.isEmpty()).toBe(true);
  });
  it("requires existing family credentials to sign in instead of claiming a deployment", async () => {
    vi.stubEnv("RECALL_FAMILY_CREDENTIALS", JSON.stringify({ "person:existing": "private-family-key" }));
    expect((await (await session(req())).json()).first_setup_available).toBe(false);
    expect((await start(req(input))).status).toBe(403);
  });
});

describe("household-scoped setup access", () => {
  it("allows its own household, rejects foreign household reads and every mutation before inspecting the payload", async () => {
    const cookie = await owner();
    expect((await household(req(undefined, cookie), context())).status).toBe(200);
    expect((await household(req(undefined, cookie), context("household:other"))).status).toBe(403);
    for (const route of [preferences, setup, choices, account, invite, withdraw, removeMember, relationship]) {
      expect((await route(req({}, cookie), context("household:other"))).status).toBe(403);
    }
    expect((await activate(req({ household_id: "household:other" }, cookie))).status).toBe(403);
  });
  it("refuses caregiver actor impersonation and cross-origin requests", async () => {
    const cookie = await owner();
    expect((await invite(req({ display_name: "Rae", role: "family", invited_by: "person:h1:2" }, cookie), context())).status).toBe(403);
    expect((await setup(req({ kind: "tightening", by: "person:h1:2", document: {} }, cookie), context())).status).toBe(403);
    expect((await relationship(req({ stated_by: "person:h1:2" }, cookie), context())).status).toBe(403);
    expect((await preferences(req({}, cookie, "https://another.test"), context())).status).toBe(403);
  });
  it("only exposes active-household topics and knowledge, and cannot replace another active household", async () => {
    const cookie = await owner();
    selectHousehold("household:other");
    expect((await topics(req(undefined, cookie))).status).toBe(403);
    expect((await knowledge(req(undefined, cookie))).status).toBe(403);
    expect((await activate(req({ household_id: "household:1" }, cookie))).status).toBe(409);
  });
  it("rechecks current membership, account revocation, expiry, and signature", async () => {
    const cookie = await owner();
    expect(await canManageHousehold(req(undefined, cookie), "household:1")).toBe(true);
    expect(await canManageHousehold(req(undefined, cookie + "bad"), "household:1")).toBe(false);
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 9 * 60 * 60 * 1000);
    expect(await canManageHousehold(req(undefined, cookie), "household:1")).toBe(false);
    vi.useRealTimers();
    await store.markRemoved("person:h1:1", "2026-09-19T13:00:00.000Z");
    expect(await canManageHousehold(req(undefined, cookie), "household:1")).toBe(false);
    revokeAccount("person:h1:1");
    expect(browserPrincipal(req(undefined, cookie))).toBeNull();
  });
  it("a persisted family member or participant account cannot manage setup", async () => {
    await owner();
    await onb.invite("household:1", { display_name: "Rae", role: "family" }, "person:h1:1", "a".repeat(64));
    const person = await onb.acceptInvitation("a".repeat(64));
    for (const [id, role] of [[person.person_id, "family"], ["person:h1:2", "patient"]] as const) {
      issueAccount("household:1", id, role);
      const cookie = sessionCookie({ role, member_id: id }, req()).split(";")[0];
      expect(await canManageHousehold(req(undefined, cookie), "household:1")).toBe(false);
    }
  });
  it("refreshes its own session when a caregiver creates a recovery key", async () => {
    const cookie = await owner();
    const response = await account(req({ member_id: "person:h1:1" }, cookie), context());
    expect(response.status).toBe(200);
    expect(browserPrincipal(req(undefined, cookie))).toBeNull();
    const refreshed = response.headers.get("set-cookie")!.split(";")[0];
    expect(await canManageHousehold(req(undefined, refreshed), "household:1")).toBe(true);
  });
  it("a failed bootstrap cleanup cannot revoke a subsequently replaced account", async () => {
    await onb.createHousehold(input);
    const failedKey = issueAccount("household:1", "person:h1:1", "family");
    issueAccount("household:1", "person:h1:1", "family");
    const cookie = sessionCookie({ role: "family", member_id: "person:h1:1" }, req()).split(";")[0];
    revokeAccount("person:h1:1", failedKey);
    expect(await canManageHousehold(req(undefined, cookie), "household:1")).toBe(true);
  });
});
