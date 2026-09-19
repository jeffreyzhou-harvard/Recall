/**
 * Zustand binding for the reducer. The store adds nothing to the logic: it is
 * the reducer plus subscription, so React panes and the orchestrator share one
 * state object and one trace.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import type { RelayEvent } from "./machine";
import { InvalidTransitionError, initialState, reduce, type DispatchMeta, type MachineState } from "./reducer";

export interface RelayStore {
  machine: MachineState;
  dispatch: (event: RelayEvent, meta: DispatchMeta) => MachineState;
  reset: () => void;
}

export function createRelayStore(): StoreApi<RelayStore> {
  return createStore<RelayStore>((set, get) => ({
    machine: initialState(),
    // The refusal is stored first, then thrown: an unknown (state, event) pair throws AND logs (section 5).
    dispatch: (event, meta) => {
      const next = reduce(get().machine, event, meta);
      set({ machine: next });
      const last = next.trace[next.trace.length - 1]!;
      if (!last.accepted) throw new InvalidTransitionError(next, last.note ?? "refused");
      return next;
    },
    reset: () => set({ machine: initialState() }),
  }));
}
