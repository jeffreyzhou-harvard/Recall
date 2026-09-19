/**
 * Bugs found by the 2026-09-19 scan, each pinned by the input that showed it. Every test here failed before
 * its fix. They are kept apart from the behaviour suites so the reason each one exists stays readable.
 */
import { describe, expect, it } from "vitest";
import { buildFixtureRig, runFixture } from "@/fixtures/harness";
import type { CallDriver } from "@/lib/orchestrator/call-driver";
import { CallUnavailableError } from "@/lib/orchestrator/call-driver";
import { tokens } from "@/lib/providers/transcription";
import { ProvLog } from "@/lib/provenance/prov-log";
import type { RecallDeps } from "@/lib/service/recall-service";
import { replay } from "@/lib/state/reducer";
import { createRecallStore } from "@/lib/state/store";
import { GateKeeper, TOOL_IMPLS, ToolRuntime, newSession, type ToolContext } from "@/lib/tools";
import { SetupStore, attestationsMissing, policySchema } from "@/lib/tools/policy";
import { classifyYes } from "@/lib/tools/impl/contribution";
import { CALL_SCRIPT, CAPTURE_AND_CONFIRM, FAMILY_SEED, HER_LINE, OPENING, SAID, bench, call, overlay, policyWith, run, spokenText, toolsCalled, type Step } from "./helpers";

const UP_TO_ASSOCIATION: Step[] = [...OPENING, ["her", "Cape May...?"], ["recall", SAID.rung2], ["her", "I'm not sure."], ["recall", SAID.rung3]];
const RECALLED: Step[] = [...UP_TO_ASSOCIATION, ["her", "Maya, my daughter!"], ["recall", SAID.elaborate]];
const UP_TO_STORE_QUESTION: Step[] = [...RECALLED, ["her", HER_LINE], ["playback"], ["recall", SAID.storeQuestion]];
const newClaims = async (r: Awaited<ReturnType<typeof run>>) => (await r.graph.nodesOfType("EpisodicClaim")).filter((c) => c.prov.source_class === "recall_call");
/**
 * How one reply of hers is classified, given what Recall has said so far. Called on the tool directly: the
 * prerecorded-call driver is strict about what Recall says NEXT, which is not what these tests are about.
 */
async function stateOf(reply: string, recallSaid: Array<[text: string, rung: number | null]> = [[SAID.greeting, null], [SAID.rung1, 1]]) {
  const transcript = call([...recallSaid.map(([text]): Step => ["recall", text]), ["her", reply]]);
  const b = await bench({ transcript });
  recallSaid.forEach(([text, rung], i) => b.ctx.session.spoken.push({ prompt_id: `prompt:${i}`, script_id: text === SAID.identity ? CALL_SCRIPT.lines.identity.id : `LINE-${i}`, rung, text, at: b.clock.iso() }));
  const last = transcript.turns.at(-1)!;
  return b.runtime.call("assess_conversation_state", { topic_id: b.topicId, audio_window: { asset_id: transcript.asset_id, start_ms: last.start_ms - 500, end_ms: last.end_ms }, turn_history: [] });
}
const AFTER_ELABORATE: Array<[string, number | null]> = [[SAID.greeting, null], [SAID.rung1, 1], [SAID.rung2, 2], [SAID.rung3, 3], [SAID.elaborate, null]];

describe("safety comes first even when a tool does not respond (rule 15)", () => {
  it("the alert tool times out: she still hears the safety line, the run still ends in safety_handoff, and the alert is tried again", async () => {
    const r = await run([...OPENING, ["her", "I can't breathe."], ["recall", SAID.safety]], { faults: [{ tool: "send_safety_alert", on_call: 1, kind: "timeout" }] });
    expect(r.recording.final_state).toBe("safety_handoff");
    expect(spokenText(r).at(-1)).toBe(SAID.safety);
    expect(spokenText(r)).not.toContain(SAID.closeKind);
    expect(r.alerts.sentTo("person:maya")).toHaveLength(1); // the second try got through
  });

  it("the phrase check itself times out: that turn is checked again rather than let through unchecked", async () => {
    const r = await run([...OPENING, ["her", "I can't breathe."], ["recall", SAID.safety]], { faults: [{ tool: "check_safety_phrases", on_call: 1, kind: "timeout" }] });
    expect(r.recording.final_state).toBe("safety_handoff");
    expect(r.alerts.sentTo("person:maya")).toHaveLength(1);
  });
});

describe("a yes is only a yes", () => {
  it.each(["Okay, I'd like to go.", "OK, I would like to go.", "Sure, you go ahead.", "Okay... I'd like you to go."])("%s is not a yes", (reply) => {
    expect(classifyYes(reply)).not.toBe("yes");
  });
  it.each(["Yes.", "Yes, please.", "Okay.", "Sure, go ahead.", "Yes, I'd like that.", "Yes I do.", "Okay, thank you."])("%s still is", (reply) => {
    expect(classifyYes(reply)).toBe("yes");
  });

  it("'Okay, I'd like to go.' at the store question ends the call and stores nothing", async () => {
    const r = await run([...UP_TO_STORE_QUESTION, ["her", "Okay, I'd like to go."], ["recall", SAID.stopAck]]);
    expect(r.recording.final_state).toBe("stopped");
    expect(await newClaims(r)).toEqual([]);
  });

  it("a curly apostrophe is an apostrophe: 'Yes, I’d like that.' is a yes, and 'I don’t think so.' is a no", () => {
    expect(tokens("Yes, I’d like that.")).toEqual(["yes", "i'd", "like", "that"]);
    expect(classifyYes("Yes, I’d like that.")).toBe("yes");
    expect(classifyYes("I don’t think so.")).toBe("no");
  });
});

describe("not remembering is never kept as a memory", () => {
  it.each(["I do not remember.", "I cannot remember that at all.", "I have no clue, dear.", "I really do not know about that."])("%s is no answer, not a new detail", async (reply) => {
    expect((await stateOf(reply)).state).toBe("no_answer");
  });

  it("and so is never captured, played back, or counted as reached unaided", async () => {
    const r = await run([...OPENING, ["her", "I do not remember."], ["recall", SAID.rung2], ["her", "I do not remember."], ["recall", SAID.rung3], ["her", "I cannot recall."], ["recall", SAID.rung4], ["her", "No clue, dear."], ["recall", SAID.closeKind]]);
    expect(toolsCalled(r)).not.toContain("capture_contribution");
    expect(r.recording.final_state).toBe("no_answer_today");
  });

  it("after the recognition rung, 'Not my daughter.' does not count as naming her", async () => {
    const toRung4: Step[] = [...UP_TO_ASSOCIATION, ["her", "I'm not sure."], ["recall", SAID.rung4]];
    const r = await run([...toRung4, ["her", "Not my daughter."], ["recall", SAID.closeKind]]);
    expect(r.recording.final_state).toBe("no_answer_today");
    expect(replay(r.recording.trace).context.reached_at_rung).toBeNull();
    const named = await run([...toRung4, ["her", "No, no - my daughter!"], ["recall", SAID.elaborate], ...CAPTURE_AND_CONFIRM()]);
    expect(replay(named.recording.trace).context.reached_at_rung).toBe(4);
  });

  it("'Oh yes.' after the open follow-up is not her memory: nothing is captured", async () => {
    const r = await run([...RECALLED, ["her", "Oh yes."], ["recall", SAID.closeKind]]);
    expect(toolsCalled(r)).not.toContain("capture_contribution");
    expect(r.recording.final_state).toBe("not_stored");
  });
});

describe("a word inside a sentence is not an instruction", () => {
  it.each(["We never wanted to stop at the boardwalk.", "We said goodbye to the house in 1990.", "Please don't stop."])("%s is not a request to stop", async (reply) => {
    expect((await stateOf(reply, AFTER_ELABORATE)).evidence.conduct_signal).toBeNull();
  });
  it.each(["Stop.", "Please stop.", "Goodbye.", "I have to go now.", "No more, thank you.", "Well, that is quite enough for one day I think. Goodbye.", "Stop, I really do not want to do this today."])("%s still is", async (reply) => {
    expect((await stateOf(reply, AFTER_ELABORATE)).evidence.conduct_signal).toBe("stop_request");
  });

  it("'Sorry, we went every summer with Maya and the kids.' is her memory, not a request to repeat", async () => {
    expect((await stateOf("Sorry, we went every summer with Maya and the kids.", AFTER_ELABORATE)).state).toBe("new_detail_offered");
    expect((await stateOf("Sorry, what was that?")).state).toBe("asked_repeat");
    expect((await stateOf("Pardon?")).state).toBe("asked_repeat");
  });
});

describe("who Recall is, asked at any point (rule 16)", () => {
  it("at the store question: the identity line, then the question once more - and her yes still counts", async () => {
    const r = await run([...UP_TO_STORE_QUESTION, ["her", "Who is this?"], ["recall", SAID.identity], ["recall", SAID.storeQuestion], ["her", "Yes."], ["recall", SAID.shareQuestion], ["her", "No."], ["recall", SAID.closeWarm]]);
    expect(spokenText(r)).toContain(SAID.identity);
    expect(r.recording.final_state).toBe("stored");
  });

  it("after the recognition rung: her answer is still read against the two that were offered", async () => {
    const r = await run([...UP_TO_ASSOCIATION, ["her", "I'm not sure."], ["recall", SAID.rung4], ["her", "Who is this?"], ["recall", SAID.identity], ["her", "My daughter."], ["recall", SAID.elaborate], ...CAPTURE_AND_CONFIRM()]);
    expect(r.recording.final_state).toBe("stored");
    expect(replay(r.recording.trace).context.reached_at_rung).toBe(4);
  });

  it("a tool that does not respond after the identity line restates the QUESTION, not the identity line", async () => {
    const r = await run([...OPENING, ["her", "Who is this?"], ["recall", SAID.identity], ["her", "Cape May...?"], ["recall", SAID.rung1], ["recall", SAID.closeKind]], { faults: [{ tool: "select_scaffold", on_call: 2, kind: "timeout" }] });
    expect(spokenText(r)).toEqual([SAID.greeting, SAID.rung1, SAID.identity, SAID.rung1, SAID.closeKind]);
  });
});

describe("a stop is read from her words, whatever else fails (rule 12)", () => {
  it("the share tool times out and she had said 'Goodbye.': nothing is stored", async () => {
    const r = await run([...RECALLED, ["her", HER_LINE], ["playback"], ["recall", SAID.storeQuestion], ["her", "Yes."], ["recall", SAID.shareQuestion], ["her", "Goodbye."], ["recall", SAID.stopAck]], { faults: [{ tool: "confirm_share", on_call: 1, kind: "timeout" }] });
    expect(r.recording.final_state).toBe("stopped");
    expect(await newClaims(r)).toEqual([]);
  });
});

describe("the agreed call length, wherever it runs out", () => {
  const lateFrom = (steps: Step[], index: number, atMs: number) => {
    const t = call(steps);
    t.turns.slice(index).forEach((turn, k) => {
      const start = atMs + k * 3000;
      Object.assign(turn, { start_ms: start, end_ms: start + 2000, words: turn.words.map((w, i) => ({ ...w, start_ms: start + i * 100, end_ms: start + i * 100 + 80 })) });
    });
    return t;
  };

  it("during the capture: she is not asked to confirm anything; a kind close, a finished run", async () => {
    const steps: Step[] = [...RECALLED, ["her", HER_LINE], ["recall", SAID.closeKind]];
    const r = await runFixture({ transcript: lateFrom(steps, steps.length - 2, 59_000), policy: policyWith((p) => (p.speech.max_call_minutes = 1)) });
    expect(r.recording.final_state).toBe("no_answer_today");
    expect(spokenText(r)).not.toContain(SAID.storeQuestion);
    expect(spokenText(r).at(-1)).toBe(SAID.closeKind);
  });

  it("during the restate-once fallback: the run still finishes, with its record and receipt", async () => {
    const steps: Step[] = [...OPENING, ["her", "Cape May...?"], ["recall", SAID.rung1], ["recall", SAID.closeKind]];
    const r = await runFixture({ transcript: lateFrom(steps, 3, 59_500), policy: policyWith((p) => (p.speech.max_call_minutes = 1)), faults: [{ tool: "select_scaffold", on_call: 2, kind: "timeout" }] });
    expect(r.recording.final_state).toBe("no_answer_today");
    expect(r.recording.caregiver_receipt).not.toBeNull();
  });

  it("at an identity question: she gets a kind close, never a silent hang-up", async () => {
    const steps: Step[] = [...OPENING, ["her", "Who is this?"], ["recall", SAID.identity], ["recall", SAID.closeKind]];
    const r = await runFixture({ transcript: lateFrom(steps, 3, 61_000), policy: policyWith((p) => (p.speech.max_call_minutes = 1)) });
    expect(r.recording.final_state).toBe("no_answer_today");
    expect(spokenText(r).at(-1)).toBe(SAID.closeKind);
  });
});

describe("a call that was tried counts as a call (rule 5: nobody calls back)", () => {
  const unanswered = async () => {
    const rig = await buildFixtureRig({ transcript: call([...OPENING]) });
    const deps = (rig.service as unknown as { deps: { callDriver: () => CallDriver } }).deps;
    const make = deps.callDriver;
    let rings = 0;
    deps.callDriver = () => {
      const driver = make();
      driver.connect = async () => {
        rings++;
        throw new CallUnavailableError("no answer");
      };
      return driver;
    };
    return { rig, rings: () => rings };
  };

  it("she does not pick up: the next turn of the schedule, five minutes later, does not ring her again", async () => {
    const { rig, rings } = await unanswered();
    expect((await rig.service.runScheduledCall("session:first"))!.recording.final_state).toBe("no_answer_today");
    rig.clock.advance(5 * 60_000);
    const again = await rig.service.runScheduledCall("session:second");
    expect(again!.recording.final_state).toBe("blocked");
    expect(rings()).toBe(1);
    // An unanswered call says nothing about her memory: it leaves no topic outcome, and the family record does not count it.
    expect((await rig.graph.nodesOfType("TopicOutcome")).filter((o) => o.props.session_id === "session:first")).toEqual([]);
  });
});

describe("what she did not confirm is not kept anywhere - the tool log included (rule 8)", () => {
  const wordsOfHers = (r: Awaited<ReturnType<typeof run>>) => JSON.stringify(r.recording.tool_log.map((c) => c.output));

  it("she says no to keeping it: her sentence is gone from the recording's tool log, and how each turn was read stays", async () => {
    const r = await run([...RECALLED, ["her", HER_LINE], ["playback"], ["recall", SAID.storeQuestion], ["her", "No."], ["recall", SAID.closeNotStored]]);
    expect(r.recording.final_state).toBe("not_stored");
    expect(wordsOfHers(r)).not.toMatch(/every summer|my daughter/i);
    expect(r.recording.tool_log.filter((c) => c.tool === "assess_conversation_state").map((c) => (c.output as { state: string }).state)).toContain("new_detail_offered");
  });

  it("she says yes: her confirmed words are kept, as they always were", async () => {
    const r = await run([...RECALLED, ...CAPTURE_AND_CONFIRM()]);
    expect(wordsOfHers(r)).toContain("every summer");
  });

  it("the family's question, and who asked it, never reach the family tool log - its input included", async () => {
    const rig = await buildFixtureRig();
    await rig.service.askAboutHer("What did Mom say about her wedding in New Jersey?", "person:maya");
    const logged = JSON.stringify(rig.service.familyRuntime.log);
    expect(logged).not.toMatch(/What did Mom say|New Jersey|person:maya/);
    expect(rig.service.familyRuntime.log.at(-1)!.input).toEqual({ question: "(not logged)", question_chars: 49, requester_id: "(not logged)" });
  });

  it("the family tool log does not grow for as long as the server runs", async () => {
    const rig = await buildFixtureRig();
    for (let i = 0; i < 520; i++) await rig.service.askAboutHer("How is she?", "person:maya");
    expect(rig.service.familyRuntime.log).toHaveLength(500);
    expect(rig.service.familyRuntime.log.at(-1)!.seq).toBe(520);
  });
});

describe("a line that will not close does not cost the record of the call", () => {
  it("the hang-up fails after an ordinary ending: the call is still on record, and the failure still surfaces", async () => {
    const rig = await buildFixtureRig({ transcript: call([...OPENING, ["her", "Please stop."], ["recall", SAID.stopAck]]) });
    const deps = (rig.service as unknown as { deps: { callDriver: () => CallDriver } }).deps;
    const make = deps.callDriver;
    deps.callDriver = () => Object.assign(make(), { hangUp: () => Promise.reject(new Error("the line would not close")) });
    await expect(rig.service.runScheduledCall("session:stuck")).rejects.toThrow("the line would not close");
    expect((await rig.graph.nodesOfType("Session")).find((s) => s.id === "session:stuck")?.props.outcome).toBe("stopped");
  });
});

describe("the safety alert, when a channel fails", () => {
  const withFailingChannel = async (failures: number) => {
    const rig = await buildFixtureRig({ transcript: call([...OPENING, ["her", "I can't breathe."], ["recall", SAID.safety]]) });
    const send = rig.alerts.send.bind(rig.alerts);
    let left = failures;
    rig.alerts.send = async (alert) => {
      if (left-- > 0) throw new Error("the alert channel is down");
      return send(alert);
    };
    return rig;
  };

  it("fails once: the second try reaches her caregiver", async () => {
    const rig = await withFailingChannel(1);
    expect((await rig.service.runScheduledCall("session:alert"))!.recording.final_state).toBe("safety_handoff");
    expect(rig.alerts.sentTo("person:maya")).toHaveLength(1);
  });

  it("fails twice: she has still heard the safety line, the call is still on record, and the failure surfaces to whoever runs Recall", async () => {
    const rig = await withFailingChannel(2);
    await expect(rig.service.runScheduledCall("session:alert")).rejects.toThrow(/the safety alert could not be sent: the alert channel is down/);
    expect((await rig.graph.nodesOfType("Session")).find((s) => s.id === "session:alert")?.props.outcome).toBe("safety_handoff");
  });
});

describe("what comes up next", () => {
  /** Which topic the ranking would choose now, on the rig's own graph and clock. */
  const nextTopic = async (rig: Awaited<ReturnType<typeof buildFixtureRig>>) => {
    const deps = (rig.service as unknown as { deps: RecallDeps }).deps;
    const ctx = { graph: deps.graph, setup: deps.setup, assets: deps.assets, clock: deps.clock, gate: new GateKeeper(), transcription: deps.transcription, session: newSession("session:peek"), prov: new ProvLog(), script: deps.script, copy: deps.copy, safetyPhrases: deps.safetyPhrases, alerts: deps.alerts, machine: () => createRecallStore().getState().machine } satisfies ToolContext;
    const pick = await new ToolRuntime({ clock: deps.clock, call: ctx }, TOOL_IMPLS).call("get_next_recall_topic", { person_id: "person:susan", schedule_context: { now: deps.clock.iso() } });
    return pick.topic!.topic_id;
  };

  it("a topic she stopped on is not the first thing she hears on the next call (rule 12)", async () => {
    const rig = await buildFixtureRig({ transcript: call([...OPENING, ["her", "Please stop."], ["recall", SAID.stopAck]]) });
    const first = (await rig.service.runScheduledCall("session:stopped"))!;
    expect(first.recording.final_state).toBe("stopped");
    rig.clock.advance(24 * 3_600_000);
    expect(await nextTopic(rig)).not.toBe(first.recording.topic!.topic_id);
  });

  it("clearing the family's per-topic record does not change it (section 6.3)", async () => {
    // Two topics, both with a history of calls: which is due depends on when each last came up.
    const rig = await buildFixtureRig({ policy: policyWith((p) => (p.topics.allow = ["event:cape-may-summers", "place:lincoln-elementary"])) });
    const before = await nextTopic(rig);
    await rig.service.clearTopicRecord();
    expect(await nextTopic(rig)).toBe(before);
    await rig.service.clearRetrievalLayer();
    expect(await nextTopic(rig)).toBe(before);
  });
});

describe("the Weekly Note can be opened more than once", () => {
  it("inside the 7 days the same note comes back, as posted - her shared line included - and nothing new is posted", async () => {
    const r = await runFixture();
    const first = await r.service.weeklyNote("person:maya");
    expect(first.status).toBe("posted");
    expect(first.note!.lines.map((l) => l.kind)).toContain("share");
    const again = await r.service.weeklyNote("person:maya");
    expect(again).toEqual({ status: "cap_reached", note: first.note });
    expect(await r.graph.nodesOfType("WeeklyNote")).toHaveLength(1);
    // Still nothing for someone without access, cap or no cap.
    expect(await r.service.weeklyNote("person:stranger")).toEqual({ status: "no_access", note: null });
  });

  it("a second line she shared in the same week is not lost: it is in the next note", async () => {
    const r = await runFixture({ policy: policyWith((p) => (p.topics.allow = ["event:cape-may-summers"])) });
    r.clock.advance(24 * 3_600_000);
    const second = await r.service.runScheduledCall("session:second");
    expect(second!.recording.final_state).toBe("stored");
    const shares = (await r.graph.nodesOfType("ShareConfirmation")).filter((s) => s.props.decision === "yes");
    expect(shares).toHaveLength(2);

    const note1 = await r.service.weeklyNote("person:maya");
    const at1 = note1.note!.lines.find((l) => l.kind === "share")!.attribution!.share_confirmed_at;
    r.clock.advance(8 * 24 * 3_600_000);
    const note2 = await r.service.weeklyNote("person:maya");
    const at2 = note2.note?.lines.find((l) => l.kind === "share")?.attribution?.share_confirmed_at;
    expect([at1, at2]).toEqual(shares.map((s) => s.props.recorded_at).sort()); // the older one first, then the other - each once
    r.clock.advance(8 * 24 * 3_600_000);
    expect((await r.service.weeklyNote("person:maya")).note?.lines.some((l) => l.kind === "share") ?? false).toBe(false);
  });
});

describe("revoking someone always works, and never quietly stops her calls (rule 12)", () => {
  const withPriya = (patch: (p: Record<string, any>) => void = () => {}) =>
    new SetupStore(policyWith((p) => (p.approved_people.push("person:priya"), patch(p))));

  it("a contributor who had granted photo access: revoked, and their photo grant goes with them", () => {
    const setup = withPriya((p) => (p.discovery.photo_access_granted_by = ["person:priya"]));
    setup.revokeContributor("person:priya", "2026-11-05T15:30:00.000Z");
    expect(setup.current()).toMatchObject({ approved_people: ["person:maya"], discovery: { photo_access_granted_by: [] } });
  });

  it("the person who introduced Recall to her: that stays a fact about the past, and her calls go on", () => {
    const setup = withPriya((p) => (p.attestations.introduced_by = "person:priya"));
    setup.revokeContributor("person:priya", "2026-11-05T15:30:00.000Z");
    expect(attestationsMissing(setup.current())).toEqual([]);
  });

  it("an introduction by someone who was never in the setup at all is still refused", () => {
    expect(attestationsMissing(policySchema.parse(policyWith((p) => (p.attestations.introduced_by = "person:stranger"))))).toEqual(["Recall was introduced by someone who is not an approved person"]);
  });
});

describe("a setup that could never place a call is refused when it is written, not discovered at 9 a.m.", () => {
  it.each([
    ["a window that ends before it starts", (p: Record<string, any>) => (p.call_windows = [{ days: ["mon"], start: "22:00", end: "02:00" }]), /ends after it starts/],
    ["a window on no days", (p: Record<string, any>) => (p.call_windows = [{ days: [], start: "09:00", end: "12:00" }]), /./],
    ["a timezone that does not exist", (p: Record<string, any>) => (p.timezone = "America/New_Yrok"), /timezone/],
  ])("%s", (_what, patch, message) => {
    expect(() => policySchema.parse(policyWith(patch))).toThrow(message);
  });
});

describe("what opens the family side can never cause a call (rule 5)", () => {
  const withEnv = async (env: Record<string, string | undefined>, check: () => void | Promise<void>) => {
    const before = { ...process.env };
    Object.assign(process.env, env);
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
    try {
      await check();
    } finally {
      for (const k of Object.keys(env)) before[k] === undefined ? delete process.env[k] : (process.env[k] = before[k]);
    }
  };
  const request = (headers: Record<string, string>) => new Request("http://recall.test/", { headers });

  it("the family key opens the family routes and not the schedule; the operator key opens both", async () => {
    const { isFamily, isOperator } = await import("@/server/operator");
    await withEnv({ NODE_ENV: "production", RECALL_OPERATOR_SECRET: "op-secret", RECALL_FAMILY_SECRET: "fam-secret" }, () => {
      expect([isFamily(request({ "x-recall-family": "fam-secret" })), isOperator(request({ "x-recall-family": "fam-secret" }))]).toEqual([true, false]);
      expect(isOperator(request({ "x-recall-operator": "fam-secret" }))).toBe(false); // nor by sending it under the other name
      expect([isFamily(request({ "x-recall-operator": "op-secret" })), isOperator(request({ "x-recall-operator": "op-secret" }))]).toEqual([true, true]);
      expect([isFamily(request({})), isOperator(request({}))]).toEqual([false, false]);
    });
  });

  it("in production with nothing configured, nobody gets in; and one key used for both is not accepted as a family key", async () => {
    const { isFamily, isOperator } = await import("@/server/operator");
    await withEnv({ NODE_ENV: "production", RECALL_OPERATOR_SECRET: undefined, RECALL_FAMILY_SECRET: undefined }, () => expect([isFamily(request({})), isOperator(request({}))]).toEqual([false, false]));
    await withEnv({ NODE_ENV: "production", RECALL_OPERATOR_SECRET: "same", RECALL_FAMILY_SECRET: "same" }, () => expect(isFamily(request({ "x-recall-family": "same" }))).toBe(false));
  });
});

describe("a tie between people is filtered like any other fact", () => {
  const source = (patch: Record<string, unknown>) => ({ "artifact:private-note": { source_class: "family_contribution" as const, asset_id: null, observed_at: "2026-10-30T12:00:00.000Z", author: "person:maya", extraction_method: "family_form" as const, confidence: 1, audience_scope: ["person:susan"], expires_at: null, ...patch } });
  const note = { id: "artifact:private-note", type: "Artifact" as const, label: "A note", props: { kind: "family_story", text: "Anika is her granddaughter.", alt: null }, source: "artifact:private-note" };
  const tie = { type: "RELATED_TO" as const, from: "person:susan", to: "person:anika", source: "artifact:private-note", props: { relation: "grandchild", said_as: "granddaughter" } };
  const permitted = { type: "PERMITTED_IN" as const, from: "artifact:private-note", to: "policy:susan-setup", source: "artifact:setup-record" };
  const relationsFound = async (b: Awaited<ReturnType<typeof bench>>) => (b.runtime.log.find((c) => c.tool === "query_context_graph")!.output as { relations: Array<{ edge_id: string }> }).relations.map((r) => r.edge_id);
  const EDGE = "RELATED_TO:person:susan->person:anika";

  it("from a source that is not for her ears, or that the setup never permitted: not retrieved, so never spoken", async () => {
    expect(await relationsFound(await bench({ overlays: [overlay("permitted and in scope", [note], [tie, permitted], source({}))] }))).toContain(EDGE);
    expect(await relationsFound(await bench({ overlays: [overlay("out of audience", [note], [tie, permitted], source({ audience_scope: [] }))] }))).not.toContain(EDGE);
    expect(await relationsFound(await bench({ overlays: [overlay("never permitted", [note], [tie], source({}))] }))).not.toContain(EDGE);
  });

  it("a family member's word for a tie is never one of the two options at the recognition rung (rule 13)", async () => {
    // Maya once called herself Susan's "friend" when answering a question. It stands as Maya's claim - and rung 4 still offers Susan's own words.
    const rig = await buildFixtureRig({ transcript: call([...UP_TO_ASSOCIATION, ["her", "I'm not sure."], ["recall", SAID.rung4], ["her", "My daughter."], ["recall", SAID.elaborate], ...CAPTURE_AND_CONFIRM()]) });
    const mayas = (await rig.graph.getEdge("RELATED_TO:person:maya->event:cape-may-summers"))!;
    await rig.graph.putEdge({ id: "RELATED_TO:friend:person:susan->person:maya", type: "RELATED_TO", from: "person:susan", to: "person:maya", props: { relation: "friend", said_as: "friend" }, prov: mayas.prov });
    const r = (await rig.service.runScheduledCall("session:rung4"))!;
    expect(r.recording.spoken.map((s) => s.text)).toContain(SAID.rung4); // "...your daughter or your sister?" - never "your friend"
    expect(r.recording.final_state).toBe("stored");
  });
});

describe("revoking a contributor takes effect before the next call (rule 12)", () => {
  it("what they told Recall is no longer offered to her as a cue", async () => {
    const before = await bench();
    expect(before.verified).toContain("claim:maya-remembers-cape-may");
    const after = await bench({ policy: policyWith((p) => ((p.approved_people = ["person:priya"]), (p.recall_set_up_by = "person:priya"), (p.safety.designated_caregivers = [{ person_id: "person:priya", alert_channel: "dashboard" }]), (p.attestations.introduced_by = "person:priya"), (p.dashboard.grants = []))) });
    expect(after.verified).not.toContain("claim:maya-remembers-cape-may");
    const out = after.runtime.log.find((c) => c.tool === "verify_claim_support")!.output as { rejected: Array<{ claim_id: string; reason: string }> };
    expect(out.rejected.find((r) => r.claim_id === "claim:maya-remembers-cape-may")?.reason).toBe("contributor_not_approved");
  });
});

describe("a seed cannot declare something to be her confirmed word", () => {
  const claimFrom = (sourcePatch: Record<string, unknown>) =>
    overlay("a claim", [{ id: "artifact:x", type: "Artifact", label: "A note", props: { kind: "family_story", text: "A story.", alt: null }, source: "artifact:x" }], [], { "artifact:x": { source_class: "family_contribution", asset_id: null, observed_at: "2026-10-30T12:00:00.000Z", author: "person:maya", extraction_method: "family_form", confidence: 1, audience_scope: ["person:susan"], expires_at: null, ...sourcePatch } as never });

  it("a family contribution marked participant_confirmed is refused; marked inferred, it is accepted", async () => {
    await expect(buildFixtureRig({ overlays: [claimFrom({ status: "participant_confirmed" })] })).rejects.toThrow(/above what a family_contribution source starts as/);
    await expect(buildFixtureRig({ overlays: [claimFrom({ status: "inferred" })] })).resolves.toBeDefined();
  });

  it("a 'prior claim' of hers whose author is somebody else is refused", async () => {
    await expect(buildFixtureRig({ overlays: [claimFrom({ source_class: "prior_claim_with_source", extraction_method: "literal_transcript" })] })).rejects.toThrow(/author "person:maya" is not the participant/);
  });
});

describe("two people open the dashboard at the same moment", () => {
  it("both get their note; neither request fails on the other's write", async () => {
    const r = await runFixture({ policy: policyWith((p) => (p.approved_people.push("person:priya"), p.dashboard.grants.push({ member_id: "person:priya", detail_level: "weekly_note", granted_at: "2026-10-12T15:00:00.000Z", revoked_at: null }))) });
    const [maya, priya] = await Promise.all([r.service.weeklyNote("person:maya"), r.service.weeklyNote("person:priya")]);
    expect([maya.status, priya.status]).toEqual(["posted", "posted"]);
    expect((await r.graph.nodesOfType("WeeklyNote")).map((n) => n.props.member_id).sort()).toEqual(["person:maya", "person:priya"]);
  });
});

describe("discovery that is off is off", () => {
  it("an answer is not read, and nothing is written, unless the joint setup turned discovery on", async () => {
    const rig = await buildFixtureRig(); // the judged setup has it off
    const before = (await rig.graph.snapshot()).nodes.length;
    const question = { id: "q", gap: { kind: "unidentified" }, expects: "Person" } as never;
    await expect(rig.service.answerQuestion(question, { answer_id: "a1", by: "person:susan", text: "That's my daughter Maya.", at: rig.clock.iso() } as never)).rejects.toThrow(/not turned on/);
    expect((await rig.graph.snapshot()).nodes.length).toBe(before);
  });
});
