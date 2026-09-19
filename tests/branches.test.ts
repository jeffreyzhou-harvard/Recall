/** AGENTS.md section 12, test 3 (and the call half of test 11): every failure transition ends safely and leaves nothing behind it should not. */
import { describe, expect, it } from "vitest";
import { buildFixtureRig, runFixture } from "@/fixtures/harness";
import type { NodeOf, NodeType } from "@/lib/graph/types";
import { replay, visitedStates } from "@/lib/state/reducer";
import { ACCOUNTS_DIFFER, CAPTURE_AND_CONFIRM, HER_LINE, OPENING, QUIET_THEN, SAID, SAID_RUNG5, SCRIPT_WITH_REORIENTATION, overlay, policyWith, run, spokenText, toolsCalled, type Step } from "./helpers";

const nodesOf = <T extends NodeType>(r: Awaited<ReturnType<typeof run>>, type: T): Promise<Array<NodeOf<T>>> => r.graph.nodesOfType(type);
const newClaims = async (r: Awaited<ReturnType<typeof run>>) => (await r.graph.nodesOfType("EpisodicClaim")).filter((c) => c.prov.source_class === "recall_call");
const UP_TO_ASSOCIATION: Step[] = [...OPENING, ["her", "Cape May...?"], ["relay", SAID.rung2], ["her", "I'm not sure."], ["relay", SAID.rung3]];
const RECALLED: Step[] = [...UP_TO_ASSOCIATION, ["her", "Maya, my daughter!"], ["relay", SAID.elaborate]];

describe("the call is never placed", () => {
  it("outside the agreed window: blocked, no call, nothing ingested", async () => {
    const r = await runFixture({ now: "2026-11-05T08:00:00.000Z" }); // 3 a.m. in New York
    expect(r.recording.final_state).toBe("blocked");
    expect(replay(r.recording.trace).context.ending_reason).toBe("outside_call_window");
    expect(r.recording.call).toBeNull();
    expect(toolsCalled(r)).toEqual(["get_next_recall_topic", "place_recall_call", "build_caregiver_receipt"]);
    expect(await nodesOf(r, "Session")).toHaveLength(21); // only the seeded history: a blocked call is not a call
    expect(r.recording.caregiver_receipt!.lines.map((l) => l.text)).toEqual(["No call was placed."]);
  });

  it.each([
    ["too soon after the last call", (p: Record<string, any>) => (p.call_frequency.min_hours_between_calls = 72), "too_soon_after_last_call"],
    ["the weekly limit", (p: Record<string, any>) => (p.call_frequency.max_calls_per_week = 3), "weekly_call_limit_reached"],
    ["a caregiver pause", (p: Record<string, any>) => (p.calls_paused = true), "calls_paused"],
    ["no saved contact", (p: Record<string, any>) => (p.attestations.number_saved_in_her_phone = false), "setup_attestations_missing"],
    ["Relay never introduced to her", (p: Record<string, any>) => (p.attestations.relay_introduced_to_her = false), "setup_attestations_missing"],
  ])("%s: blocked", async (_name, patch, reason) => {
    const r = await runFixture({ policy: policyWith(patch) });
    expect(r.recording.final_state).toBe("blocked");
    expect(replay(r.recording.trace).context.ending_reason).toBe(reason);
    expect(r.recording.call).toBeNull();
  });

  it("a revoked topic is gone before the next call; the next topic due is chosen instead", async () => {
    const rig = await buildFixtureRig({ now: "2026-11-05T08:00:00.000Z" }); // outside the window, so only the choice of topic is exercised
    rig.setup.revokeTopic("event:cape-may-summers");
    const r = await rig.service.runScheduledCall("session:after-revoke");
    expect(r!.recording.topic!.topic_id).toBe("place:lincoln-elementary");
    expect((r!.recording.tool_log[0]!.output as { excluded: Array<{ topic_id: string; reason: string }> }).excluded).toContainEqual({ topic_id: "event:cape-may-summers", reason: "on the block list" });
  });

  it("she does not pick up: no answer today, and nobody calls back", async () => {
    const rig = await buildFixtureRig({ transcript: null });
    const service = new (await import("@/lib/service/relay-service")).RelayService({
      ...(rig.service as unknown as { deps: ConstructorParameters<typeof import("@/lib/service/relay-service").RelayService>[0] }).deps,
      callDriver: () => ({ call_asset_id: "call-golden", connect: () => Promise.reject(Object.assign(new Error("nobody joined"), { name: "CallUnavailableError" })), speak: async () => {}, playback: async () => {}, listen: () => Promise.reject(new Error("unreachable")), hangUp: async () => {} }),
    });
    const r = await service.runScheduledCall("session:no-pickup");
    expect(r!.recording.final_state).toBe("no_answer_today");
    expect(r!.recording.spoken).toEqual([]);
  });
});

describe("the ladder", () => {
  it("climbs to recognition when association does not reach it, and she picks one of the two", async () => {
    const r = await run([...UP_TO_ASSOCIATION, ["her", "Hmm."], ["relay", SAID.rung4], ["her", "My daughter."], ["relay", SAID.elaborate], ...CAPTURE_AND_CONFIRM()]);
    expect(r.recording.final_state).toBe("stored");
    expect(replay(r.recording.trace).context).toMatchObject({ rungs_fired: [1, 2, 3, 4], reached_at_rung: 4 });
    expect(SAID.rung4).toBe("Did you go to Cape May with your daughter or your sister?");
    expect(r.recording.caregiver_receipt!.lines[0]!.text).toBe("Cape May summers - recalled with a recognition prompt in this call.");
  });

  it("naming the other option is not graded, and the memory is never stated outright: the ladder ends at recognition with a kind close", async () => {
    const r = await run([...UP_TO_ASSOCIATION, ["her", "Hmm."], ["relay", SAID.rung4], ["her", "My sister."], ["relay", SAID.closeKind]]);
    expect(r.recording.final_state).toBe("no_answer_today");
    expect(replay(r.recording.trace).context).toMatchObject({ rungs_fired: [1, 2, 3, 4], reached_at_rung: null });
    expect(spokenText(r).some((t) => /you told me|your daughter maya/i.test(t))).toBe(false); // no correction, and no fact put to her
    const last = r.recording.tool_log.filter((c) => c.tool === "select_scaffold").at(-1)!.output as { rung: number | null; rejected: Array<{ rung: number; reason: string }> };
    expect(last.rung).toBeNull();
    expect(last.rejected.find((x) => x.rung === 5)!.reason).toMatch(/autobiographical memory/);
    expect(r.recording.topic).toMatchObject({ reorientation_allowed: false });
  });

  it("the last rung exists only for a procedural category - and even there only after rungs 1-4 (shown with a test-only script)", async () => {
    const r = await run([...UP_TO_ASSOCIATION, ["her", "Hmm."], ["relay", SAID.rung4], ["her", "My sister."], ["relay", SAID_RUNG5], ["her", "We had a little house near the beach there."], ["playback"], ["relay", SAID.storeQuestion], ["her", "Yes."], ["relay", SAID.shareQuestion], ["her", "Yes."], ["relay", SAID.closeWarm]], { script: SCRIPT_WITH_REORIENTATION });
    expect(r.recording.topic).toMatchObject({ reorientation_allowed: true });
    expect(replay(r.recording.trace).context).toMatchObject({ rungs_fired: [1, 2, 3, 4, 5], reached_at_rung: 5 });
    expect(r.recording.provenance_receipt!.literal_transcript).toBe("We had a little house near the beach there.");
  });

  it("every rejected rung is logged with a reason, and each rung fires at most once", async () => {
    const r = await run([...UP_TO_ASSOCIATION, ["her", "Hmm."], ["relay", SAID.rung4], ["her", "My daughter."], ["relay", SAID.elaborate], ...CAPTURE_AND_CONFIRM()]);
    const picks = r.recording.tool_log.filter((c) => c.tool === "select_scaffold").map((c) => c.output as { rung: number; rejected: Array<{ rung: number; reason: string }> });
    expect(picks.map((p) => p.rung)).toEqual([1, 2, 3, 4]);
    for (const p of picks) expect(p.rejected.map((x) => x.rung).sort()).toEqual([1, 2, 3, 4, 5].filter((n) => n !== p.rung));
    expect(picks[3]!.rejected.find((x) => x.rung === 5)!.reason).toMatch(/^disabled: this is an autobiographical memory/); // disabled, not merely held in reserve
    expect(picks[1]!.rejected.find((x) => x.rung === 1)!.reason).toMatch(/never repeated/);
  });

  it("a recognition pick is not stored: repeating the choice after the follow-up keeps nothing", async () => {
    const r = await run([...UP_TO_ASSOCIATION, ["her", "Hmm."], ["relay", SAID.rung4], ["her", "My daughter."], ["relay", SAID.elaborate], ["her", "Daughter."], ["relay", SAID.closeKind]]);
    expect(r.recording.final_state).toBe("not_stored");
    expect(replay(r.recording.trace).context).toMatchObject({ rungs_fired: [1, 2, 3, 4], reached_at_rung: 4 });
    expect(await newClaims(r)).toEqual([]);
    const last = r.recording.tool_log.filter((c) => c.tool === "assess_conversation_state").at(-1)!.output as { evidence: { matched_rule: string } };
    expect(last.evidence.matched_rule).toBe("repeat_of_recognition_pick");
  });

  it("two quiet windows on a topic: a gentle wrap-up, nothing kept", async () => {
    const r = await run([...OPENING, ...QUIET_THEN(SAID.rung2), ...QUIET_THEN(SAID.closeKind)]);
    expect(r.recording.final_state).toBe("no_answer_today");
    expect(replay(r.recording.trace).context.ending_reason).toBe("two quiet windows on this topic");
    expect(r.recording.unconfirmed_audio_discarded).toBe(true);
    expect(await newClaims(r)).toEqual([]);
    expect(r.recording.caregiver_receipt!.lines[0]!.text).toBe("Cape May summers - not reached in this call.");
  });

  it("she reaches it and offers nothing more this time: a kind close, nothing stored, and the topic still counts as reached", async () => {
    const r = await run([...RECALLED, ["her", "I'm not sure."], ["relay", SAID.closeKind]]);
    expect(r.recording.final_state).toBe("not_stored");
    const outcome = (await nodesOf(r, "TopicOutcome")).find((o) => o.props.session_id === "session:judged")!;
    expect(outcome.props).toMatchObject({ first_rung_reached_unaided: 3, highest_rung_used: 3 });
  });

  it("a family-sourced, unconfirmed topic stops at rung 3, attributed, with an open question", async () => {
    const onlyWedding = policyWith((p) => (p.topics.allow = ["event:mayas-wedding"]));
    const r = await run(
      [["relay", SAID.greeting], ["relay", "I'd love to hear about the wedding in New Jersey. What comes to mind?"], ["her", "A wedding?"], ["relay", "It's a day your family celebrated together."], ["her", "I'm not sure."], ["relay", "Maya mentioned the wedding in New Jersey. What do you remember about that?"], ["her", "I don't know."], ["relay", SAID.closeKind]],
      { policy: onlyWedding },
    );
    expect(r.recording.topic).toMatchObject({ topic_id: "event:mayas-wedding", family_sourced: true });
    expect(r.recording.final_state).toBe("no_answer_today");
    expect(replay(r.recording.trace).context.rungs_fired).toEqual([1, 2, 3]);
    const last = r.recording.tool_log.filter((c) => c.tool === "select_scaffold").at(-1)!.output as { rung: number | null; rejected: Array<{ rung: number; reason: string }> };
    expect(last.rung).toBeNull();
    expect(last.rejected.filter((x) => x.rung > 3).every((x) => /rule 13/.test(x.reason))).toBe(true);
  });

  it("the retrieval layer only picks WHICH cue of the same kind: a person cue still beats a photo when preference is cleared", async () => {
    const steps: Step[] = [...OPENING, ["her", "Cape May...?"], ["relay", SAID.rung2], ["her", "I'm not sure."], ["relay", SAID.rung3], ["her", "I don't know."], ["relay", SAID.rung4], ["her", "My daughter."], ["relay", SAID.elaborate], ["her", "I'm not sure."], ["relay", SAID.closeKind]];
    const rig = await buildFixtureRig({ transcript: (await import("./helpers")).call(steps) });
    const records = await rig.service.clearRetrievalLayer();
    expect(records).toBe(4);
    const r = await rig.service.runScheduledCall("session:no-preference");
    expect(replay(r!.recording.trace).context.cues_offered[0]).toEqual({ rung: 3, cue_id: "person:maya" });
    expect(replay(r!.recording.trace).context.rungs_fired).toEqual([1, 2, 3, 4]);
    // The per-topic record is a separate store: clearing the retrieval layer left it whole, and the reverse holds too.
    expect((await rig.graph.nodesOfType("TopicOutcome")).length).toBe(22);
    expect(await rig.service.clearTopicRecord()).toBe(22);
    // This call's own cue records survive it: Maya at rung 3 (she did not reach it) and at rung 4 (she did).
    expect((await rig.graph.nodesOfType("RetrievalRecord")).map((n) => [n.props.cue_id, n.props.rung, n.props.effective])).toEqual([["person:maya", 3, false], ["person:maya", 4, true]]);
  });
});

describe("conflicting accounts", () => {
  it("neither is spoken; Relay carries on with what is left, and never says which is right", async () => {
    const r = await run([...OPENING, ["her", "Cape May...?"], ["relay", SAID.rung2], ["her", "I'm not sure."], ["relay", SAID.rung3photo], ["her", "My daughter!"], ["relay", SAID.elaborate], ...CAPTURE_AND_CONFIRM()], { overlays: [ACCOUNTS_DIFFER] });
    const conflicted = ["claim:cape-may-with-maya", "claim:maya-remembers-cape-may"];
    expect(replay(r.recording.trace).context.conflicting_claim_ids.sort()).toEqual(conflicted);
    const cited = r.recording.prompts.flatMap((p) => p.segments.flatMap((s) => s.citation_ids));
    const selected = r.recording.tool_log.filter((c) => c.tool === "select_scaffold").flatMap((c) => (c.output as { citations: string[] }).citations);
    for (const id of conflicted) expect([...cited, ...selected]).not.toContain(id);
    const note = await r.service.weeklyNote("person:maya");
    expect(note.note!.lines.find((l) => l.kind === "difference")!.text).toBe("Susan and Maya remember this differently. Want to call her about it?");
  });
});

describe("confirmation", () => {
  it.each([
    ["unclear", "Yes, but only the part about the beach.", "her answer was unclear"],
    ["declined", "No.", "she said no"],
    ["silence", null, "her answer was unclear"],
  ])("%s: nothing is stored and the audio is dropped", async (_n, reply, reason) => {
    const r = await run([...RECALLED, ["her", HER_LINE], ["playback"], ["relay", SAID.storeQuestion], reply ? ["her", reply] : ["silence"], ["relay", SAID.closeNotStored]]);
    expect(r.recording.final_state).toBe("not_stored");
    expect(replay(r.recording.trace).context.ending_reason).toBe(reason);
    expect(r.recording.contribution).toBeNull();
    expect(r.recording.unconfirmed_audio_discarded).toBe(true);
    expect(await newClaims(r)).toEqual([]);
    expect(await nodesOf(r, "Contribution")).toEqual([]);
    expect(toolsCalled(r)).not.toContain("confirm_share");
  });

  it.each([
    ["declined", "No."],
    ["unclear", "Maybe later, I suppose."],
  ])("share %s: stored, and nothing of hers reaches the family", async (_n, reply) => {
    const r = await run([...RECALLED, ...CAPTURE_AND_CONFIRM("Yes.", reply)]);
    expect(r.recording.final_state).toBe("stored");
    expect(r.recording.provenance_receipt!.shared).toBe(false);
    expect((await nodesOf(r, "Contribution"))[0]!.props.shared).toBe(false);
    const note = await r.service.weeklyNote("person:maya");
    expect(note.note!.lines.map((l) => l.kind)).not.toContain("share");
    expect(JSON.stringify(note)).not.toContain("every summer");
  });
});

describe("a tool does not respond", () => {
  it("mid-call: the current question once more, then a kind close", async () => {
    const r = await run([...OPENING, ["her", "Cape May...?"], ["relay", SAID.rung1], ["relay", SAID.closeKind]], { faults: [{ tool: "select_scaffold", on_call: 2, kind: "timeout" }] });
    expect(r.recording.final_state).toBe("no_answer_today");
    expect(spokenText(r)).toEqual([SAID.greeting, SAID.rung1, SAID.rung1, SAID.closeKind]);
    expect(r.recording.trace.filter((t) => t.event === "FIXED_RESTATEMENT_DELIVERED" && t.accepted)).toHaveLength(1);
  });

  it("before the call: never placed", async () => {
    const r = await runFixture({ faults: [{ tool: "verify_claim_support", on_call: 1, kind: "timeout" }] });
    expect(r.recording.final_state).toBe("blocked");
    expect(r.recording.call).toBeNull();
  });

  it("at the share question: kept, not shared - her yes to remembering it is never thrown away", async () => {
    const r = await run([...RECALLED, ...CAPTURE_AND_CONFIRM("Yes.", "Yes.")], { faults: [{ tool: "confirm_share", on_call: 1, kind: "timeout" }] });
    expect(r.recording.final_state).toBe("stored");
    expect(replay(r.recording.trace).context).toMatchObject({ share_resolved: true, shared: false, claim_id: "claim:session:judged" });
    expect(r.recording.trace.filter((t) => t.event === "TOOL_TIMEOUT" && t.accepted)).toHaveLength(1);
    expect((await nodesOf(r, "Contribution"))[0]!.props.shared).toBe(false);
    expect((await nodesOf(r, "ShareConfirmation"))[0]!.props.decision).toBe("timeout");
    expect(spokenText(r).at(-1)).toBe(SAID.closeWarm);
    const note = await r.service.weeklyNote("person:maya");
    expect(JSON.stringify(note)).not.toContain("every summer");
  });

  it("at the commit: nothing is stored", async () => {
    const r = await run([...RECALLED, ["her", HER_LINE], ["playback"], ["relay", SAID.storeQuestion], ["her", "Yes."], ["relay", SAID.shareQuestion], ["her", "Yes."]], { faults: [{ tool: "confirm_and_store", on_call: 2, kind: "timeout" }] });
    expect(r.recording.final_state).toBe("not_stored");
    expect(await newClaims(r)).toEqual([]);
  });
});

describe("she can always stop it", () => {
  it.each([
    ["at the invitation", [...OPENING, ["her", "Please stop."], ["relay", SAID.stopAck]] as Step[]],
    ["mid-ladder", [...UP_TO_ASSOCIATION, ["her", "I have to go."], ["relay", SAID.stopAck]] as Step[]],
    ["at the store question", [...RECALLED, ["her", HER_LINE], ["playback"], ["relay", SAID.storeQuestion], ["her", "Stop, please."], ["relay", SAID.stopAck]] as Step[]],
    ["at the share question - commit comes last, so nothing is stored", [...RECALLED, ["her", HER_LINE], ["playback"], ["relay", SAID.storeQuestion], ["her", "Yes."], ["relay", SAID.shareQuestion], ["her", "Goodbye."], ["relay", SAID.stopAck]] as Step[]],
  ])("an explicit stop %s", async (_n, steps) => {
    const r = await run(steps);
    expect(r.recording.final_state).toBe("stopped");
    expect(replay(r.recording.trace).context.stop_how).toBe("explicit_stop");
    expect(spokenText(r).at(-1)).toBe(SAID.stopAck); // one kind goodbye: no persuading, no second try
    expect(await newClaims(r)).toEqual([]);
    expect(await nodesOf(r, "Contribution")).toEqual([]);
    expect(r.recording.contribution).toBeNull();
    // Only the fact of the call is kept: no topic outcome and no cue record for a call that never finished its ladder.
    expect((await nodesOf(r, "TopicOutcome")).filter((o) => o.props.session_id === "session:judged")).toEqual([]);
    expect((await nodesOf(r, "Session")).find((s) => s.id === "session:judged")!.props.outcome).toBe("stopped");
  });

  it("a hang-up is a stop like any other", async () => {
    const rig = await buildFixtureRig();
    let listens = 0;
    const service = new (await import("@/lib/service/relay-service")).RelayService({
      ...(rig.service as unknown as { deps: ConstructorParameters<typeof import("@/lib/service/relay-service").RelayService>[0] }).deps,
      callDriver: () => ({ call_asset_id: "call-golden", connect: async () => {}, speak: async () => {}, playback: async () => {}, hangUp: async () => {}, listen: () => (listens++, Promise.reject(Object.assign(new Error("the call dropped"), { name: "CallUnavailableError" }))) }),
    });
    const r = await service.runScheduledCall("session:hang-up");
    expect(r!.recording.final_state).toBe("stopped");
    expect(replay(r!.recording.trace).context.stop_how).toBe("hang_up");
    expect(listens).toBe(1);
  });

  it("a caregiver pause ends a call that is under way, at once", async () => {
    const rig = await buildFixtureRig({ transcript: (await import("./helpers")).call(OPENING) });
    const deps = (rig.service as unknown as { deps: { callDriver: () => import("@/lib/orchestrator/call-driver").CallDriver } }).deps;
    const make = deps.callDriver;
    deps.callDriver = () => {
      const driver = make();
      const speak = driver.speak.bind(driver);
      driver.speak = async (p) => (await speak(p), p.text === SAID.rung1 ? rig.setup.pauseCalls(true) : undefined);
      return driver;
    };
    const r = await rig.service.runScheduledCall("session:paused");
    expect(r!.recording.final_state).toBe("stopped");
    expect(replay(r!.recording.trace).context.stop_how).toBe("caregiver_pause");
  });
});

describe("her audio never stays behind (rule 8)", () => {
  const depsOf = (rig: Awaited<ReturnType<typeof buildFixtureRig>>) => (rig.service as unknown as { deps: ConstructorParameters<typeof import("@/lib/service/relay-service").RelayService>[0] }).deps;

  it("an error nobody planned for still hangs up - which is what wipes the call - and the error itself is what surfaces", async () => {
    const rig = await buildFixtureRig();
    let hangUps = 0;
    const service = new (await import("@/lib/service/relay-service")).RelayService({
      ...depsOf(rig),
      // Hanging up fails too, on the way out. It must neither replace the real error nor be tried twice.
      callDriver: () => ({ call_asset_id: "call-golden", connect: async () => {}, speak: async () => {}, playback: async () => {}, listen: () => Promise.reject(new Error("the line caught fire")), hangUp: async () => (hangUps++, Promise.reject(new Error("and the hang-up failed"))) }),
    });
    await expect(service.runScheduledCall("session:unplanned")).rejects.toThrow("the line caught fire");
    expect(hangUps).toBe(1);
  });

  it("every ordinary ending hangs up exactly once", async () => {
    for (const steps of [[...RECALLED, ...CAPTURE_AND_CONFIRM()], [...OPENING, ["her", "Please stop."], ["relay", SAID.stopAck]], [...OPENING, ["her", "I can't breathe."], ["relay", SAID.safety]]] as Step[][]) {
      const rig = await buildFixtureRig({ transcript: (await import("./helpers")).call(steps) });
      const deps = depsOf(rig);
      const make = deps.callDriver!;
      let hangUps = 0;
      deps.callDriver = () => {
        const driver = make();
        const hangUp = driver.hangUp.bind(driver);
        driver.hangUp = async () => (hangUps++, hangUp());
        return driver;
      };
      await rig.service.runScheduledCall("session:once");
      expect(hangUps).toBe(1);
    }
  });

  it("a call that was never answered is closed as well", async () => {
    const rig = await buildFixtureRig();
    let hangUps = 0;
    const service = new (await import("@/lib/service/relay-service")).RelayService({
      ...depsOf(rig),
      callDriver: () => ({ call_asset_id: "call-golden", connect: () => Promise.reject(Object.assign(new Error("nobody joined"), { name: "CallUnavailableError" })), speak: async () => {}, playback: async () => {}, listen: () => Promise.reject(new Error("unreachable")), hangUp: async () => void hangUps++ }),
    });
    expect((await service.runScheduledCall("session:unanswered"))!.recording.final_state).toBe("no_answer_today");
    expect(hangUps).toBe(1);
  });
});

describe("the safety handoff", () => {
  it("drops the recall flow, alerts the designated caregiver BEFORE saying anything, and says the fixed line once", async () => {
    const r = await run([...UP_TO_ASSOCIATION, ["her", "I fell in the kitchen this morning."], ["relay", SAID.safety]]);
    expect(r.recording.final_state).toBe("safety_handoff");
    expect(spokenText(r).filter((t) => t === SAID.safety)).toHaveLength(1);
    const tools = toolsCalled(r);
    expect(tools.indexOf("send_safety_alert")).toBe(tools.lastIndexOf("check_safety_phrases") + 1);
    expect(tools.slice(tools.indexOf("send_safety_alert"))).not.toContain("assess_conversation_state"); // nothing else processed that turn
    const alerts = r.alerts.sentTo("person:maya");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.text).toBe("Relay safety note, 2026-11-05 15:30 UTC: during a Relay call, Susan said something on Relay's safety list (a fall). Relay is not an emergency service and cannot tell what is happening. Please call Susan.");
    expect(alerts[0]!.text).not.toMatch(/kitchen|morning/); // never her words
    expect((await nodesOf(r, "SafetyEvent"))[0]!.props).toEqual({ category: "fall", at: alerts[0]!.at, recipients: ["person:maya"] });
    expect(r.recording.safety_category).toBe("fall");
    expect(r.recording.caregiver_receipt!.lines.map((l) => l.text)).toEqual(["Relay stopped the call and sent a safety note to the designated caregiver."]);
  });

  it("accepts the false positive: 'I fell in love with Maya' sends only the neutral alert", async () => {
    const r = await run([...UP_TO_ASSOCIATION, ["her", "I fell in love with Maya the day she was born."], ["relay", SAID.safety]]);
    expect(r.recording.final_state).toBe("safety_handoff");
    expect(r.alerts.count()).toBe(1);
  });

  it("at the confirmation too - and the alert neither appears in nor counts toward the Weekly Note", async () => {
    const r = await run([...RECALLED, ["her", HER_LINE], ["playback"], ["relay", SAID.storeQuestion], ["her", "Help me, someone is in my house."], ["relay", SAID.safety]]);
    expect(r.recording.final_state).toBe("safety_handoff");
    expect(await newClaims(r)).toEqual([]);
    const note = await r.service.weeklyNote("person:maya");
    expect(JSON.stringify(note)).not.toMatch(/safety|unsafe|house/i);
    expect((await r.service.weeklyNote("person:maya")).status).toBe("cap_reached"); // the note is the only thing counted
  });

  it("a hang-up in the same turn still sends it", async () => {
    const rig = await buildFixtureRig({ transcript: (await import("./helpers")).call([...OPENING, ["her", "I can't breathe."]]) });
    const deps = (rig.service as unknown as { deps: { callDriver: () => import("@/lib/orchestrator/call-driver").CallDriver } }).deps;
    const make = deps.callDriver;
    deps.callDriver = () => {
      const driver = make();
      const speak = driver.speak.bind(driver);
      // She is gone by the time Relay would speak: the line after her turn cannot be said.
      driver.speak = async (p) => (p.text === SAID.safety ? Promise.reject(Object.assign(new Error("the call dropped"), { name: "CallUnavailableError" })) : speak(p));
      return driver;
    };
    const r = await rig.service.runScheduledCall("session:safety-then-gone");
    expect(r!.recording.final_state).toBe("safety_handoff"); // not "stopped": the safety match outranks the hang-up
    expect(rig.alerts.sentTo("person:maya")).toHaveLength(1);
  });

  it("is never triggered by Relay's own speech", async () => {
    const phrases = structuredClone((await import("@/fixtures")).SAFETY_PHRASES);
    phrases.categories.fall!.phrases.push("what comes to mind"); // words only Relay says
    const r = await run([...OPENING, ...QUIET_THEN(SAID.rung2), ...QUIET_THEN(SAID.closeKind)], { safetyPhrases: phrases });
    expect(r.recording.final_state).toBe("no_answer_today");
    expect(r.alerts.count()).toBe(0);
  });
});

describe("who Relay is", () => {
  it("answers each identity phrase with the fixed line, uses up no rung, and carries on", async () => {
    const r = await run([...OPENING, ["her", "Wait, who is this?"], ["relay", SAID.identity], ["her", "Are you a real person?"], ["relay", SAID.identity], ["her", "Oh, Maya's little house by the beach!"], ["playback"], ["relay", SAID.storeQuestion], ["her", "Yes."], ["relay", SAID.shareQuestion], ["her", "No."], ["relay", SAID.closeWarm]]);
    expect(SAID.identity).toBe("I'm Relay, a computer assistant, not a person. Maya set me up to keep you company.");
    expect(r.recording.final_state).toBe("stored");
    expect(replay(r.recording.trace).context).toMatchObject({ rungs_fired: [1], reached_at_rung: 1 });
    expect(visitedStates(replay(r.recording.trace))).toEqual(["idle", "scheduled", "policy_passed", "connected", "topic_selected", "asking", "recalled", "confirming", "confirmed", "stored"]);
    expect(r.recording.caregiver_receipt!.lines[0]!.text).toBe("Cape May summers - recalled unaided in this call.");
  });

  it("every phrase on the identity list is heard as that question", async () => {
    const { CALL_SCRIPT } = await import("@/fixtures");
    for (const phrase of CALL_SCRIPT.identity_phrases) {
      const r = await run([...OPENING, ["her", `${phrase}?`], ["relay", SAID.identity], ["her", "Goodbye."], ["relay", SAID.stopAck]]);
      expect(r.recording.trace.filter((t) => t.event === "IDENTITY_ASKED" && t.accepted), phrase).toHaveLength(1);
    }
  });
});

describe("the agreed call length", () => {
  it("is enforced by the reducer: once it has passed, the next step is the kind close", async () => {
    // A one-minute limit, and a reply that comes after it has passed.
    const late = (await import("./helpers")).call([...OPENING, ["her", "Cape May...?"], ["relay", SAID.closeKind]]);
    Object.assign(late.turns[2]!, { start_ms: 64_000, end_ms: 66_000, words: late.turns[2]!.words.map((w, i) => ({ ...w, start_ms: 64_000 + i * 500, end_ms: 64_400 + i * 500 })) });
    Object.assign(late.turns[3]!, { start_ms: 67_000, end_ms: 69_000, words: late.turns[3]!.words.map((w, i) => ({ ...w, start_ms: 67_000 + i * 100, end_ms: 67_080 + i * 100 })) });
    const r = await runFixture({ transcript: late, policy: policyWith((p) => (p.speech.max_call_minutes = 1)) });
    expect(r.recording.final_state).toBe("no_answer_today");
    expect(replay(r.recording.trace).context.ending_reason).toBe("the agreed call length was reached");
  });
});

// Used by the conflicting-accounts test above; kept here so an unused import cannot hide a typo in it.
void overlay;
