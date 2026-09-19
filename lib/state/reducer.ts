/**
 * The reducer. Pure: (state, event, timestamp) -> state. It never reads a
 * clock and never calls a tool. An event that does not fit the current state
 * is recorded as a rejected trace entry and changes nothing, so an out-of-order
 * or forged event can never advance the flow.
 *
 * "An unknown (state, event) pair throws and logs" (AGENTS.md section 5):
 * `reduce` does the logging and stays total, so a trace can always be replayed;
 * `reduceStrict` is what the running system dispatches through, and it throws
 * once the rejection is on the record.
 */
import {
  CALL_PHASE,
  INITIAL_CONTEXT,
  TERMINAL,
  TRANSITIONS,
  crossCutting,
  enforceCallLength,
  type CallPhase,
  type Outcome,
  type RelayContext,
  type RelayEvent,
  type RelayEventType,
  type RelayState,
} from "./machine";

export interface TraceEntry {
  seq: number;
  at: string;
  event: RelayEventType;
  from: RelayState;
  to: RelayState;
  accepted: boolean;
  /** Human-readable card text. Empty for rejected events: those are for the judge console only. */
  label: string;
  call_phase: CallPhase | null;
  citations: string[];
  note: string | null;
  /** The tool call that produced this event, when one did. Links the trace to the tool log. */
  tool_call_seq: number | null;
  /** The event itself. With this, a trace is a complete recording: re-reducing it rebuilds every state. */
  payload: RelayEvent;
}

export interface MachineState {
  state: RelayState;
  context: RelayContext;
  trace: TraceEntry[];
}

export function initialState(): MachineState {
  return { state: "idle", context: structuredClone(INITIAL_CONTEXT), trace: [] };
}

export interface DispatchMeta {
  at: string;
  tool_call_seq?: number | null;
}

function decide(current: MachineState, event: RelayEvent, at: string): Outcome {
  if (TERMINAL.has(current.state)) return { reject: `"${current.state}" is terminal` };
  const expired = enforceCallLength(current.state, current.context, event, at);
  if (expired) return expired;
  const cross = crossCutting(current.state, current.context, event);
  if (cross) return cross;
  // The table is keyed by event type, so the handler always matches the event.
  const handler = TRANSITIONS[current.state][event.type] as
    | ((ctx: RelayContext, e: RelayEvent, s: RelayState, at: string) => Outcome)
    | undefined;
  if (!handler) return { reject: `"${event.type}" is not valid in "${current.state}"` };
  return handler(current.context, event, current.state, at);
}

export function reduce(current: MachineState, event: RelayEvent, meta: DispatchMeta): MachineState {
  const outcome = decide(current, event, meta.at);
  const seq = current.trace.length + 1;
  if ("reject" in outcome) {
    const entry: TraceEntry = {
      seq,
      at: meta.at,
      event: event.type,
      from: current.state,
      to: current.state,
      accepted: false,
      label: "",
      call_phase: CALL_PHASE[current.state] ?? null,
      citations: [],
      note: outcome.reject,
      tool_call_seq: meta.tool_call_seq ?? null,
      payload: event,
    };
    return { ...current, trace: [...current.trace, entry] };
  }
  const entry: TraceEntry = {
    seq,
    at: meta.at,
    event: event.type,
    from: current.state,
    to: outcome.to,
    accepted: true,
    label: outcome.label,
    call_phase: CALL_PHASE[outcome.to] ?? null,
    citations: outcome.citations ?? [],
    note: outcome.note ?? null,
    tool_call_seq: meta.tool_call_seq ?? null,
    payload: event,
  };
  return {
    state: outcome.to,
    context: { ...current.context, ...outcome.patch },
    trace: [...current.trace, entry],
  };
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly machine: MachineState,
    detail: string,
  ) {
    super(`invalid transition: ${detail}`);
    this.name = "InvalidTransitionError";
  }
}

/** Reduce, and throw if the event was refused. The refusal is already in the trace the error carries: thrown AND logged. */
export function reduceStrict(current: MachineState, event: RelayEvent, meta: DispatchMeta): MachineState {
  const next = reduce(current, event, meta);
  const last = next.trace[next.trace.length - 1]!;
  if (!last.accepted) throw new InvalidTransitionError(next, last.note ?? "refused");
  return next;
}

/**
 * Rebuild the machine from a recorded trace, optionally only up to a moment in time. Because the
 * reducer is pure, this is exact: it is how the live session view scrubs through a finished run.
 */
export function replay(trace: readonly TraceEntry[], untilIso?: string): MachineState {
  let machine = initialState();
  for (const entry of trace) {
    if (untilIso !== undefined && entry.at > untilIso) break;
    machine = reduce(machine, entry.payload, { at: entry.at, tool_call_seq: entry.tool_call_seq });
  }
  return machine;
}

/** The accepted top-level states visited, in order, without repeats of the same state back to back. */
export function visitedStates(machine: MachineState): RelayState[] {
  const path: RelayState[] = ["idle"];
  for (const t of machine.trace) {
    if (t.accepted && t.to !== path[path.length - 1]) path.push(t.to);
  }
  return path;
}
