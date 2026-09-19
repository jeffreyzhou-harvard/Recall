/** AGENTS.md section 5: the reducer's invariants, tested on the reducer alone. */
import { describe, expect, it } from "vitest";
import { SAFETY_PHRASES } from "@/fixtures";
import { matchSafetyPhrase } from "@/lib/safety/phrases";
import { IN_CALL, MAIN_LINE, NON_TERMINAL, SAFE_ENDINGS, TERMINAL, TRANSITIONS, type RecallEvent, type RecallState } from "@/lib/state/machine";
import { InvalidTransitionError, initialState, reduce, reduceStrict, replay, type MachineState } from "@/lib/state/reducer";
import { createRecallStore } from "@/lib/state/store";

const H = "a".repeat(64);
const at = (s: number): { at: string } => ({ at: new Date(Date.parse("2026-11-05T15:30:00.000Z") + s * 1000).toISOString() });
const GOLDEN: RecallEvent[] = [
  { type: "CALL_SCHEDULED", person_id: "person:susan", topic_id: "event:x", topic_label: "X", family_sourced: false, reorientation_allowed: false },
  { type: "POLICY_GRANTED", policy_token_id: "token:1", max_call_minutes: 12 },
  { type: "CALL_CONNECTED", session_id: "session:1" },
  { type: "GREETING_DELIVERED", prompt_id: "p1", discloses_ai: true },
  { type: "TOPIC_SELECTED", topic_id: "event:x", citations: ["event:x"] },
  { type: "RUNG_DELIVERED", rung: 1, prompt_id: "p2", citations: ["event:x"], cue_id: null },
  { type: "TURN_ASSESSED", turn_id: "t1", turn_state: "no_answer", silent: false },
  { type: "RUNG_DELIVERED", rung: 2, prompt_id: "p3", citations: ["event:x"], cue_id: null },
  { type: "TURN_ASSESSED", turn_id: "t2", turn_state: "recalled", silent: false },
  { type: "TURN_ASSESSED", turn_id: "t3", turn_state: "new_detail_offered", silent: false },
  { type: "CONTRIBUTION_CAPTURED", contribution_hash: H, trims: 2, generated_first_person_words: 0 },
  { type: "STORE_CONFIRMATION_RECORDED", confirmation_id: "c1", decision: "yes", contribution_hash: H },
  { type: "SHARE_CONFIRMATION_RECORDED", confirmation_id: "c2", decision: "yes", contribution_hash: H },
  { type: "CONTRIBUTION_STORED", claim_id: "claim:1", contribution_hash: H, shared: true },
];
/** The machine after the first `n` golden events. */
const upTo = (n: number): MachineState => GOLDEN.slice(0, n).reduce((m, e, i) => reduceStrict(m, e, at(i)), initialState());
/** One machine parked in each non-terminal state. */
const parkedIn = (state: RecallState): MachineState => {
  for (let n = 0; n <= GOLDEN.length; n++) if (upTo(n).state === state) return upTo(n);
  throw new Error(`the golden walk never rests in ${state}`);
};
const lost = (): MachineState => parkedIn("lost");

describe("the transition table", () => {
  it("has one row per state, and the terminal states are absorbing", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...MAIN_LINE, ...SAFE_ENDINGS].sort());
    expect([...TERMINAL].sort()).toEqual(["blocked", "no_answer_today", "not_stored", "safety_handoff", "stopped", "stored"]);
    for (const state of TERMINAL) expect(TRANSITIONS[state]).toEqual({});
    const done = upTo(GOLDEN.length);
    expect(done.state).toBe("stored");
    for (const e of [...GOLDEN, { type: "STOP", how: "hang_up" } as RecallEvent, { type: "SAFETY_MATCHED", category: "fall" } as RecallEvent]) expect(reduce(done, e, at(99)).state).toBe("stored");
  });

  it("walks the golden line, and a replay of the trace rebuilds every state exactly", () => {
    const done = upTo(GOLDEN.length);
    expect(done.trace.every((t) => t.accepted)).toBe(true);
    expect(replay(done.trace)).toEqual(done);
    expect(replay(done.trace, at(5).at).state).toBe("asking");
  });

  it("an unknown (state, event) pair throws AND logs, and changes nothing", () => {
    const store = createRecallStore();
    expect(() => store.getState().dispatch(GOLDEN[5]!, at(0))).toThrow(InvalidTransitionError);
    const { machine } = store.getState();
    expect(machine.state).toBe("idle");
    expect(machine.trace).toHaveLength(1);
    expect(machine.trace[0]).toMatchObject({ accepted: false, event: "RUNG_DELIVERED", from: "idle", to: "idle" });
  });
});

describe("she can always stop it", () => {
  it.each(NON_TERMINAL)("from %s", (state) => {
    for (const how of ["hang_up", "explicit_stop", "caregiver_pause"] as const) {
      const next = reduceStrict(parkedIn(state), { type: "STOP", how }, at(60));
      expect(next.state).toBe("stopped");
      expect(next.context).toMatchObject({ stop_how: how, claim_id: null });
    }
  });
});

describe("the safety handoff", () => {
  const phrases = Object.entries(SAFETY_PHRASES.categories).flatMap(([category, c]) => c.phrases.map((p) => [category, p] as const));

  it.each(IN_CALL)("every phrase on the list, as a final turn of hers in %s, reaches safety_handoff", (state) => {
    for (const [category, phrase] of phrases) {
      const match = matchSafetyPhrase(SAFETY_PHRASES, `Well, ${phrase}, you know.`);
      expect(match, phrase).toEqual({ category, list_phrase: phrase });
      const next = reduceStrict(parkedIn(state), { type: "SAFETY_MATCHED", category: match!.category }, at(60));
      expect(next.state).toBe("safety_handoff");
      expect(next.context).toMatchObject({ safety_category: category, claim_id: null });
    }
  });

  it("comes only from a turn of hers: before anyone is on the line it is refused", () => {
    for (const state of ["idle", "scheduled", "policy_passed"] as const) expect(() => reduceStrict(parkedIn(state), { type: "SAFETY_MATCHED", category: "fall" }, at(1))).toThrow(/only during a call/);
  });

  it("is a whole-phrase match on her words: 'I fell' fires, 'fellow' does not", () => {
    expect(matchSafetyPhrase(SAFETY_PHRASES, "I fell in love with Maya")?.category).toBe("fall"); // the accepted false positive
    expect(matchSafetyPhrase(SAFETY_PHRASES, "A fellow teacher from Lincoln")).toBeNull();
    expect(matchSafetyPhrase(SAFETY_PHRASES, "We went to Cape May every summer")).toBeNull();
  });
});

describe("the ladder's order, enforced here as well as in select_scaffold", () => {
  const rung = (n: 1 | 2 | 3 | 4 | 5): RecallEvent => ({ type: "RUNG_DELIVERED", rung: n, prompt_id: `p${n}`, citations: [], cue_id: null });

  it("a call never opens above rung 1", () => {
    for (const n of [2, 3, 4, 5] as const) expect(() => reduceStrict(parkedIn("topic_selected"), rung(n), at(9))).toThrow(/never starts above rung 1/);
  });

  it("an autobiographical memory is never stated outright, whatever has fired", () => {
    expect(() => reduceStrict(lost(), rung(5), at(9))).toThrow(/never used for an autobiographical or identity memory/);
    const all = [2, 3, 4].reduce((m, n, i) => reduceStrict(reduceStrict(m, rung(n as 2 | 3 | 4), at(9 + 2 * i)), { type: "TURN_ASSESSED", turn_id: `t${n}`, turn_state: "no_answer", silent: false }, at(10 + 2 * i)), lost());
    expect(all.context.rungs_fired).toEqual([1, 2, 3, 4]);
    expect(() => reduceStrict(all, rung(5), at(20))).toThrow(/never used for an autobiographical or identity memory/);
    expect(reduceStrict(all, { type: "LADDER_EXHAUSTED", reason: "nothing more" }, at(20)).state).toBe("no_answer_today");
  });

  it("where the last rung is allowed at all, it never jumps the queue; and a rung is never repeated or revisited", () => {
    const procedural = [{ ...GOLDEN[0]!, reorientation_allowed: true } as RecallEvent, ...GOLDEN.slice(1, 7)].reduce((m, e, i) => reduceStrict(m, e, at(i)), initialState());
    expect(() => reduceStrict(procedural, rung(5), at(9))).toThrow(/rungs 1-4 have each been tried/);
    expect(() => reduceStrict(lost(), rung(1), at(9))).toThrow(/at most once/);
    const afterThree = reduceStrict(reduceStrict(reduceStrict(lost(), rung(2), at(9)), { type: "TURN_ASSESSED", turn_id: "t", turn_state: "no_answer", silent: false }, at(10)), rung(4), at(11));
    expect(afterThree.context.rungs_fired).toEqual([1, 2, 4]);
    const back = reduceStrict(afterThree, { type: "TURN_ASSESSED", turn_id: "u", turn_state: "no_answer", silent: false }, at(12));
    expect(() => reduceStrict(back, rung(3), at(13))).toThrow(/below rung 4/);
    expect(() => reduceStrict(back, rung(5), at(13))).toThrow(/never used for an autobiographical/);
  });

  it("stops at rung 3 for a family-sourced, unconfirmed topic", () => {
    const family = [{ ...GOLDEN[0]!, family_sourced: true } as RecallEvent, ...GOLDEN.slice(1, 7)].reduce((m, e, i) => reduceStrict(m, e, at(i)), initialState());
    const atThree = reduceStrict(reduceStrict(reduceStrict(family, rung(2), at(9)), { type: "TURN_ASSESSED", turn_id: "t", turn_state: "no_answer", silent: false }, at(10)), rung(3), at(11));
    const stillLost = reduceStrict(atThree, { type: "TURN_ASSESSED", turn_id: "u", turn_state: "no_answer", silent: false }, at(12));
    for (const n of [4, 5] as const) expect(() => reduceStrict(stillLost, rung(n), at(13))).toThrow(/rule 13/);
    expect(reduceStrict(stillLost, { type: "LADDER_EXHAUSTED", reason: "nothing more" }, at(13)).state).toBe("no_answer_today");
  });

  it("two quiet windows end the topic gently; spoken misses keep climbing", () => {
    const quiet: RecallEvent = { type: "TURN_ASSESSED", turn_id: "s", turn_state: "no_answer", silent: true };
    const once = reduceStrict(parkedIn("asking"), quiet, at(9));
    expect(once.state).toBe("lost");
    expect(reduceStrict(reduceStrict(once, rung(2), at(10)), quiet, at(11)).state).toBe("no_answer_today");
  });
});

describe("the greeting comes first, and commit comes last", () => {
  it("nothing can be said before Recall has said what it is", () => {
    expect(() => reduceStrict(upTo(3), GOLDEN[4]!, at(3))).toThrow(/AI-assistant disclosure/); // connected, not yet greeted
    expect(reduceStrict(upTo(4), GOLDEN[4]!, at(3)).state).toBe("topic_selected");
    expect(() => reduceStrict(upTo(4), GOLDEN[3]!, at(3))).toThrow(/said once/);
  });

  it("refuses to store before the share question resolves, for a different hash, or with a different share flag", () => {
    const confirmed = upTo(12);
    expect(() => reduceStrict(confirmed, GOLDEN[13]!, at(20))).toThrow(/commit comes last/);
    const resolved = reduceStrict(confirmed, { type: "SHARE_CONFIRMATION_RECORDED", confirmation_id: "c2", decision: "no", contribution_hash: H }, at(20));
    expect(() => reduceStrict(resolved, { ...GOLDEN[13]!, contribution_hash: "b".repeat(64) } as RecallEvent, at(21))).toThrow(/does not match the confirmed/);
    expect(() => reduceStrict(resolved, GOLDEN[13]!, at(21))).toThrow(/share flag/); // she said no; "shared: true" is refused
    expect(reduceStrict(resolved, { ...GOLDEN[13]!, shared: false } as RecallEvent, at(21)).state).toBe("stored");
  });

  it("a no, or an unclear answer, to the store question keeps nothing; no answer to the share question never blocks storing", () => {
    for (const decision of ["no", "unclear"] as const) expect(reduceStrict(upTo(11), { type: "STORE_CONFIRMATION_RECORDED", confirmation_id: "c", decision, contribution_hash: H }, at(20)).state).toBe("not_stored");
    const timedOut = reduceStrict(upTo(12), { type: "TOOL_TIMEOUT", tool: "confirm_share" }, at(20));
    expect(timedOut).toMatchObject({ state: "confirmed", context: { share_resolved: true, shared: false } });
  });

  it("generated first-person words can never enter: a capture that reports any is refused", () => {
    expect(() => reduceStrict(upTo(10), { type: "CONTRIBUTION_CAPTURED", contribution_hash: H, trims: 0, generated_first_person_words: 1 }, at(20))).toThrow(/generated first-person/);
  });
});

describe("failure transitions are deterministic", () => {
  it("a missing gate: never placed before the call, narrowed during it, nothing kept after capture", () => {
    const gate: RecallEvent = { type: "GATE_MISSING", gate: "evidence", detail: "x" };
    expect(reduceStrict(parkedIn("policy_passed"), gate, at(1)).state).toBe("blocked");
    expect(reduceStrict(parkedIn("reanchored"), gate, at(30)).state).toBe("no_answer_today");
    expect(reduceStrict(parkedIn("confirming"), gate, at(30)).state).toBe("not_stored");
  });

  it("a tool timeout mid-call: the fixed script restates once, then closes", () => {
    const fallback = reduceStrict(lost(), { type: "TOOL_TIMEOUT", tool: "select_scaffold" }, at(30));
    expect(fallback).toMatchObject({ state: "lost", context: { fallback_active: true } });
    expect(() => reduceStrict(fallback, { type: "RUNG_DELIVERED", rung: 2, prompt_id: "p", citations: [], cue_id: null }, at(31))).toThrow(/fixed script is running/);
    const restated = reduceStrict(fallback, { type: "FIXED_RESTATEMENT_DELIVERED", prompt_id: "p2" }, at(31));
    expect(() => reduceStrict(restated, { type: "FIXED_RESTATEMENT_DELIVERED", prompt_id: "p2" }, at(32))).toThrow(/once only/);
    expect(reduceStrict(restated, { type: "CALL_CLOSED" }, at(33)).state).toBe("no_answer_today");
  });

  it("the agreed call length: past it the conversation becomes the kind close - but a stop, a safety match, and a confirmation under way are untouched", () => {
    const late = at(12 * 60 + 30);
    expect(reduce(parkedIn("asking"), GOLDEN[6]!, late)).toMatchObject({ state: "no_answer_today", context: { ending_reason: "the agreed call length was reached" } });
    expect(reduce(parkedIn("asking"), { type: "STOP", how: "hang_up" }, late).state).toBe("stopped");
    expect(reduce(parkedIn("asking"), { type: "SAFETY_MATCHED", category: "fall" }, late).state).toBe("safety_handoff");
    expect(reduce(parkedIn("confirming"), GOLDEN[11]!, late).state).toBe("confirmed");
  });
});
