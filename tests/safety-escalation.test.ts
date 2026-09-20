/**
 * Missed-call tiering and the shared caregiver ack / backup escalation
 * (AGENTS.md rule 15, tools 19-21). Both alert categories use this path.
 */
import { describe, expect, it } from "vitest";
import { buildFixtureRig } from "@/fixtures/harness";
import { SAFETY_THRESHOLDS } from "@/fixtures";
import { CallUnavailableError, FixtureCallDriver } from "@/lib/orchestrator/call-driver";
import { RecallService } from "@/lib/service/recall-service";
import { GOLDEN_TRANSCRIPT, JUDGED_TIMING } from "@/fixtures";
import { OPENING, SAID, policyWith, run } from "./helpers";

const MAYA_PHONE = "+16095550111";
const unanswered = () => ({
  call_asset_id: "call-golden",
  connect: () => Promise.reject(new CallUnavailableError("nobody joined")),
  speak: async () => {},
  playback: async () => {},
  listen: () => Promise.reject(new Error("unreachable")),
  hangUp: async () => {},
});

const frequent = (backup: boolean, extra: (p: Record<string, unknown>) => void = () => {}) =>
  policyWith((p) => {
    p.call_frequency.min_hours_between_calls = 0;
    p.safety.designated_caregivers = [{ person_id: "person:maya", alert_channel: "dashboard", phone: MAYA_PHONE }];
    p.safety.backup_caregiver_id = backup ? "person:priya" : null;
    p.approved_people = backup ? ["person:maya", "person:priya"] : ["person:maya"];
    extra(p);
  });

async function unansweredService(backup: boolean) {
  const rig = await buildFixtureRig({ policy: frequent(backup) });
  const deps = (rig.service as unknown as { deps: ConstructorParameters<typeof RecallService>[0] }).deps;
  const service = new RecallService({ ...deps, callDriver: unanswered });
  return { rig, service, deps };
}

describe("missed-call tiering", () => {
  it("a streak of exactly 2 posts the dashboard notice and nothing else", async () => {
    const { service, rig } = await unansweredService(false);
    await service.runScheduledCall("session:miss-1");
    expect(await service.unansweredStreakNotice("person:maya")).toBeNull();
    expect(rig.alerts.count()).toBe(0);

    await service.runScheduledCall("session:miss-2");
    const notice = await service.unansweredStreakNotice("person:maya");
    expect(notice).toMatchObject({ script_id: "FAM-MISS-01", count: 2 });
    expect(notice!.text).toBe("Susan hasn't answered her last 2 scheduled calls.");
    expect(rig.alerts.count()).toBe(0);
    expect(await rig.graph.nodesOfType("SafetyEvent")).toEqual([]);
    expect((await service.weeklyNote("person:maya")).note?.lines.map((l) => l.script_id) ?? []).not.toContain("FAM-MISS-01");
    expect(await service.unansweredStreakNotice("person:priya")).toBeNull(); // no dashboard grant
  });

  it("a streak of exactly 3 fires send_safety_alert with category missed_calls, and a connect resets the streak", async () => {
    const { service, rig, deps } = await unansweredService(false);
    await service.runScheduledCall("session:miss-1");
    await service.runScheduledCall("session:miss-2");
    const third = await service.runScheduledCall("session:miss-3");
    expect(third!.recording.tool_log.filter((c) => c.tool === "check_safety_phrases")).toEqual([]);
    expect(third!.recording.tool_log.filter((c) => c.tool === "assess_conversation_state")).toEqual([]);
    const sent = third!.recording.tool_log.filter((c) => c.tool === "send_safety_alert");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.input).toMatchObject({ category: "missed_calls" });
    const alerts = rig.alerts.sentTo("person:maya");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.category).toBe("missed_calls");
    expect(alerts[0]!.text).toMatch(/has not answered 3 scheduled calls/);
    expect(alerts[0]!.text).toMatch(/Reply 1 to let Recall know you've seen this/);
    expect(alerts[0]!.text).not.toMatch(/because|fell|unwell|cause/i);
    expect((await rig.graph.nodesOfType("SafetyEvent")).map((e) => e.props.category)).toEqual(["missed_calls"]);

    deps.callDriver = () => new FixtureCallDriver(GOLDEN_TRANSCRIPT, rig.clock, JUDGED_TIMING.call_connect_delay_ms);
    const connected = new RecallService(deps);
    await connected.runScheduledCall("session:picked-up");
    expect(await connected.unansweredStreakNotice("person:maya")).toBeNull();
    await expect((await import("@/lib/safety/missed-calls")).readMissedCallState(rig.graph)).resolves.toMatchObject({ streak: 0 });
  });

  it("a connected call after 2 misses clears the streak without ever sending an SMS", async () => {
    const { service, rig, deps } = await unansweredService(false);
    await service.runScheduledCall("session:miss-1");
    await service.runScheduledCall("session:miss-2");
    expect(await service.unansweredStreakNotice("person:maya")).not.toBeNull();

    deps.callDriver = () => new FixtureCallDriver(GOLDEN_TRANSCRIPT, rig.clock, JUDGED_TIMING.call_connect_delay_ms);
    const connected = new RecallService(deps);
    await connected.runScheduledCall("session:picked-up");
    expect(await connected.unansweredStreakNotice("person:maya")).toBeNull();
    expect(rig.alerts.count()).toBe(0);
    expect(await rig.graph.nodesOfType("SafetyEvent")).toEqual([]);
  });

  it("a blocked call does not increment the streak: her phone never rang", async () => {
    const { service, rig } = await unansweredService(false);
    rig.setup.pauseCalls(true);
    const r = await service.runScheduledCall("session:paused");
    expect(r!.recording.final_state).toBe("blocked");
    expect(await service.unansweredStreakNotice("person:maya")).toBeNull();
  });
});

describe("reply-1 acknowledgment and backup escalation", () => {
  const firePhrase = () => run([...OPENING, ["her", "I fell in the kitchen this morning."], ["recall", SAID.safety]], { policy: frequent(true) });

  it("replying 1 within the timeout stops escalation, for a phrase match and for missed calls", async () => {
    const phrase = await firePhrase();
    expect(phrase.alerts.sentTo("person:maya")).toHaveLength(1);
    expect(phrase.alerts.sentTo("person:priya")).toEqual([]);
    expect(await phrase.service.receiveCaregiverSms(MAYA_PHONE, " 1 ")).toMatchObject({ status: "acknowledged" });
    phrase.clock.advance(SAFETY_THRESHOLDS.ack_timeout_minutes * 60_000);
    expect(await phrase.service.tickSafetyEscalations()).toEqual([]);
    expect(phrase.alerts.sentTo("person:priya")).toEqual([]);

    const { service, rig } = await unansweredService(true);
    await service.runScheduledCall("session:m1");
    await service.runScheduledCall("session:m2");
    await service.runScheduledCall("session:m3");
    expect(await service.receiveCaregiverSms(MAYA_PHONE, "1")).toMatchObject({ status: "acknowledged" });
    rig.clock.advance(SAFETY_THRESHOLDS.ack_timeout_minutes * 60_000);
    expect(await service.tickSafetyEscalations()).toEqual([]);
    expect(rig.alerts.sentTo("person:priya")).toEqual([]);
  });

  it("letting the timeout elapse fires escalate_safety_alert exactly once, to the backup only, same text and category", async () => {
    const r = await firePhrase();
    const original = r.alerts.sentTo("person:maya")[0]!;
    r.clock.advance(SAFETY_THRESHOLDS.ack_timeout_minutes * 60_000);
    const ticks = await r.service.tickSafetyEscalations();
    expect(ticks).toEqual([{ status: "escalated", alert_id: original.alert_id, backup_caregiver_id: "person:priya" }]);
    expect(await r.service.tickSafetyEscalations()).toEqual([]);
    const backup = r.alerts.sentTo("person:priya");
    expect(backup).toHaveLength(1);
    expect(backup[0]!.category).toBe(original.category);
    expect(backup[0]!.text).toBe(original.text);
    expect(backup[0]!.caregiver_id).toBe("person:priya");
  });

  it("a second 1, a body that is not 1, and a 1 with nothing pending are silent no-ops", async () => {
    const r = await firePhrase();
    expect(await r.service.receiveCaregiverSms(MAYA_PHONE, "1")).toMatchObject({ status: "acknowledged" });
    const afterAck = r.alerts.count();
    expect(await r.service.receiveCaregiverSms(MAYA_PHONE, "1")).toMatchObject({ status: "noop" });
    expect(await r.service.receiveCaregiverSms(MAYA_PHONE, "yes")).toMatchObject({ status: "noop", alert_id: null });
    expect(await r.service.receiveCaregiverSms(MAYA_PHONE, "11")).toMatchObject({ status: "noop", alert_id: null });
    const { service } = await unansweredService(true);
    expect(await service.receiveCaregiverSms(MAYA_PHONE, "1")).toMatchObject({ status: "noop", alert_id: null });
    expect(r.alerts.count()).toBe(afterAck);
  });

  it("a 1 after the alert has already escalated is a silent no-op", async () => {
    const r = await firePhrase();
    r.clock.advance(SAFETY_THRESHOLDS.ack_timeout_minutes * 60_000);
    await r.service.tickSafetyEscalations();
    const count = r.alerts.count();
    expect(await r.service.receiveCaregiverSms(MAYA_PHONE, "1")).toMatchObject({ status: "noop" });
    expect(r.alerts.count()).toBe(count);
  });

  it("no backup_caregiver_id: the timeout elapses, nothing escalates, no error", async () => {
    const r = await run([...OPENING, ["her", "I fell in the kitchen this morning."], ["recall", SAID.safety]], { policy: frequent(false) });
    r.clock.advance(SAFETY_THRESHOLDS.ack_timeout_minutes * 60_000);
    await expect(r.service.tickSafetyEscalations()).resolves.toEqual([]);
    expect(r.alerts.sentTo("person:priya")).toEqual([]);
  });
});
