/** The reducer on its own: no tools, no fixtures. It must hold the line even if everything around it is wrong. */
import { describe, expect, it } from "vitest";
import { CALL_PHASE, MAIN_LINE, SAFE_ENDINGS, TERMINAL, TRANSITIONS, type RelayEvent, type RelayState } from "@/lib/state/machine";
import { initialState, reduce, replay, visitedStates, type MachineState } from "@/lib/state/reducer";
import { createRelayStore } from "@/lib/state/store";

const AT = "2026-11-05T17:30:00.000Z";
const HASH = "a".repeat(64);
const THREAD = "artifact:thread-family";

const play = (events: RelayEvent[], from: MachineState = initialState()): MachineState =>
  events.reduce((m, e) => reduce(m, e, { at: AT }), from);

const TO_FOLLOWING: RelayEvent[] = [
  { type: "ASK_FORWARDED", ask_id: "ask:1", thread_id: THREAD, asker_id: "person:anika", addressee_id: "person:mom" },
  { type: "POLICY_GRANTED", policy_token_id: "token:1", audience: THREAD },
  { type: "CALL_CONNECTED", session_id: "session:1" },
  { type: "BRIEF_DELIVERED", prompt_id: "prompt:1", citations: ["person:anika"] },
];
const TO_PLAYBACK: RelayEvent[] = [
  ...TO_FOLLOWING,
  { type: "TURN_ASSESSED", turn_id: "p2", turn_state: "answer_present" },
  { type: "CONTRIBUTION_CAPTURED", contribution_hash: HASH, trims: 3, generated_first_person_words: 0 },
  { type: "PLAYBACK_STARTED", contribution_hash: HASH },
];
const YES: RelayEvent = { type: "ASSENT_RECORDED", assent_id: "assent:1", decision: "yes", contribution_hash: HASH, audience: THREAD };
const PUBLISH: RelayEvent = { type: "PUBLISHED", delivery_id: "delivery:1", contribution_hash: HASH, destination: THREAD };

describe("transition table", () => {
  it("covers every state, and no terminal state has a way out", () => {
    const all: RelayState[] = [...MAIN_LINE, ...SAFE_ENDINGS, "fallback"];
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...all].sort());
    for (const state of TERMINAL) expect(Object.keys(TRANSITIONS[state])).toEqual([]);
  });

  it("nests the call session: brief -> ask -> support -> capture -> confirm", () => {
    expect(CALL_PHASE).toMatchObject({ connected: "brief", following: "ask", lost: "support", reanchored: "support", contributed: "capture", playback: "confirm", assented: "confirm" });
    expect(CALL_PHASE.idle).toBeUndefined();
    expect(CALL_PHASE.delivered).toBeUndefined();
  });
});

describe("reducer", () => {
  it("is pure: the input state is never mutated", () => {
    const before = initialState();
    const frozen = JSON.stringify(before);
    reduce(before, TO_FOLLOWING[0]!, { at: AT });
    expect(JSON.stringify(before)).toBe(frozen);
  });

  it("rejects an out-of-order event, changes nothing, and records the attempt", () => {
    const m = play([TO_FOLLOWING[0]!, PUBLISH]);
    expect(m.state).toBe("ask_received");
    expect(m.context.delivery_id).toBeNull();
    expect(m.trace.at(-1)).toMatchObject({ accepted: false, from: "ask_received", to: "ask_received", event: "PUBLISHED" });
  });

  it("cannot be walked to delivered by skipping assent", () => {
    const m = play([...TO_PLAYBACK, PUBLISH]);
    expect(m.state).toBe("playback");
    expect(visitedStates(m)).not.toContain("delivered");
  });

  it("refuses assent for a different hash or a different audience", () => {
    expect(play([...TO_PLAYBACK, { ...YES, contribution_hash: "b".repeat(64) } as RelayEvent]).state).toBe("playback");
    expect(play([...TO_PLAYBACK, { ...YES, audience: "person:anika" } as RelayEvent]).state).toBe("playback");
  });

  it("refuses to publish a different hash or to a different destination, even after a yes", () => {
    expect(play([...TO_PLAYBACK, YES, { ...PUBLISH, contribution_hash: "b".repeat(64) } as RelayEvent]).state).toBe("assented");
    expect(play([...TO_PLAYBACK, YES, { ...PUBLISH, destination: "person:anika" } as RelayEvent]).state).toBe("assented");
    expect(play([...TO_PLAYBACK, YES, PUBLISH]).state).toBe("delivered");
  });

  it("treats no and unclear the same way: nothing sends", () => {
    for (const decision of ["no", "unclear"] as const) {
      const m = play([...TO_PLAYBACK, { ...YES, decision } as RelayEvent, PUBLISH]);
      expect(m.state).toBe("not_sent");
      expect(m.context.assent_id).toBeNull();
    }
  });

  it("invalidates approval when content or audience changes after it", () => {
    for (const what of ["content", "audience"] as const) {
      const m = play([...TO_PLAYBACK, YES, { type: "CONTENT_OR_AUDIENCE_CHANGED", what }, PUBLISH]);
      expect(m.state).toBe("not_sent");
      expect(m.context.assent_id).toBeNull();
    }
  });

  it("refuses a contribution that carries any generated first-person word", () => {
    const m = play([
      ...TO_FOLLOWING,
      { type: "TURN_ASSESSED", turn_id: "p2", turn_state: "answer_present" },
      { type: "CONTRIBUTION_CAPTURED", contribution_hash: HASH, trims: 0, generated_first_person_words: 1 },
    ]);
    expect(m.state).toBe("following");
    expect(m.trace.at(-1)!.accepted).toBe(false);
  });

  it("will not capture before an answer has been assessed", () => {
    const m = play([...TO_FOLLOWING, { type: "CONTRIBUTION_CAPTURED", contribution_hash: HASH, trims: 0, generated_first_person_words: 0 }]);
    expect(m.state).toBe("following");
  });

  it("wraps up on the second lost-thread signal, whichever kind it is", () => {
    const lost = (s: "asked_repeat" | "no_answer"): RelayEvent => ({ type: "TURN_ASSESSED", turn_id: "t", turn_state: s });
    const scaffold: RelayEvent = { type: "SCAFFOLD_DELIVERED", scaffold_id: "restate_options", prompt_id: "prompt:2", citations: [] };
    expect(play([...TO_FOLLOWING, lost("asked_repeat")]).state).toBe("lost");
    const m = play([...TO_FOLLOWING, lost("asked_repeat"), scaffold, lost("no_answer")]);
    expect(m.state).toBe("wrapped_up");
    expect(m.context.ending_reason).toBe("no answer today");
  });

  it("sends a missing gate to the right safe ending for where the flow is", () => {
    const gate: RelayEvent = { type: "GATE_MISSING", gate: "evidence", detail: "x" };
    expect(play([TO_FOLLOWING[0]!, gate]).state).toBe("blocked");
    expect(play([...TO_FOLLOWING, gate]).state).toBe("narrowed");
    expect(play([...TO_PLAYBACK, gate]).state).toBe("not_sent");
  });

  it("decides what the family is told: clarify when something they can supply is missing, otherwise not this time", () => {
    const gate: RelayEvent = { type: "GATE_MISSING", gate: "identity", detail: "x" };
    const notice = (events: RelayEvent[]) => play(events).context.family_notice;
    expect(notice([gate])).toBe("clarify"); // intake could not even record the ask
    expect(notice([TO_FOLLOWING[0]!, gate])).toBe("clarify"); // spec X: stop safely, ask family to clarify
    expect(notice([...TO_FOLLOWING, gate])).toBe("clarify"); // Relay told her it would ask Anika to clarify
    expect(notice([TO_FOLLOWING[0]!, { type: "POLICY_DENIED", reason: "topic_blocked" }])).toBe("not_this_time"); // spec Y
    expect(notice([...TO_PLAYBACK, { ...YES, decision: "unclear" } as RelayEvent])).toBe("not_this_time"); // spec W
    expect(notice([...TO_PLAYBACK, YES, PUBLISH])).toBeNull();
  });

  it("gives every safe ending a notice, so the family is never left without a reply", () => {
    const lost: RelayEvent = { type: "TURN_ASSESSED", turn_id: "t", turn_state: "no_answer" };
    const scaffold: RelayEvent = { type: "SCAFFOLD_DELIVERED", scaffold_id: "repeat", prompt_id: "p", citations: [] };
    const timeout: RelayEvent = { type: "TOOL_TIMEOUT", tool: "select_scaffold" };
    const endings: RelayEvent[][] = [
      [TO_FOLLOWING[0]!, { type: "POLICY_DENIED", reason: "x" }],
      [...TO_FOLLOWING, { type: "GATE_MISSING", gate: "evidence", detail: "x" }],
      [...TO_FOLLOWING, lost, scaffold, lost],
      [...TO_PLAYBACK, { ...YES, decision: "no" } as RelayEvent],
      [...TO_FOLLOWING, timeout, { type: "FIXED_RESTATEMENT_DELIVERED", prompt_id: "p" }, { type: "CALL_CLOSED" }],
    ];
    expect(endings.map((e) => play(e).state).sort()).toEqual([...SAFE_ENDINGS].sort());
    for (const events of endings) expect(play(events).context.family_notice).not.toBeNull();
  });

  it("replays: a trace carries its events, so re-reducing it rebuilds every state, or any moment in between", () => {
    const stamped = [...TO_PLAYBACK, YES, PUBLISH].reduce(
      (m, e, i) => reduce(m, e, { at: `2026-11-05T17:30:${String(i).padStart(2, "0")}.000Z` }),
      initialState(),
    );
    expect(replay(stamped.trace)).toEqual(stamped);
    expect(replay(stamped.trace, "2026-11-05T17:30:03.000Z").state).toBe("following");
    expect(replay(stamped.trace, "2026-11-05T17:29:00.000Z")).toEqual(initialState());
  });

  it("sends a tool timeout to the right place: not placed, fixed script, or not sent", () => {
    const timeout: RelayEvent = { type: "TOOL_TIMEOUT", tool: "select_scaffold" };
    expect(play([TO_FOLLOWING[0]!, timeout]).state).toBe("blocked");
    expect(play([...TO_PLAYBACK, timeout]).state).toBe("not_sent");
    const inCall = play([...TO_FOLLOWING, timeout]);
    expect(inCall.state).toBe("fallback");
    // The fixed script restates once only, and cannot close before it has.
    expect(play([{ type: "CALL_CLOSED" }], inCall).state).toBe("fallback");
    const restated = play([{ type: "FIXED_RESTATEMENT_DELIVERED", prompt_id: "prompt:1" }], inCall);
    expect(play([{ type: "FIXED_RESTATEMENT_DELIVERED", prompt_id: "prompt:1" }], restated).trace.at(-1)!.accepted).toBe(false);
    expect(play([{ type: "CALL_CLOSED" }], restated).state).toBe("closed_kindly");
  });

  it("narrows evidence on conflicting claims without moving the flow", () => {
    const m = play([TO_FOLLOWING[0]!, TO_FOLLOWING[1]!, { type: "CLAIMS_CONFLICT", claim_ids: ["claim:a", "claim:b"] }]);
    expect(m.state).toBe("policy_passed");
    expect(m.context.evidence_mode).toBe("current_ask_only");
  });

  it("absorbs every event once terminal", () => {
    const done = play([...TO_PLAYBACK, YES, PUBLISH]);
    const after = play([TO_FOLLOWING[0]!, { type: "GATE_MISSING", gate: "policy", detail: "x" }, PUBLISH], done);
    expect(after.state).toBe("delivered");
    expect(after.trace.slice(-3).every((t) => !t.accepted)).toBe(true);
  });
});

describe("store", () => {
  it("is the reducer plus subscription, nothing more", () => {
    const store = createRelayStore();
    const seen: RelayState[] = [];
    store.subscribe((s) => seen.push(s.machine.state));
    for (const e of TO_FOLLOWING) store.getState().dispatch(e, { at: AT });
    expect(seen).toEqual(["ask_received", "policy_passed", "connected", "following"]);
    expect(store.getState().machine).toEqual(play(TO_FOLLOWING));
    store.getState().reset();
    expect(store.getState().machine).toEqual(initialState());
  });
});
