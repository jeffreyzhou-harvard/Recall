/**
 * Onboarding: households, the people in them, the joint setup, and who may change what.
 * Every rule runs over BOTH stores - in memory, and SQLite - so the two cannot drift apart.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { MANIFEST, POLICY } from "@/fixtures";
import { FixtureClock } from "@/lib/clock";
import { buildGraph } from "@/lib/graph/seed";
import { Onboarding, loosenings } from "@/lib/onboarding/onboarding";
import { SqliteOnboardingStore } from "@/lib/onboarding/sqlite-store";
import { MemoryOnboardingStore, type OnboardingStore } from "@/lib/onboarding/store";
import { OnboardingError } from "@/lib/onboarding/types";
import { AssetIndex } from "@/lib/provenance/assets";
import { policySchema, type AccessPolicy } from "@/lib/tools";
import { openOnboarding } from "@/server/onboarding";
import { createLiveRecall } from "@/server/recall-live";

const SUSAN = { display_name: "Susan", subject_pronoun: "she", phone: "+16095550123" };
const MAYA = { display_name: "Maya" };
const H = "a".repeat(64);
const open: SqliteOnboardingStore[] = [];
afterEach(() => open.splice(0).forEach((s) => s.close()));

const STORES: Array<[string, () => OnboardingStore]> = [
  ["in memory", () => new MemoryOnboardingStore()],
  ["SQLite", () => (open.push(SqliteOnboardingStore.open()), open.at(-1)!)],
];
const codeOf = (p: Promise<unknown>): Promise<string> => p.then(() => "ok", (e) => (e instanceof OnboardingError ? e.code : `threw ${String(e)}`));

/** The judged setup, re-addressed to a household created here. */
function setupFor(householdId: string, her: string, caregiver: string, patch: (p: AccessPolicy) => void = () => {}): AccessPolicy {
  const p = structuredClone(policySchema.parse(POLICY));
  Object.assign(p, { policy_id: `policy:${householdId}`, person_id: her, established_by: [her, caregiver], recall_set_up_by: caregiver, approved_people: [caregiver], approved_audiences: [her] });
  p.safety.designated_caregivers = [{ person_id: caregiver, alert_channel: "dashboard" }];
  p.attestations.introduced_by = caregiver;
  p.dashboard.grants = [{ member_id: caregiver, detail_level: "weekly_note_and_record", granted_at: "2026-10-12T15:00:00.000Z", revoked_at: null }];
  patch(p);
  return p;
}

describe.each(STORES)("onboarding, %s", (_name, makeStore) => {
  const start = async () => {
    const clock = new FixtureClock("2026-10-12T15:00:00.000Z");
    const onboarding = new Onboarding(makeStore(), clock);
    const made = await onboarding.createHousehold({ participant: SUSAN, caregiver: MAYA });
    return { onboarding, clock, hid: made.household.household_id, her: made.participant.person_id, maya: made.caregiver.person_id };
  };
  const withSetup = async () => {
    const s = await start();
    await s.onboarding.recordJointSetup(s.hid, setupFor(s.hid, s.her, s.maya), [s.her, s.maya], s.maya);
    return s;
  };

  describe("a household", () => {
    it("starts with her and the caregiver setting Recall up with her - both, or neither", async () => {
      const { onboarding, hid, her, maya } = await start();
      expect([hid, maya, her]).toEqual(["household:1", "person:h1:1", "person:h1:2"]);
      expect((await onboarding.status(hid)).household.status).toBe("onboarding");
      const bad = new Onboarding(makeStore(), new FixtureClock("2026-10-12T15:00:00.000Z"));
      expect(await codeOf(bad.createHousehold({ participant: { ...SUSAN, phone: "609-555-0123" }, caregiver: MAYA }))).toBe("invalid");
      expect(await codeOf(bad.createHousehold({ participant: SUSAN, caregiver: { display_name: "   " } }))).toBe("invalid");
      // Nothing half-made was left behind: the next household is still the first.
      expect((await bad.createHousehold({ participant: SUSAN, caregiver: MAYA })).household.household_id).toBe("household:1");
    });

    it("keeps one number - hers - and it belongs to one person only", async () => {
      const { onboarding } = await start();
      expect(await codeOf(onboarding.createHousehold({ participant: { display_name: "Rose", phone: SUSAN.phone }, caregiver: { display_name: "Tom" } }))).toBe("already_exists");
      const other = await onboarding.createHousehold({ participant: { display_name: "Rose", phone: "+442071838750" }, caregiver: { display_name: "Tom" } });
      expect(other.caregiver.phone).toBeNull(); // Recall never contacts family, so it never holds their number (rule 5)
      expect(other.household.household_id).toBe("household:2");
    });

    it("never stores clinical or state language, in a name or in a note (rules 4 and 8)", async () => {
      const { onboarding, hid, her, maya } = await start();
      expect(await codeOf(onboarding.createHousehold({ participant: { ...SUSAN, display_name: "Susan (early-stage dementia)", phone: "+16095550199" }, caregiver: MAYA }))).toBe("clinical_language");
      expect(await codeOf(onboarding.recordJointSetup(hid, setupFor(hid, her, maya), [her, maya], maya, "her cognitive decline is advancing"))).toBe("clinical_language");
      expect(await codeOf(onboarding.recordJointSetup(hid, setupFor(hid, her, maya, (p) => (p.description = "Setup after her Alzheimer's diagnosis")), [her, maya], maya))).toBe("clinical_language");
    });
  });

  describe("joining", () => {
    it("is by invitation from her or a caregiver - nobody signs themselves up - and a token works once", async () => {
      const { onboarding, hid, her, maya } = await start();
      const invitation = await onboarding.invite(hid, { display_name: "Priya", role: "family" }, her, H);
      expect(invitation).toMatchObject({ invitation_id: "invitation:h1:1", status: "pending", token_hash: H });
      expect((await onboarding.status(hid)).pending_invitations).toBe(1);

      const priya = await onboarding.acceptInvitation(H);
      expect(priya).toMatchObject({ person_id: "person:h1:3", role: "family", display_name: "Priya", phone: null, added_by: her });
      // Used, and never existed, get one and the same answer: an invitation cannot be probed.
      expect(await codeOf(onboarding.acceptInvitation(H))).toBe("not_found");
      expect(await codeOf(onboarding.acceptInvitation("b".repeat(64)))).toBe("not_found");
      // A family member cannot invite anyone; being in the household grants nothing.
      expect(await codeOf(onboarding.invite(hid, { display_name: "Anika", role: "family" }, priya.person_id, "c".repeat(64)))).toBe("not_allowed");
      expect(await codeOf(onboarding.invite(hid, { display_name: "Anika", role: "family" }, "person:h9:9", "c".repeat(64)))).toBe("not_a_member");
      void maya;
    });

    it("an invitation can be withdrawn before it is used", async () => {
      const { onboarding, hid, maya } = await start();
      const invitation = await onboarding.invite(hid, { display_name: "Priya", role: "family" }, maya, H);
      await onboarding.withdrawInvitation(hid, invitation.invitation_id, maya);
      expect(await codeOf(onboarding.acceptInvitation(H))).toBe("not_found");
    });
  });

  describe("ask, don't assert", () => {
    it("a tie exists because a member said so, in the word they used - and the word has to mean the relation", async () => {
      const { onboarding, hid, her, maya } = await start();
      const tie = await onboarding.stateRelationship(hid, { from_person_id: her, to_person_id: maya, relation: "child", said_as: "Daughter" }, her);
      expect(tie).toMatchObject({ relation: "child", said_as: "daughter", stated_by: her });
      expect(await codeOf(onboarding.stateRelationship(hid, { from_person_id: her, to_person_id: maya, relation: "sibling", said_as: "daughter" }, her))).toBe("invalid");
      expect(await codeOf(onboarding.stateRelationship(hid, { from_person_id: her, to_person_id: maya, relation: "child", said_as: "daughter" }, maya))).toBe("already_exists");
      expect(await codeOf(onboarding.stateRelationship(hid, { from_person_id: her, to_person_id: her, relation: "friend" }, her))).toBe("invalid");
      expect(await codeOf(onboarding.stateRelationship(hid, { from_person_id: her, to_person_id: "person:h2:1", relation: "friend" }, her))).toBe("not_a_member");
      expect(await codeOf(onboarding.stateRelationship(hid, { from_person_id: her, to_person_id: maya, relation: "worked_at" }, her))).toBe("invalid"); // not a tie between people
    });
  });

  describe("the joint setup", () => {
    it("is agreed by her AND a caregiver, about this household and the people actually in it", async () => {
      const { onboarding, hid, her, maya } = await start();
      const doc = setupFor(hid, her, maya);
      expect(await codeOf(onboarding.recordJointSetup(hid, doc, [maya], maya))).toBe("needs_joint_agreement"); // without her it is not hers
      expect(await codeOf(onboarding.recordJointSetup(hid, doc, [her], her))).toBe("needs_joint_agreement");
      expect(await codeOf(onboarding.recordJointSetup(hid, setupFor(hid, her, maya, (p) => (p.policy_id = "policy:household:7")), [her, maya], maya))).toBe("invalid");
      expect(await codeOf(onboarding.recordJointSetup(hid, setupFor(hid, her, maya, (p) => p.approved_people.push("person:stranger")), [her, maya], maya))).toBe("invalid");
      expect(await codeOf(onboarding.recordJointSetup(hid, setupFor(hid, her, maya, (p) => (p.approved_audiences = [maya])), [her, maya], maya))).toBe("invalid");
      expect(await codeOf(onboarding.recordJointSetup(hid, { ...doc, extra_field: true }, [her, maya], maya))).toBe("invalid");

      const v1 = await onboarding.recordJointSetup(hid, doc, [her, maya], maya, "agreed at the kitchen table");
      expect(v1).toMatchObject({ version: 1, kind: "joint", agreed_by: [her, maya], recorded_by: maya, recorded_at: "2026-10-12T15:00:00.000Z" });
      expect((await onboarding.currentSetup(hid))!.document).toEqual(doc);
    });

    it("walks the household from onboarding to active, step by step, and says what is still missing", async () => {
      const { onboarding, hid, her, maya } = await start();
      expect((await onboarding.status(hid)).steps.filter((s) => !s.done).map((s) => s.step)).toEqual(["joint_setup_agreed", "contact_saved_and_recall_introduced", "designated_caregiver_named", "topics_allowed"]);

      await onboarding.recordJointSetup(hid, setupFor(hid, her, maya, (p) => (p.attestations.number_saved_in_her_phone = false)), [her, maya], maya);
      const partway = await onboarding.status(hid);
      expect(partway).toMatchObject({ ready_to_call: false, household: { status: "onboarding" } });
      expect(partway.steps.find((s) => s.step === "contact_saved_and_recall_introduced")).toEqual({ step: "contact_saved_and_recall_introduced", done: false, detail: "the number is not saved in her phone" });

      await onboarding.recordJointSetup(hid, setupFor(hid, her, maya), [her, maya], maya);
      expect(await onboarding.status(hid)).toMatchObject({ ready_to_call: true, reconfirmation_due: false, household: { status: "active" } });
    });

    it("prompts a periodic re-confirmation, and records it as something they did together", async () => {
      const { onboarding, clock, hid, her, maya } = await withSetup();
      clock.advance(91 * 86_400_000);
      expect((await onboarding.status(hid)).reconfirmation_due).toBe(true);
      expect(await codeOf(onboarding.recordReconfirmation(hid, [maya], maya))).toBe("needs_joint_agreement");
      const v = await onboarding.recordReconfirmation(hid, [her, maya], maya);
      expect(v).toMatchObject({ version: 2, kind: "joint" });
      expect((await onboarding.status(hid)).reconfirmation_due).toBe(false);
    });
  });

  describe("what one person may change alone (rule 12): only ever less", () => {
    it("revoking, narrowing, and pausing are allowed - to her, or to a caregiver", async () => {
      const { onboarding, hid, her, maya } = await withSetup();
      const current = (await onboarding.currentSetup(hid))!.document;
      const revoked = structuredClone(current);
      revoked.topics.allow = revoked.topics.allow.filter((t) => t !== "event:mayas-wedding");
      revoked.topics.block.push("event:mayas-wedding");
      revoked.call_windows = [{ days: ["mon", "wed", "fri"], start: "09:30", end: "11:00" }];
      revoked.speech.max_call_minutes = 5;
      revoked.dashboard.grants[0]!.detail_level = "weekly_note";
      expect(await onboarding.tightenSetup(hid, revoked, her, "she would rather not talk about the wedding")).toMatchObject({ version: 2, kind: "tightening", agreed_by: [her] });

      const paused = structuredClone(revoked);
      paused.calls_paused = true;
      await onboarding.tightenSetup(hid, paused, maya);
      expect(await onboarding.status(hid)).toMatchObject({ ready_to_call: false, household: { status: "paused" } });
    });

    it.each([
      ["allowing a new topic", (p: AccessPolicy) => void p.topics.allow.push("place:somewhere-new"), /a topic was allowed/],
      ["widening a call window into the evening", (p: AccessPolicy) => void (p.call_windows[0]!.end = "20:00"), /call window was added or widened/],
      ["longer calls", (p: AccessPolicy) => void (p.speech.max_call_minutes = 10), /longer calls/],
      ["more calls per week", (p: AccessPolicy) => void (p.call_frequency.max_calls_per_week = 14), /more calls per week/],
      ["turning people on as topics", (p: AccessPolicy) => void (p.topics.person_topics_enabled = true), /people were turned on/],
      ["touching the safety block - only ever in the joint setup (rule 15)", (p: AccessPolicy) => void (p.safety.emergency_number = "000"), /safety can only change in a joint setup/],
      ["moving her to another timezone", (p: AccessPolicy) => void (p.timezone = "Europe/London"), /timezone can only change/],
    ])("refuses %s", async (_what, change, reason) => {
      const { onboarding, hid, maya } = await withSetup();
      const next = structuredClone((await onboarding.currentSetup(hid))!.document);
      change(next);
      await expect(onboarding.tightenSetup(hid, next, maya)).rejects.toThrow(reason);
      expect(await codeOf(onboarding.tightenSetup(hid, next, maya))).toBe("needs_joint_agreement");
      expect((await onboarding.currentSetup(hid))!.version).toBe(1); // and nothing was recorded
    });

    it("a topic, once blocked, is not unblocked alone", async () => {
      const { onboarding, hid, her, maya } = await withSetup();
      const blocked = structuredClone((await onboarding.currentSetup(hid))!.document);
      blocked.topics.allow = blocked.topics.allow.filter((t) => t !== "place:princeton");
      blocked.topics.block.push("place:princeton");
      await onboarding.tightenSetup(hid, blocked, her);
      const unblocked = structuredClone(blocked);
      unblocked.topics.block = unblocked.topics.block.filter((t) => t !== "place:princeton");
      await expect(onboarding.tightenSetup(hid, unblocked, maya)).rejects.toThrow(/a topic was unblocked/);
    });

    it("a pause can be set alone; resuming, and restoring a revoked family view, take the two of them", async () => {
      const { onboarding, hid, her, maya } = await withSetup();
      const paused = structuredClone((await onboarding.currentSetup(hid))!.document);
      paused.calls_paused = true;
      paused.dashboard.grants[0]!.revoked_at = "2026-10-12T15:00:00.000Z";
      await onboarding.tightenSetup(hid, paused, her);
      const resumed = structuredClone(paused);
      resumed.calls_paused = false;
      await expect(onboarding.tightenSetup(hid, resumed, maya)).rejects.toThrow(/calls were resumed/);
      const restored = structuredClone(paused);
      restored.dashboard.grants[0]!.revoked_at = null;
      await expect(onboarding.tightenSetup(hid, restored, maya)).rejects.toThrow(/family view was restored/);
      expect(await onboarding.recordJointSetup(hid, resumed, [her, maya], maya)).toMatchObject({ version: 3, kind: "joint" });
    });

    it("a family member cannot change the setup at all", async () => {
      const { onboarding, hid, maya } = await withSetup();
      await onboarding.invite(hid, { display_name: "Priya", role: "family" }, maya, H);
      const priya = await onboarding.acceptInvitation(H);
      expect(await codeOf(onboarding.tightenSetup(hid, (await onboarding.currentSetup(hid))!.document, priya.person_id))).toBe("not_allowed");
    });

    it("`loosenings` is empty for an identical document, so re-saving changes nothing it should not", () => {
      const p = policySchema.parse(POLICY);
      expect(loosenings(p, structuredClone(p))).toEqual([]);
    });
  });

  describe("leaving", () => {
    it("takes a member's permissions away first, keeps their record, and keeps every earlier version of the setup", async () => {
      const { onboarding, hid, her, maya } = await withSetup();
      await onboarding.invite(hid, { display_name: "Priya", role: "family" }, maya, H);
      const priya = await onboarding.acceptInvitation(H);
      const withPriya = setupFor(hid, her, maya, (p) => (p.approved_people.push(priya.person_id), p.dashboard.grants.push({ member_id: priya.person_id, detail_level: "weekly_note", granted_at: "2026-10-12T15:00:00.000Z", revoked_at: null })));
      await onboarding.recordJointSetup(hid, withPriya, [her, maya], maya);

      await onboarding.removeMember(hid, priya.person_id, her);
      const now = (await onboarding.currentSetup(hid))!;
      expect(now).toMatchObject({ version: 3, kind: "tightening" });
      expect(now.document.approved_people).toEqual([maya]);
      expect(now.document.dashboard.grants.find((g) => g.member_id === priya.person_id)!.revoked_at).not.toBeNull();
      expect(await codeOf(onboarding.invite(hid, { display_name: "Anika", role: "family" }, priya.person_id, "d".repeat(64)))).toBe("not_a_member");
    });

    it("only she or a caregiver can remove anyone - a family member cannot, even someone who holds no permissions", async () => {
      const { onboarding, hid, maya } = await withSetup();
      await onboarding.invite(hid, { display_name: "Priya", role: "family" }, maya, H);
      await onboarding.invite(hid, { display_name: "Anika", role: "family" }, maya, "e".repeat(64));
      const [priya, anika] = [await onboarding.acceptInvitation(H), await onboarding.acceptInvitation("e".repeat(64))];
      expect(await codeOf(onboarding.removeMember(hid, anika.person_id, priya.person_id))).toBe("not_allowed");
      await onboarding.removeMember(hid, anika.person_id, maya);
      expect((await onboarding.currentSetup(hid))!.version).toBe(1); // she held no permissions, so the setup did not change
    });

    it("her safety alert always has somewhere to go: a designated caregiver, and she herself, cannot be removed this way", async () => {
      const { onboarding, hid, her, maya } = await withSetup();
      expect(await codeOf(onboarding.removeMember(hid, maya, her))).toBe("needs_joint_agreement");
      expect(await codeOf(onboarding.removeMember(hid, her, maya))).toBe("not_allowed");
    });
  });

  describe("her memory graph starts from these records", () => {
    it("builds a valid identity layer: the people, the ties as they were stated, the setup - and no memories", async () => {
      const { onboarding, hid, her, maya } = await withSetup();
      await onboarding.stateRelationship(hid, { from_person_id: her, to_person_id: maya, relation: "child", said_as: "daughter" }, her);
      const graph = buildGraph(await onboarding.graphSeed(hid), new AssetIndex(MANIFEST));
      expect(graph.nodes.filter((n) => n.type === "Person").map((n) => [n.id, n.label, (n.props as { role: string }).role])).toEqual([[maya, "Maya", "family"], [her, "Susan", "participant"]].sort());
      const tie = graph.edges.find((e) => e.type === "RELATED_TO")!;
      expect(tie).toMatchObject({ from: her, to: maya, props: { relation: "child", said_as: "daughter" }, prov: { author: her, source_id: `artifact:onboarding:${her}` } });
      expect(graph.nodes.filter((n) => ["EpisodicClaim", "Contribution", "Story"].includes(n.type))).toEqual([]);
      expect(graph.edges.filter((e) => e.type === "PERMITTED_IN").map((e) => e.from).sort()).toEqual([`artifact:onboarding:${her}`, "artifact:setup-record", maya].sort());
    });

    it("has nothing to start from until there is a joint setup", async () => {
      const { onboarding, hid } = await start();
      expect(await codeOf(onboarding.graphSeed(hid))).toBe("needs_joint_agreement");
    });
  });
});

describe("the two stores agree", () => {
  it("the same onboarding, on each, leaves the same records behind", async () => {
    const run = async (store: OnboardingStore) => {
      const onboarding = new Onboarding(store, new FixtureClock("2026-10-12T15:00:00.000Z"));
      const { household, participant, caregiver } = await onboarding.createHousehold({ participant: SUSAN, caregiver: MAYA });
      const [hid, her, maya] = [household.household_id, participant.person_id, caregiver.person_id];
      await onboarding.invite(hid, { display_name: "Priya", role: "family" }, her, H);
      await onboarding.acceptInvitation(H, { subject_pronoun: "she" });
      await onboarding.stateRelationship(hid, { from_person_id: her, to_person_id: maya, relation: "child", said_as: "daughter" }, her);
      await onboarding.recordJointSetup(hid, setupFor(hid, her, maya), [her, maya], maya);
      return { households: await store.listHouseholds(), people: await store.people(hid), ties: await store.relationships(hid), versions: await store.setupVersions(hid), consents: await store.consents(hid), invitations: await store.invitations(hid), seed: await onboarding.graphSeed(hid), status: await onboarding.status(hid) };
    };
    const sqlite = SqliteOnboardingStore.open();
    open.push(sqlite);
    expect(await run(sqlite)).toEqual(await run(new MemoryOnboardingStore()));
  });
});

describe("SQLite holds the line even if the code above it does not", () => {
  it("survives a restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "recall-onboarding-"));
    try {
      const path = join(dir, "onboarding.db");
      const first = SqliteOnboardingStore.open(path);
      const made = await new Onboarding(first, new FixtureClock("2026-10-12T15:00:00.000Z")).createHousehold({ participant: SUSAN, caregiver: MAYA });
      first.close();
      const again = SqliteOnboardingStore.open(path);
      open.push(again);
      expect((await again.people(made.household.household_id)).map((p) => p.display_name)).toEqual(["Maya", "Susan"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses, in the schema itself: a second participant, a family member's phone number, and any edit to what was agreed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "recall-onboarding-"));
    try {
      const path = join(dir, "onboarding.db");
      const store = SqliteOnboardingStore.open(path);
      open.push(store);
      const onboarding = new Onboarding(store, new FixtureClock("2026-10-12T15:00:00.000Z"));
      const { household, participant, caregiver } = await onboarding.createHousehold({ participant: SUSAN, caregiver: MAYA });
      await onboarding.recordJointSetup(household.household_id, setupFor(household.household_id, participant.person_id, caregiver.person_id), [participant.person_id, caregiver.person_id], caregiver.person_id);

      const raw = new DatabaseSync(path); // someone reaching past the code, straight at the file
      try {
        expect(() => raw.exec(`INSERT INTO people (person_id, household_id, role, display_name, phone, added_at) VALUES ('p:x', 'household:1', 'participant', 'Another', '+16095550111', '2026-10-12T15:00:00.000Z')`)).toThrow(/UNIQUE/);
        expect(() => raw.exec(`INSERT INTO people (person_id, household_id, role, display_name, phone, added_at) VALUES ('p:y', 'household:1', 'family', 'Priya', '+16095550112', '2026-10-12T15:00:00.000Z')`)).toThrow(/CHECK/);
        expect(() => raw.exec(`UPDATE setup_versions SET document = '{}' WHERE version = 1`)).toThrow(/append-only/);
        expect(() => raw.exec(`DELETE FROM setup_versions`)).toThrow(/append-only/);
        expect(() => raw.exec(`DELETE FROM consent_events`)).toThrow(/append-only/);
        // Rule 8, as a fact about the schema: there is nowhere to put what Recall must never collect.
        const columns = (raw.prepare("SELECT m.name AS tbl, p.name AS col FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'").all() as Array<{ tbl: string; col: string }>).map((c) => c.col);
        expect(columns.filter((c) => /diagnos|stage|condition|health|medical|birth|dob|age|address|location|email|score/i.test(c))).toEqual([]);
        expect(columns.filter((c) => c === "phone")).toHaveLength(1);
      } finally {
        raw.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to open a database written by a different schema version", () => {
    const dir = mkdtempSync(join(tmpdir(), "recall-onboarding-"));
    try {
      const path = join(dir, "onboarding.db");
      SqliteOnboardingStore.open(path).close();
      const raw = new DatabaseSync(path);
      raw.exec("UPDATE meta SET value = '99' WHERE key = 'schema_version'");
      raw.close();
      expect(() => SqliteOnboardingStore.open(path)).toThrow(/schema version 99/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the live server runs for an onboarded household", () => {
  it("starts from that household's people and setup, and a change recorded in the database is in force at the next load", async () => {
    const dir = mkdtempSync(join(tmpdir(), "recall-onboarding-"));
    try {
      const onboarding = openOnboarding(dir, "onboarding.db");
      const { household, participant, caregiver } = await onboarding.createHousehold({ participant: SUSAN, caregiver: MAYA });
      const [hid, her, maya] = [household.household_id, participant.person_id, caregiver.person_id];
      const config = { callMode: "none" as const, root: dir, household: hid, onboardingDb: "onboarding.db" };
      await expect(createLiveRecall(config)).rejects.toThrow(/joint setup/); // nothing agreed yet: nothing to run on

      await onboarding.recordJointSetup(hid, setupFor(hid, her, maya, (p) => (p.attestations.saved_contact_photo = false)), [her, maya], maya);
      const beforeIntroduction = await createLiveRecall(config);
      expect(beforeIntroduction.callMode).toBe("none"); // family setup can continue; calls remain unavailable
      expect(await beforeIntroduction.tick()).toBeNull();

      await onboarding.recordJointSetup(hid, setupFor(hid, her, maya), [her, maya], maya);
      const live = await createLiveRecall(config);
      expect(live.setup.current()).toMatchObject({ policy_id: `policy:${hid}`, person_id: her, approved_people: [maya] });
      // Her graph holds the household and no memories, so there is nothing of hers to point anyone to yet.
      expect((await live.service.askAboutHer("What does she remember?", maya)).line.script_id).toBe("FAMILY-NOTHING-YET");
      expect((await live.service.weeklyNote(maya)).status).not.toBe("no_access");

      const revoked = structuredClone((await onboarding.currentSetup(hid))!.document);
      revoked.dashboard.grants[0]!.revoked_at = "2026-10-13T15:00:00.000Z";
      await onboarding.tightenSetup(hid, revoked, her);
      await live.refreshSetup();
      expect(await live.service.weeklyNote(maya)).toEqual({ status: "no_access", note: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
