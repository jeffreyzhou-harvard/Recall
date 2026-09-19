/**
 * Relay state machine: states, events, and the transition table.
 *
 * One reducer drives every pane (AGENTS.md section 5). Visual, audio, and
 * trace effects all key off the transitions declared here, so the demo cannot
 * contradict itself.
 *
 * Main line:
 *   idle -> ask_received -> policy_passed -> connected -> following
 *        -> lost -> reanchored -> contributed -> playback -> assented -> delivered
 *
 * Every failure transition below is deterministic. No model output can move
 * the machine: models only ever produce the typed events a tool emitted.
 *
 * Changes to this file define the safety gates and need a second reviewer
 * (AGENTS.md section 13).
 */

export const MAIN_LINE = [
  "idle",
  "ask_received",
  "policy_passed",
  "connected",
  "following",
  "lost",
  "reanchored",
  "contributed",
  "playback",
  "assented",
  "delivered",
] as const;

/**
 * Ways a run can end other than delivery. Each is a success state in the
 * sense of rule 7: stopping safely is the correct outcome, not an error to
 * route around.
 */
export const SAFE_ENDINGS = [
  "blocked", // a gate failed before the call; the call was never placed
  "narrowed", // a gate failed mid-call; Relay said the safe-narrowing line
  "wrapped_up", // second lost-thread signal; "no answer today"
  "not_sent", // assent was no or unclear, or a gate failed after capture
  "closed_kindly", // tool timeout mid-call; restated once, then closed
] as const;

/** Tool timeout mid-call: the fixed script is running. Not terminal. */
export const FALLBACK = "fallback" as const;

export type RelayState = (typeof MAIN_LINE)[number] | (typeof SAFE_ENDINGS)[number] | typeof FALLBACK;

export const TERMINAL: ReadonlySet<RelayState> = new Set<RelayState>(["delivered", ...SAFE_ENDINGS]);

/** The call session nests inside the top-level state: connected { brief -> ask -> support* -> capture -> confirm }. */
export type CallPhase = "brief" | "ask" | "support" | "capture" | "confirm";
export const CALL_PHASE: Partial<Record<RelayState, CallPhase>> = {
  connected: "brief",
  following: "ask",
  lost: "support",
  reanchored: "support",
  fallback: "support",
  contributed: "capture",
  playback: "confirm",
  assented: "confirm",
};

/** What `assess_conversation_state` may emit. Observable turn states only: never emotion, never cognition. */
export const TURN_STATES = ["followed", "asked_repeat", "no_answer", "answer_present"] as const;
export type TurnState = (typeof TURN_STATES)[number];

export type AssentDecision = "yes" | "no" | "unclear";
export type GateName = "identity" | "policy" | "evidence" | "permission" | "assent" | "authorship";

export type RelayEvent =
  | { type: "ASK_FORWARDED"; ask_id: string; thread_id: string; asker_id: string; addressee_id: string }
  | { type: "POLICY_GRANTED"; policy_token_id: string; audience: string }
  | { type: "POLICY_DENIED"; reason: string }
  | { type: "CALL_CONNECTED"; session_id: string }
  | { type: "BRIEF_DELIVERED"; prompt_id: string; citations: string[] }
  | { type: "TURN_ASSESSED"; turn_id: string; turn_state: TurnState }
  | { type: "SCAFFOLD_DELIVERED"; scaffold_id: string; prompt_id: string; citations: string[] }
  | { type: "CONTRIBUTION_CAPTURED"; contribution_hash: string; trims: number; generated_first_person_words: number }
  | { type: "PLAYBACK_STARTED"; contribution_hash: string }
  | { type: "ASSENT_RECORDED"; assent_id: string; decision: AssentDecision; contribution_hash: string; audience: string }
  | { type: "PUBLISHED"; delivery_id: string; contribution_hash: string; destination: string }
  | { type: "CONTENT_OR_AUDIENCE_CHANGED"; what: "content" | "audience" }
  | { type: "CLAIMS_CONFLICT"; claim_ids: string[] }
  | { type: "GATE_MISSING"; gate: GateName; detail: string }
  | { type: "TOOL_TIMEOUT"; tool: string }
  | { type: "FIXED_RESTATEMENT_DELIVERED"; prompt_id: string }
  | { type: "CALL_CLOSED" };

export type RelayEventType = RelayEvent["type"];
type EventOf<T extends RelayEventType> = Extract<RelayEvent, { type: T }>;

/** Two lost-thread signals end the call gently (AGENTS.md section 5). */
export const MAX_LOST_SIGNALS = 2;

export interface RelayContext {
  ask_id: string | null;
  thread_id: string | null;
  asker_id: string | null;
  addressee_id: string | null;
  policy_token_id: string | null;
  audience: string | null;
  session_id: string | null;
  lost_signals: number;
  scaffolds_used: string[];
  /** "current_ask_only" once claims conflict: Relay never picks a remembered fact. */
  evidence_mode: "full" | "current_ask_only";
  answer_turn_id: string | null;
  contribution_hash: string | null;
  assent_id: string | null;
  delivery_id: string | null;
  restated_once: boolean;
  /** Why the run ended somewhere other than `delivered`. For the judge console; never sent to the family. */
  ending_reason: string | null;
  /**
   * Which fixed notice the family's thread gets when nothing was delivered. `clarify` when identity,
   * audience, or evidence was missing ("stop safely, ask family to clarify"); `not_this_time` otherwise.
   * Decided here so the thread, the receipt, and the trace can never disagree about it.
   */
  family_notice: "clarify" | "not_this_time" | null;
}

export const INITIAL_CONTEXT: RelayContext = {
  ask_id: null,
  thread_id: null,
  asker_id: null,
  addressee_id: null,
  policy_token_id: null,
  audience: null,
  session_id: null,
  lost_signals: 0,
  scaffolds_used: [],
  evidence_mode: "full",
  answer_turn_id: null,
  contribution_hash: null,
  assent_id: null,
  delivery_id: null,
  restated_once: false,
  ending_reason: null,
  family_notice: null,
};

export interface Accept {
  to: RelayState;
  /** Human-readable card text for the "How Relay helped" rail. Never a clinical label. */
  label: string;
  patch?: Partial<RelayContext>;
  citations?: string[];
  note?: string;
}
export interface Reject {
  reject: string;
}
export type Outcome = Accept | Reject;

type Handler<T extends RelayEventType> = (ctx: RelayContext, event: EventOf<T>, state: RelayState) => Outcome;
type StateTable = { [T in RelayEventType]?: Handler<T> };

const IN_CALL: readonly RelayState[] = ["connected", "following", "lost", "reanchored"];
const AFTER_CAPTURE: readonly RelayState[] = ["contributed", "playback", "assented"];

/** How the machine reacts to an assessed turn, shared by every in-call state that can receive one. */
const onTurn: Handler<"TURN_ASSESSED"> = (ctx, e, state) => {
  switch (e.turn_state) {
    case "followed":
      return { to: "following", label: "Following along" };
    case "answer_present":
      // No top-level move: the documented line is reanchored -> contributed, and
      // `contributed` is only entered once her exact words have been captured.
      return { to: state, label: "Answer heard", patch: { answer_turn_id: e.turn_id }, note: "capturing exact words" };
    case "asked_repeat":
    case "no_answer": {
      const lost = ctx.lost_signals + 1;
      if (lost >= MAX_LOST_SIGNALS) {
        return {
          to: "wrapped_up",
          label: "Wrapped up gently",
          patch: { lost_signals: lost, ending_reason: "no answer today", family_notice: "not_this_time" },
          note: "second lost-thread signal; the asker gets a neutral not-this-time",
        };
      }
      return { to: "lost", label: "Thread unclear", patch: { lost_signals: lost } };
    }
  }
};

const onCapture: Handler<"CONTRIBUTION_CAPTURED"> = (ctx, e) => {
  if (ctx.answer_turn_id === null) return { reject: "no answer turn has been assessed" };
  if (e.generated_first_person_words !== 0) {
    return { reject: `contribution contains ${e.generated_first_person_words} generated first-person word(s)` };
  }
  return { to: "contributed", label: "Her exact words captured", patch: { contribution_hash: e.contribution_hash } };
};

export const TRANSITIONS: Record<RelayState, StateTable> = {
  idle: {
    ASK_FORWARDED: (_ctx, e) => ({
      to: "ask_received",
      label: "Ask received",
      patch: { ask_id: e.ask_id, thread_id: e.thread_id, asker_id: e.asker_id, addressee_id: e.addressee_id },
    }),
  },
  ask_received: {
    POLICY_GRANTED: (_ctx, e) => ({
      to: "policy_passed",
      label: "Ask verified",
      patch: { policy_token_id: e.policy_token_id, audience: e.audience },
    }),
    POLICY_DENIED: (_ctx, e) => ({
      to: "blocked",
      label: "Not placed",
      patch: { ending_reason: e.reason, family_notice: "not_this_time" },
      note: "the call is never placed",
    }),
  },
  policy_passed: {
    CALL_CONNECTED: (_ctx, e) => ({ to: "connected", label: "Call connected", patch: { session_id: e.session_id } }),
  },
  connected: {
    BRIEF_DELIVERED: (_ctx, e) => ({ to: "following", label: "Ask shared", citations: e.citations }),
  },
  following: { TURN_ASSESSED: onTurn, CONTRIBUTION_CAPTURED: onCapture },
  lost: {
    SCAFFOLD_DELIVERED: (ctx, e) => ({
      to: "reanchored",
      label: "Re-anchored",
      patch: { scaffolds_used: [...ctx.scaffolds_used, e.scaffold_id] },
      citations: e.citations,
    }),
  },
  reanchored: { TURN_ASSESSED: onTurn, CONTRIBUTION_CAPTURED: onCapture },
  contributed: {
    PLAYBACK_STARTED: (ctx, e) =>
      e.contribution_hash === ctx.contribution_hash
        ? { to: "playback", label: "Played back for approval" }
        : { reject: "playback hash does not match the captured contribution" },
  },
  playback: {
    ASSENT_RECORDED: (ctx, e) => {
      if (e.contribution_hash !== ctx.contribution_hash) return { reject: "assent is for a different contribution" };
      if (e.audience !== ctx.audience) return { reject: "assent is for a different audience" };
      if (e.decision === "yes") return { to: "assented", label: "Voice approval received", patch: { assent_id: e.assent_id } };
      return {
        to: "not_sent",
        label: "Not sent",
        patch: { ending_reason: e.decision === "no" ? "she said no" : "approval was unclear", family_notice: "not_this_time" },
        note: "nothing sends; unapproved audio is discarded",
      };
    },
  },
  assented: {
    PUBLISHED: (ctx, e) => {
      if (ctx.assent_id === null) return { reject: "no assent on record" };
      if (e.contribution_hash !== ctx.contribution_hash) return { reject: "published hash does not match the approved contribution" };
      if (e.destination !== ctx.audience) return { reject: "destination does not match the approved audience" };
      return { to: "delivered", label: "Delivered to the family thread", patch: { delivery_id: e.delivery_id } };
    },
  },
  fallback: {
    FIXED_RESTATEMENT_DELIVERED: (ctx) =>
      ctx.restated_once
        ? { reject: "the fixed script restates the question once only" }
        : { to: "fallback", label: "Question restated", patch: { restated_once: true } },
    CALL_CLOSED: (ctx) =>
      ctx.restated_once
        ? { to: "closed_kindly", label: "Closed kindly", patch: { ending_reason: "a tool did not respond in time", family_notice: "not_this_time" } }
        : { reject: "the question has not been restated yet" },
  },
  delivered: {},
  blocked: {},
  narrowed: {},
  wrapped_up: {},
  not_sent: {},
  closed_kindly: {},
};

/**
 * Cross-cutting events: they mean the same thing in every state they apply
 * to, so they are declared once rather than repeated per state.
 */
export function crossCutting(state: RelayState, ctx: RelayContext, event: RelayEvent): Outcome | null {
  if (TERMINAL.has(state)) return null;
  switch (event.type) {
    case "GATE_MISSING": {
      const reason = `${event.gate} gate: ${event.detail}`;
      // Before or during the call, a missing gate means Relay lacks something the family can supply: ask them to clarify.
      const clarify = { ending_reason: reason, family_notice: "clarify" as const };
      if (IN_CALL.includes(state)) {
        return { to: "narrowed", label: "Narrowed safely", patch: clarify, note: "Relay offers to ask the asker to clarify" };
      }
      if (AFTER_CAPTURE.includes(state)) {
        return { to: "not_sent", label: "Not sent", patch: { ending_reason: reason, family_notice: "not_this_time" } };
      }
      if (state === "fallback") return null;
      return { to: "blocked", label: "Stopped safely", patch: clarify, note: "the call is never placed; the family is asked to clarify" };
    }
    case "TOOL_TIMEOUT": {
      const patch = { ending_reason: `${event.tool} did not respond in time`, family_notice: "not_this_time" as const };
      if (IN_CALL.includes(state)) return { to: "fallback", label: "Keeping it simple", note: "fixed script: restate once, then close" };
      if (AFTER_CAPTURE.includes(state)) return { to: "not_sent", label: "Not sent", patch };
      if (state === "fallback") return null;
      return { to: "blocked", label: "Not placed", patch, note: "the call is never placed" };
    }
    case "CONTENT_OR_AUDIENCE_CHANGED":
      // Rule 3: any change to the artifact or its audience invalidates approval,
      // given or pending. Nothing sends; a fresh ask starts a fresh call.
      if (!AFTER_CAPTURE.includes(state)) return null;
      return {
        to: "not_sent",
        label: "Not sent",
        patch: { assent_id: null, ending_reason: `${event.what} changed after capture`, family_notice: "not_this_time" },
        note: "approval no longer matches the artifact; nothing sends",
      };
    case "CLAIMS_CONFLICT":
      return {
        to: state,
        label: "Using the current ask only",
        patch: { evidence_mode: "current_ask_only" },
        citations: event.claim_ids,
        note: "remembered facts disagree, so none of them is used",
      };
    default:
      return null;
  }
}
