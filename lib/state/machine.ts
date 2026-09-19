/**
 * Relay state machine: states, events, and the one transition table
 * (AGENTS.md section 5).
 *
 * Main line:
 *   idle -> scheduled -> policy_passed -> connected -> topic_selected -> asking
 *        -> lost -> reanchored -> recalled -> confirming -> confirmed -> stored
 *
 * The call nests as connected { greet -> select_topic -> ladder* -> capture -> confirm }.
 * `lost -> reanchored` repeats once per rung as the ladder climbs.
 *
 * Every transition here is deterministic. No model output can move the
 * machine: models only ever produce the typed events a tool emitted. The
 * family flows (section 6.4) never enter this reducer at all.
 *
 * Changes to this file define the safety gates and need a second reviewer
 * (AGENTS.md section 13).
 */

export const MAIN_LINE = [
  "idle",
  "scheduled",
  "policy_passed",
  "connected",
  "topic_selected",
  "asking",
  "lost",
  "reanchored",
  "recalled",
  "confirming",
  "confirmed",
  "stored",
] as const;

/**
 * The five ways a run ends other than `stored`. Each is a success state in the sense of rule 7:
 * stopping safely is the correct outcome, not an error to route around.
 */
export const SAFE_ENDINGS = [
  "blocked", // the policy said no; the call was never placed
  "no_answer_today", // the ladder had nothing more to offer, or she was quiet twice; a kind close
  "not_stored", // she did not confirm it; nothing is kept
  "stopped", // hang-up, an explicit stop, or a caregiver pause; nothing is kept, no follow-up call
  "safety_handoff", // a phrase on the safety list; the recall flow is dropped and her caregiver is told
] as const;

export type RelayState = (typeof MAIN_LINE)[number] | (typeof SAFE_ENDINGS)[number];

export const TERMINAL: ReadonlySet<RelayState> = new Set<RelayState>(["stored", ...SAFE_ENDINGS]);
export const NON_TERMINAL: readonly RelayState[] = MAIN_LINE.filter((s) => s !== "stored");

/** States in which she is on the line. A safety match, an identity question, and the call clock apply in exactly these. */
export const IN_CALL: readonly RelayState[] = ["connected", "topic_selected", "asking", "lost", "reanchored", "recalled", "confirming", "confirmed"];
const BEFORE_CAPTURE: readonly RelayState[] = ["connected", "topic_selected", "asking", "lost", "reanchored", "recalled"];
const AFTER_CAPTURE: readonly RelayState[] = ["confirming", "confirmed"];

export type CallPhase = "greet" | "select_topic" | "ladder" | "capture" | "confirm";
export const CALL_PHASE: Partial<Record<RelayState, CallPhase>> = {
  connected: "greet",
  topic_selected: "select_topic",
  asking: "ladder",
  lost: "ladder",
  reanchored: "ladder",
  recalled: "capture",
  confirming: "confirm",
  confirmed: "confirm",
};

/** What `assess_conversation_state` may emit. Observable turn states only: never emotion, never cognition. */
export const TURN_STATES = ["recalled", "asked_repeat", "no_answer", "new_detail_offered"] as const;
export type TurnState = (typeof TURN_STATES)[number];

export const RUNGS = [1, 2, 3, 4, 5] as const;
export type Rung = (typeof RUNGS)[number];
/** Rule 13: for a family-sourced, unconfirmed topic the ladder stops here. A forced choice or a stated fact could plant a memory. */
export const FAMILY_SOURCED_MAX_RUNG: Rung = 3;
/** Two windows in which she said nothing at all end the topic gently (section 5: "second lost signal"). */
export const MAX_SILENT_WINDOWS = 2;

export type StoreDecision = "yes" | "no" | "unclear";
export type ShareDecision = "yes" | "no" | "unclear" | "timeout";
export type StopHow = "hang_up" | "explicit_stop" | "caregiver_pause";
export type GateName = "identity" | "policy" | "evidence" | "confirmation" | "authorship";

export type RelayEvent =
  | { type: "CALL_SCHEDULED"; person_id: string; topic_id: string; topic_label: string; family_sourced: boolean }
  | { type: "POLICY_GRANTED"; policy_token_id: string; max_call_minutes: number }
  | { type: "POLICY_DENIED"; reason: string }
  | { type: "CALL_NOT_ANSWERED"; detail: string }
  | { type: "CALL_CONNECTED"; session_id: string }
  | { type: "GREETING_DELIVERED"; prompt_id: string; discloses_ai: true }
  | { type: "TOPIC_SELECTED"; topic_id: string; citations: string[] }
  | { type: "RUNG_DELIVERED"; rung: Rung; prompt_id: string; citations: string[]; cue_id: string | null }
  | { type: "TURN_ASSESSED"; turn_id: string; turn_state: TurnState; silent: boolean }
  | { type: "LADDER_EXHAUSTED"; reason: string }
  | { type: "CONTRIBUTION_CAPTURED"; contribution_hash: string; trims: number; generated_first_person_words: number }
  | { type: "STORE_CONFIRMATION_RECORDED"; confirmation_id: string; decision: StoreDecision; contribution_hash: string }
  | { type: "SHARE_CONFIRMATION_RECORDED"; confirmation_id: string; decision: ShareDecision; contribution_hash: string }
  | { type: "CONTRIBUTION_STORED"; claim_id: string; contribution_hash: string; shared: boolean }
  | { type: "IDENTITY_ASKED"; prompt_id: string }
  | { type: "CLAIMS_CONFLICT"; claim_ids: string[] }
  | { type: "STOP"; how: StopHow }
  | { type: "SAFETY_MATCHED"; category: string }
  | { type: "GATE_MISSING"; gate: GateName; detail: string }
  | { type: "TOOL_TIMEOUT"; tool: string }
  | { type: "FIXED_RESTATEMENT_DELIVERED"; prompt_id: string }
  | { type: "CALL_CLOSED" };

export type RelayEventType = RelayEvent["type"];
type EventOf<T extends RelayEventType> = Extract<RelayEvent, { type: T }>;

export interface RelayContext {
  person_id: string | null;
  topic_id: string | null;
  topic_label: string | null;
  family_sourced: boolean;
  policy_token_id: string | null;
  max_call_minutes: number | null;
  session_id: string | null;
  /** Set when the call connects: connect time plus the joint setup's max call length. Enforced below, in `enforceCallLength`. */
  call_deadline: string | null;
  /** True once the first line - the AI-assistant disclosure - has been said (rule 16). Nothing else can be said before it. */
  greeted: boolean;
  /** Every rung tried, in the order it was tried. */
  rungs_fired: Rung[];
  /** The cue each rung offered, where it offered one. */
  cues_offered: Array<{ rung: Rung; cue_id: string }>;
  silent_windows: number;
  /** The rung after which she reached the memory - 1 is free recall, unaided - or null. */
  reached_at_rung: Rung | null;
  answer_turn_id: string | null;
  contribution_hash: string | null;
  store_confirmed: boolean;
  share_resolved: boolean;
  shared: boolean;
  claim_id: string | null;
  /** A tool did not respond mid-call: the fixed script is running (restate once, then close). */
  fallback_active: boolean;
  restated_once: boolean;
  conflicting_claim_ids: string[];
  safety_category: string | null;
  stop_how: StopHow | null;
  /** Why the run ended where it did, as an observable fact. For the judge console and the receipt; never a reason inferred about her. */
  ending_reason: string | null;
}

export const INITIAL_CONTEXT: RelayContext = {
  person_id: null,
  topic_id: null,
  topic_label: null,
  family_sourced: false,
  policy_token_id: null,
  max_call_minutes: null,
  session_id: null,
  call_deadline: null,
  greeted: false,
  rungs_fired: [],
  cues_offered: [],
  silent_windows: 0,
  reached_at_rung: null,
  answer_turn_id: null,
  contribution_hash: null,
  store_confirmed: false,
  share_resolved: false,
  shared: false,
  claim_id: null,
  fallback_active: false,
  restated_once: false,
  conflicting_claim_ids: [],
  safety_category: null,
  stop_how: null,
  ending_reason: null,
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

type Handler<T extends RelayEventType> = (ctx: RelayContext, event: EventOf<T>, state: RelayState, at: string) => Outcome;
type StateTable = { [T in RelayEventType]?: Handler<T> };

const highest = (ctx: RelayContext): number => Math.max(0, ...ctx.rungs_fired);

/** The ladder's order, enforced here as well as in `select_scaffold`: a forged or out-of-order rung cannot advance the call. */
function rungProblem(ctx: RelayContext, rung: Rung): string | null {
  if (ctx.rungs_fired.includes(rung)) return `rung ${rung} has already fired on this topic; each rung fires at most once per call`;
  if (rung <= highest(ctx)) return `rung ${rung} is below rung ${highest(ctx)}, which has already been tried`;
  if (ctx.family_sourced && rung > FAMILY_SOURCED_MAX_RUNG) return `rung ${rung} is disabled for a family-sourced, unconfirmed topic (rule 13)`;
  if (rung === 5 && !([1, 2, 3, 4] as Rung[]).every((r) => ctx.rungs_fired.includes(r))) return "reorientation is never reached before rungs 1-4 have each been tried in order";
  return null;
}

const onRung =
  (to: RelayState, label: string, firstOnly: boolean): Handler<"RUNG_DELIVERED"> =>
  (ctx, e) => {
    if (ctx.fallback_active) return { reject: "the fixed script is running; no further rung may fire" };
    if (firstOnly && e.rung !== 1) return { reject: "a call opens with free recall: Relay never starts above rung 1" };
    if (!firstOnly && ctx.rungs_fired.length === 0) return { reject: "free recall has not been tried yet" };
    const problem = rungProblem(ctx, e.rung);
    if (problem) return { reject: problem };
    return {
      to,
      label,
      patch: { rungs_fired: [...ctx.rungs_fired, e.rung], cues_offered: e.cue_id ? [...ctx.cues_offered, { rung: e.rung, cue_id: e.cue_id }] : ctx.cues_offered },
      citations: e.citations,
    };
  };

/** How the machine reacts to an assessed turn while the ladder is in play. */
const onLadderTurn: Handler<"TURN_ASSESSED"> = (ctx, e) => {
  if (ctx.fallback_active) return { reject: "the fixed script is running; no turn is classified" };
  if (e.turn_state === "recalled" || e.turn_state === "new_detail_offered") {
    const rung = highest(ctx) as Rung;
    return {
      to: "recalled",
      label: rung === 1 ? "Recalled" : "Recalled, with a little help",
      patch: { reached_at_rung: rung, answer_turn_id: e.turn_state === "new_detail_offered" ? e.turn_id : null },
      note: e.turn_state === "new_detail_offered" ? "she offered a detail of her own; it can be captured as it is" : undefined,
    };
  }
  const silent = ctx.silent_windows + (e.silent ? 1 : 0);
  if (silent >= MAX_SILENT_WINDOWS) {
    return { to: "no_answer_today", label: "Wrapped up gently", patch: { silent_windows: silent, ending_reason: "two quiet windows on this topic" }, note: "second lost-thread signal; a kind close" };
  }
  return { to: "lost", label: "More help needed", patch: { silent_windows: silent } };
};

const onElaboration: Handler<"TURN_ASSESSED"> = (ctx, e) => {
  if (ctx.fallback_active) return { reject: "the fixed script is running; no turn is classified" };
  if (ctx.answer_turn_id !== null) return { reject: "a turn of hers is already waiting to be captured" };
  if (e.turn_state === "recalled" || e.turn_state === "new_detail_offered") return { to: "recalled", label: "In her own words", patch: { answer_turn_id: e.turn_id } };
  return { to: "not_stored", label: "Closed kindly", patch: { ending_reason: "she reached it, and offered nothing to remember this time" } };
};

export const TRANSITIONS: Record<RelayState, StateTable> = {
  idle: {
    CALL_SCHEDULED: (_ctx, e) => ({
      to: "scheduled",
      label: "Call scheduled",
      patch: { person_id: e.person_id, topic_id: e.topic_id, topic_label: e.topic_label, family_sourced: e.family_sourced },
    }),
  },
  scheduled: {
    POLICY_GRANTED: (_ctx, e) => ({ to: "policy_passed", label: "Within what was agreed", patch: { policy_token_id: e.policy_token_id, max_call_minutes: e.max_call_minutes } }),
    POLICY_DENIED: (_ctx, e) => ({ to: "blocked", label: "Not placed", patch: { ending_reason: e.reason }, note: "the call is never placed" }),
  },
  policy_passed: {
    CALL_CONNECTED: (ctx, e, _state, at) => ({
      to: "connected",
      label: "She answered",
      patch: { session_id: e.session_id, call_deadline: new Date(Date.parse(at) + (ctx.max_call_minutes ?? 0) * 60_000).toISOString() },
    }),
    CALL_NOT_ANSWERED: (_ctx, e) => ({ to: "no_answer_today", label: "No answer today", patch: { ending_reason: e.detail }, note: "no follow-up call is placed" }),
  },
  connected: {
    GREETING_DELIVERED: (ctx) => (ctx.greeted ? { reject: "the greeting is said once" } : { to: "connected", label: "Relay said what it is", patch: { greeted: true } }),
    TOPIC_SELECTED: (ctx, e) => {
      if (!ctx.greeted) return { reject: "the first line of every call is the AI-assistant disclosure (rule 16)" };
      if (e.topic_id !== ctx.topic_id) return { reject: "the topic is not the one the policy granted this call for" };
      return { to: "topic_selected", label: "Topic selected", citations: e.citations };
    },
  },
  topic_selected: { RUNG_DELIVERED: onRung("asking", "Invited her to talk", true) },
  asking: { TURN_ASSESSED: onLadderTurn },
  lost: {
    RUNG_DELIVERED: onRung("reanchored", "Cue given", false),
    LADDER_EXHAUSTED: (_ctx, e) => ({ to: "no_answer_today", label: "Wrapped up gently", patch: { ending_reason: e.reason }, note: "the ladder has nothing more to offer; a kind close" }),
  },
  reanchored: { TURN_ASSESSED: onLadderTurn },
  recalled: {
    TURN_ASSESSED: onElaboration,
    CONTRIBUTION_CAPTURED: (ctx, e) => {
      if (ctx.answer_turn_id === null) return { reject: "no turn of hers has been assessed as something to capture" };
      if (e.generated_first_person_words !== 0) return { reject: `contribution contains ${e.generated_first_person_words} generated first-person word(s)` };
      return { to: "confirming", label: "Her exact words captured", patch: { contribution_hash: e.contribution_hash } };
    },
  },
  confirming: {
    STORE_CONFIRMATION_RECORDED: (ctx, e) => {
      if (e.contribution_hash !== ctx.contribution_hash) return { reject: "the confirmation is for a different contribution" };
      if (e.decision === "yes") return { to: "confirmed", label: "She said to remember it", patch: { store_confirmed: true } };
      return { to: "not_stored", label: "Not kept", patch: { ending_reason: e.decision === "no" ? "she said no" : "her answer was unclear" }, note: "nothing is stored; unconfirmed audio is deleted at call end" };
    },
  },
  confirmed: {
    SHARE_CONFIRMATION_RECORDED: (ctx, e) => {
      if (e.contribution_hash !== ctx.contribution_hash) return { reject: "the share confirmation is for a different contribution" };
      if (ctx.share_resolved) return { reject: "the share question is asked once" };
      return { to: "confirmed", label: e.decision === "yes" ? "She chose to share it" : "Kept, not shared", patch: { share_resolved: true, shared: e.decision === "yes" } };
    },
    CONTRIBUTION_STORED: (ctx, e) => {
      if (!ctx.store_confirmed) return { reject: "she has not confirmed it" };
      if (!ctx.share_resolved) return { reject: "commit comes last: the share question has not resolved (section 5)" };
      if (e.contribution_hash !== ctx.contribution_hash) return { reject: "the stored hash does not match the confirmed contribution" };
      if (e.shared !== ctx.shared) return { reject: "the stored share flag does not match what she said" };
      return { to: "stored", label: "Remembered - added to the graph", patch: { claim_id: e.claim_id } };
    },
  },
  stored: {},
  blocked: {},
  no_answer_today: {},
  not_stored: {},
  stopped: {},
  safety_handoff: {},
};

/**
 * Cross-cutting events: they mean the same thing in every state they apply to, so they are declared once.
 * Order matters and is fixed: a safety match outranks a stop in the same turn (rule 15), and both outrank
 * everything else.
 */
export function crossCutting(state: RelayState, ctx: RelayContext, event: RelayEvent): Outcome | null {
  if (TERMINAL.has(state)) return null;
  const inCall = IN_CALL.includes(state);
  switch (event.type) {
    case "SAFETY_MATCHED":
      if (!inCall) return { reject: "a safety match comes from a final turn of hers, so only during a call" };
      return { to: "safety_handoff", label: "Safety handoff", patch: { safety_category: event.category, ending_reason: "a phrase on the safety list" }, note: "the recall flow is dropped; her designated caregiver is told" };
    case "STOP":
      return { to: "stopped", label: "Stopped", patch: { stop_how: event.how, ending_reason: event.how.replace("_", " ") }, note: "nothing is stored beyond metadata; no follow-up call" };
    case "IDENTITY_ASKED":
      return inCall ? { to: state, label: "Relay said what it is", note: "the fixed identity line; the flow continues" } : { reject: "nobody is on the line to ask" };
    case "CLAIMS_CONFLICT":
      return { to: state, label: "Two accounts differ; neither is spoken", patch: { conflicting_claim_ids: [...new Set([...ctx.conflicting_claim_ids, ...event.claim_ids])] }, citations: event.claim_ids };
    case "GATE_MISSING": {
      const reason = `${event.gate} gate: ${event.detail}`;
      if (AFTER_CAPTURE.includes(state)) return { to: "not_stored", label: "Not kept", patch: { ending_reason: reason } };
      if (inCall) return { to: "no_answer_today", label: "Narrowed safely", patch: { ending_reason: reason }, note: "Relay says the narrowing line and closes kindly" };
      return { to: "blocked", label: "Stopped safely", patch: { ending_reason: reason }, note: "the call is never placed" };
    }
    case "TOOL_TIMEOUT": {
      const reason = `${event.tool} did not respond in time`;
      // Her answer to the share question never blocks storing: no answer in time is simply "not shared".
      if (state === "confirmed" && event.tool === "confirm_share" && !ctx.share_resolved) return { to: "confirmed", label: "Kept, not shared", patch: { share_resolved: true, shared: false }, note: "the share question timed out" };
      if (AFTER_CAPTURE.includes(state)) return { to: "not_stored", label: "Not kept", patch: { ending_reason: reason } };
      if (inCall) return ctx.fallback_active ? null : { to: state, label: "Keeping it simple", patch: { fallback_active: true, ending_reason: reason }, note: "fixed script: restate the current question once, then close kindly" };
      return { to: "blocked", label: "Not placed", patch: { ending_reason: reason }, note: "the call is never placed" };
    }
    case "FIXED_RESTATEMENT_DELIVERED":
      if (!ctx.fallback_active) return null;
      return ctx.restated_once ? { reject: "the fixed script restates the question once only" } : { to: state, label: "Question restated", patch: { restated_once: true } };
    case "CALL_CLOSED":
      if (!ctx.fallback_active) return null;
      return { to: "no_answer_today", label: "Closed kindly" };
    default:
      return null;
  }
}

/**
 * The joint setup's max call length, enforced by the reducer (section 5). Once the deadline has passed,
 * whatever would have carried the conversation on becomes the kind close instead. A stop and a safety
 * match still take priority, and a confirmation already under way is allowed to finish: it is two short
 * questions, and cutting it off would throw away something she is in the middle of saying yes to.
 */
export function enforceCallLength(state: RelayState, ctx: RelayContext, event: RelayEvent, at: string): Outcome | null {
  if (ctx.call_deadline === null || at < ctx.call_deadline || !BEFORE_CAPTURE.includes(state)) return null;
  if (event.type === "STOP" || event.type === "SAFETY_MATCHED") return null;
  return { to: "no_answer_today", label: "Time to rest", patch: { ending_reason: "the agreed call length was reached" }, note: "a kind close" };
}
