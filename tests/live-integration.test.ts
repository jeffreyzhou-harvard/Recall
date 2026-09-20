import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOnboarding } from "@/server/onboarding";
import { createLiveRecall } from "@/server/recall-live";
import { SqliteGraphStore } from "@/server/graph-store";
import { browserPrincipal, principalForKey, sessionCookie } from "@/server/session";
import { isFamily, isOperator } from "@/server/operator";
import { preferencesSchema, setupFromPreferences, type Preferences } from "@/lib/onboarding/form";
import { buildFixtureRig } from "@/fixtures/harness";

const folders: string[] = [];
function folder() { const dir = mkdtempSync(join(tmpdir(), "recall-live-test-")); folders.push(dir); return dir; }
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const preferences: Preferences = { days: ["mon"], start: "09:00", end: "12:00", timezone: "America/New_York", max_minutes: 8, max_calls_per_week: 1, min_hours_between_calls: 24, pace: "standard", emergency_number: "911", saved_contact_name: "Recall", number_saved: false, photo_saved: false, introduced: false, dashboard: "weekly_note_and_record", patient_agreed: true, caregiver_agreed: true, expected_version: 0 };
async function household(root: string) {
  const onboarding = openOnboarding(root);
  const made = await onboarding.createHousehold({ participant: { display_name: "Test participant", phone: "+16095550123" }, caregiver: { display_name: "Test caregiver" } });
  const identity = { household: made.household.household_id, participant: made.participant.person_id, caregiver: made.caregiver.person_id };
  await onboarding.recordJointSetup(identity.household, setupFromPreferences(preferences, identity, "2026-09-19T12:00:00.000Z"), [identity.participant, identity.caregiver], identity.caregiver);
  return { onboarding, identity };
}

describe("real household integration", () => {
  it("never falls back to mock data on an unconfigured installation", async () => {
    await expect(createLiveRecall({ root: folder(), callMode: "none" })).rejects.toThrow(/joint setup/);
  });
  it("persists a contribution across server reconstruction and starts with no fictional history", async () => {
    const root = folder(), { onboarding, identity } = await household(root);
    const config = { root, callMode: "none" as const, household: identity.household };
    const first = await createLiveRecall(config);
    expect(await first.service.dashboardInfo(identity.caregiver)).toMatchObject({ person_name: "Test participant", member_name: "Test caregiver", sessions: [], contributions: [] });
    expect(await first.tick()).toBeNull();
    const input = { contributor_id: identity.caregiver, claim: { who: "Our family", what_happened: "We baked bread on Saturdays.", when_where: null, photo_asset_id: null, about_topic_id: null }, provenance: { medium: "text" as const, received_at: "2026-09-19T13:00:00.000Z" } };
    expect((await first.service.tellRecallAMemory(input)).status).toBe("stored_as_family_claim");
    const reopened = await createLiveRecall(config);
    expect((await reopened.service.dashboardInfo(identity.caregiver))?.contributions).toEqual([{ text: input.claim.what_happened, at: input.provenance.received_at }]);
    expect((await reopened.service.topicRecord(identity.caregiver)).topics).toEqual([]);
    expect(JSON.stringify(await reopened.service.dashboardInfo(identity.caregiver))).not.toMatch(/Susan|Maya|Cape May/);
    const setup = (await onboarding.currentSetup(identity.household))!.document;
    setup.dashboard.grants[0]!.revoked_at = "2026-09-19T14:00:00.000Z";
    await onboarding.tightenSetup(identity.household, setup, identity.caregiver);
    await reopened.refreshSetup();
    expect((await reopened.service.weeklyNote(identity.caregiver)).status).toBe("no_access");
    expect((await reopened.service.dashboardInfo(identity.caregiver))?.sessions).toEqual([]);
  });
  it("refuses prerecorded speech for a real household", async () => {
    const root = folder(), { identity } = await household(root);
    await expect(createLiveRecall({ root, callMode: "prerecorded", household: identity.household })).rejects.toThrow(/cannot use prerecorded/);
  });
  it("rolls back a failed multi-node write and isolates household graphs", async () => {
    const file = join(folder(), "graph.db"), a = new SqliteGraphStore(file, "a"), b = new SqliteGraphStore(file, "b");
    const rig = await buildFixtureRig(); const node = (await rig.graph.getNode("person:maya"))!;
    await expect(a.atomic(async () => { await a.putNode(node); throw new Error("write failed"); })).rejects.toThrow("write failed");
    expect(await a.getNode(node.id)).toBeNull();
    await a.putNode(node); expect(await b.getNode(node.id)).toBeNull();
    a.close(); const reopened = new SqliteGraphStore(file, "a"); expect(await reopened.getNode(node.id)).toEqual(node);
    reopened.close(); b.close();
  });
  it("never exposes private patient claims or another contributor's words in the own-contribution list", async () => {
    const rig = await buildFixtureRig();
    const info = await rig.service.dashboardInfo("person:maya");
    expect(info?.contributions.every((c) => c.text !== "We went to Cape May every summer.")).toBe(true);
    expect(await rig.service.dashboardInfo("person:stranger")).toBeNull();
  });
});

describe("browser sessions", () => {
  function env() { vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("RECALL_OPERATOR_SECRET", "operator-test-key"); vi.stubEnv("RECALL_FAMILY_SECRET", ""); vi.stubEnv("RECALL_FAMILY_CREDENTIALS", JSON.stringify({ "member:a": "member-test-key" })); }
  const req = (cookie = "", origin = "https://recall.test", method = "GET") => new Request("https://recall.test/api/family/dashboard", { method, headers: { cookie, origin } });
  it("binds the HttpOnly session to the credential owner, not a client-supplied ID", () => {
    env(); const p = principalForKey("member-test-key")!; const cookie = sessionCookie(p, req()).split(";")[0]!;
    expect(sessionCookie(p, req())).toMatch(/HttpOnly; SameSite=Strict/);
    expect(sessionCookie(p, req())).toContain("; Secure");
    expect(browserPrincipal(req(cookie))).toEqual({ role: "family", member_id: "member:a" });
    expect(isFamily(req(cookie), "member:a")).toBe(true);
    expect(isFamily(req(cookie), "member:b")).toBe(false);
    expect(isOperator(req(cookie))).toBe(false);
  });
  it("refuses tampering, cross-origin writes, expiry and rotated keys", () => {
    env(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-19T12:00:00Z"));
    const cookie = sessionCookie(principalForKey("member-test-key")!, req()).split(";")[0]!;
    expect(browserPrincipal(req(cookie + "x"))).toBeNull();
    expect(isFamily(req(cookie, "https://other.test", "POST"), "member:a")).toBe(false);
    expect(isFamily(req(cookie, "https://recall.test", "POST"), "member:a")).toBe(true);
    vi.setSystemTime(new Date("2026-09-20T12:00:00Z")); expect(browserPrincipal(req(cookie))).toBeNull();
    vi.setSystemTime(new Date("2026-09-19T12:00:00Z")); vi.stubEnv("RECALL_FAMILY_CREDENTIALS", JSON.stringify({ "member:a": "rotated" })); expect(browserPrincipal(req(cookie))).toBeNull();
  });
});

describe("joint setup adapter", () => {
  it("requires both agreements and never enables calls or invents attestations", () => {
    expect(preferencesSchema.safeParse({ ...preferences, patient_agreed: false }).success).toBe(false);
    expect(preferencesSchema.safeParse({ ...preferences, caregiver_agreed: false }).success).toBe(false);
    const doc = setupFromPreferences(preferences, { household: "h", participant: "p", caregiver: "c" }, "2026-09-19T12:00:00Z");
    expect(doc.calls_paused).toBe(true); expect(doc.topics.allow).toEqual([]); expect(doc.attestations.number_saved_in_her_phone).toBe(false);
    expect(doc.dashboard.grants[0]?.member_id).toBe("c");
    expect(preferencesSchema.safeParse({ ...preferences, contacts: [{ phone: "+123456789" }] }).success).toBe(false);
  });
  it("keeps all live entry points free of preview fixtures", () => {
    for (const file of ["app/layout.tsx", "app/page.tsx", "app/family/page.tsx", "app/onboarding/page.tsx", "app/revisit/page.tsx"]) expect(readFileSync(file, "utf8")).not.toMatch(/fixtures|recall-preview|PreviewProvider/);
  });
});
