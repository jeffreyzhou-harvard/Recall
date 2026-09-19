/**
 * The orchestrator walks the enforced tool sequence and feeds the reducer
 * (AGENTS.md section 6):
 *
 *   pick topic -> place call within window -> query permitted graph -> verify
 *   evidence -> assess conversation state -> select least-helpful scaffold ->
 *   render only cited context -> capture contribution -> play back for
 *   store-confirmation -> if yes, ask for share-confirmation -> commit only if
 *   store-confirmed -> record retrieval outcome and topic outcome -> build
 *   caregiver receipt
 *
 * and, ahead of all of it on every final turn of hers, the safety check.
 *
 * It holds no judgment of its own. Tools decide, gates refuse, and the reducer
 * records. A GateError or a timeout is not something to recover from here: it
 * becomes the corresponding deterministic transition and the run ends safely.
 * Nothing in this file can be reached by a family member: a call starts from
 * the schedule, the graph, and the joint setup, and from nothing else (rule 5).
 */
import type { StoreApi } from "zustand/vanilla";
import type { AudioWindow } from "@/lib/providers/transcription";
import type { FixedLineKey } from "@/lib/script/call-script";
import { IN_CALL, TERMINAL, type RecallEvent, type Rung } from "@/lib/state/machine";
import type { MachineState } from "@/lib/state/reducer";
import type { RecallStore } from "@/lib/state/store";
import { GateError, ToolTimeoutError, type ToolContext, type ToolOutput, type ToolRuntime } from "@/lib/tools";
import { CallUnavailableError, type CallDriver } from "./call-driver";

export interface RunEnv {
  person_id: string;
  ctx: ToolContext;
  runtime: ToolRuntime;
  store: StoreApi<RecallStore>;
  /** Called exactly once, and only after the policy has granted the call: no grant, no call. */
  callDriver: (() => CallDriver) | null;
}

export interface RunResult {
  machine: MachineState;
  /** Null only when there was no topic due, so nothing was scheduled at all. */
  receipt: ToolOutput<"build_caregiver_receipt"> | null;
}

type Prompt = ToolOutput<"render_prompt">;
// By name as well as by class: a driver may live in another bundle, where `instanceof` would not hold.
const isDropped = (e: unknown): boolean => e instanceof CallUnavailableError || (e instanceof Error && e.name === "CallUnavailableError");

/**
 * The open line, held apart from the walk below so that it can ALWAYS be closed. Hanging up is what wipes
 * her audio from wherever the call was held (rule 8), so it must happen on every way out - including an
 * error nobody planned for - and it happens once.
 */
class OpenLine {
  private driver: CallDriver | null = null;
  private done = false;

  attach(driver: CallDriver): void {
    this.driver = driver;
  }

  readonly hangUp = async (): Promise<void> => {
    if (!this.driver || this.done) return;
    this.done = true;
    await this.driver.hangUp();
  };
}

export async function runRecallCall(env: RunEnv): Promise<RunResult> {
  const openLine = new OpenLine();
  try {
    return await walk(env, openLine);
  } finally {
    // If an error is on its way out, it is the one that surfaces: a failure to hang up must not replace it.
    await openLine.hangUp().catch(() => undefined);
  }
}

async function walk(env: RunEnv, openLine: OpenLine): Promise<RunResult> {
  const { ctx, runtime, store } = env;
  const machine = (): MachineState => store.getState().machine;
  const ended = (): boolean => TERMINAL.has(machine().state);
  let driver: CallDriver | null = null;
  let connected = false;

  /** Dispatch an event, stamped with the injected clock and linked to the tool call that caused it. */
  const dispatch = (event: RecallEvent, fromTool = true): MachineState => {
    const before = machine().state;
    const seq = fromTool ? runtime.lastSeq() : null;
    const next = store.getState().dispatch(event, { at: ctx.clock.iso(), tool_call_seq: seq });
    if (seq) runtime.noteTransition(seq, before, next.state);
    return next;
  };

  /** Say a rendered line on the call, and record that it was actually said. */
  const speak = async (prompt: Prompt): Promise<void> => {
    await driver!.speak(prompt);
    ctx.session.spoken.push({ prompt_id: prompt.prompt_id, script_id: prompt.script_id, rung: prompt.rung, text: prompt.text, at: ctx.clock.iso() });
    if (prompt.rung !== null) ctx.session.telemetry.rungs_fired.push({ rung: prompt.rung, script_id: prompt.script_id, latency_after_ms: null });
  };
  /** For lines said on the way out: if she has already gone, there is nobody to say them to, and that is fine. */
  const speakIfThere = async (prompt: Prompt | undefined): Promise<void> => {
    if (!prompt || !driver) return;
    try {
      await speak(prompt);
    } catch (e) {
      if (!isDropped(e)) throw e;
    }
  };

  // Rendered and cited before the call is placed, so that ending a call kindly never depends on a tool responding.
  const fixed: Partial<Record<FixedLineKey | "elaborate", Prompt>> = {};

  try {
    const now = ctx.clock.iso();
    const pick = await runtime.call("get_next_recall_topic", { person_id: env.person_id, schedule_context: { now } });
    const topic = pick.topic;
    if (!topic) return { machine: machine(), receipt: null };
    const topicId = topic.topic_id;
    dispatch({ type: "CALL_SCHEDULED", person_id: env.person_id, topic_id: topicId, topic_label: topic.label, family_sourced: topic.family_sourced, reorientation_allowed: topic.reorientation_allowed });

    const grant = await runtime.call("place_recall_call", { person_id: env.person_id, topic_id: topicId, window: { now } });
    if (grant.decision === "denied") {
      dispatch({ type: "POLICY_DENIED", reason: grant.reason });
      return await finish(env, null, false);
    }
    dispatch({ type: "POLICY_GRANTED", policy_token_id: grant.policy_token_id, max_call_minutes: grant.speech.max_call_minutes });
    const tokenId = grant.policy_token_id;

    const retrieval = await runtime.call("query_context_graph", { topic_id: topicId, max_hops: 2, policy_token_id: tokenId });
    const support = await runtime.call("verify_claim_support", {
      topic_id: topicId,
      claim_ids: [...new Set([topicId, ...retrieval.candidates.map((c) => c.root_id), ...retrieval.relations.map((r) => r.edge_id)])],
      policy_token_id: tokenId,
    });
    // Two accounts differ: Recall speaks neither of them, and carries on with what is left (section 5).
    if (support.conflicts.length > 0) dispatch({ type: "CLAIMS_CONFLICT", claim_ids: support.conflicts.flatMap((c) => [c.a, c.b]) });
    const verified = support.verified.map((v) => v.claim_id);
    if (!verified.includes(topicId)) throw new GateError("evidence", "the topic itself could not be verified");

    const line = (key: FixedLineKey): Promise<Prompt> => runtime.call("render_prompt", { topic_id: topicId, scaffold_id: ctx.script.lines[key].id, slot_ids: {}, citations: [] });
    for (const key of ["greeting", "identity", "store_question", "share_question", "close_warm", "close_kind", "close_not_stored", "narrowing", "stop_ack", "safety"] as const) fixed[key] = await line(key);
    const elaborate = ctx.script.ladder.categories[topic.category]?.elaborate ?? ctx.script.ladder.elaborate_default;
    fixed.elaborate = await runtime.call("render_prompt", { topic_id: topicId, scaffold_id: elaborate.id, slot_ids: {}, citations: [] });
    const opening = await runtime.call("select_scaffold", { topic_id: topicId, state: "opening", verified_ids: verified, rungs_fired: [] });
    if (opening.rung !== 1 || !opening.scaffold_id) throw new GateError("evidence", "free recall cannot be asked: the topic has nothing verified to name it by");
    const invitation = await runtime.call("render_prompt", { topic_id: topicId, scaffold_id: opening.scaffold_id, slot_ids: opening.slot_ids, citations: opening.citations });

    if (!env.callDriver) throw new Error("the policy granted the call but this deployment has no way to place one");
    driver = env.callDriver();
    openLine.attach(driver);
    try {
      await driver.connect();
    } catch (e) {
      if (!isDropped(e)) throw e;
      dispatch({ type: "CALL_NOT_ANSWERED", detail: e instanceof Error ? e.message : "nobody answered" }, false);
      return await finish(env, null, false);
    }
    connected = true;
    ctx.session.call_asset_id = driver.call_asset_id;
    ctx.session.started_at = ctx.clock.iso();
    dispatch({ type: "CALL_CONNECTED", session_id: ctx.session.session_id }, false);

    // The first line of every call says what Recall is (rule 16). Only then the topic, and only as an invitation.
    await speak(fixed.greeting!);
    dispatch({ type: "GREETING_DELIVERED", prompt_id: fixed.greeting!.prompt_id, discloses_ai: true }, false);
    dispatch({ type: "TOPIC_SELECTED", topic_id: topicId, citations: [topicId] }, false);
    await speak(invitation);
    dispatch({ type: "RUNG_DELIVERED", rung: 1, prompt_id: invitation.prompt_id, citations: opening.citations, cue_id: null }, false);

    /**
     * Wait for her next final turn. The safety check runs on it before anything else (rule 15), and the alert
     * goes out BEFORE Recall says a word about it, so that a hang-up in the same turn cannot cancel it.
     * Returns null when the call is over.
     */
    const hear = async (): Promise<AudioWindow | null> => {
      if (ctx.setup.current().calls_paused) {
        dispatch({ type: "STOP", how: "caregiver_pause" }, false);
        return null;
      }
      const window = await driver!.listen();
      const safety = await runtime.call("check_safety_phrases", { audio_window: window });
      if (safety.category === null) return window;
      await runtime.call("send_safety_alert", { category: safety.category, caregiver_ids: ctx.setup.current().safety.designated_caregivers.map((c) => c.person_id) });
      dispatch({ type: "SAFETY_MATCHED", category: safety.category });
      await speakIfThere(fixed.safety);
      return null;
    };
    const stop = async (): Promise<void> => {
      // An explicit stop ends the flow at once. One kind goodbye; no persuading, no second try (rule 12).
      dispatch({ type: "STOP", how: "explicit_stop" });
      await speakIfThere(fixed.stop_ack);
    };

    const history: Array<{ turn_id: string; turn_state: ToolOutput<"assess_conversation_state">["state"] }> = [];
    while (!ended()) {
      const window = await hear();
      if (!window) break;
      const heard = await runtime.call("assess_conversation_state", { topic_id: topicId, audio_window: window, turn_history: history });
      if (heard.evidence.conduct_signal === "stop_request") {
        await stop();
        break;
      }
      if (heard.evidence.conduct_signal === "identity_question") {
        // Any time she asks, Recall says what it is. No rung is used up; the question on the table still stands.
        await speak(fixed.identity!);
        dispatch({ type: "IDENTITY_ASKED", prompt_id: fixed.identity!.prompt_id });
        continue;
      }
      history.push({ turn_id: heard.turn_id, turn_state: heard.state });
      dispatch({ type: "TURN_ASSESSED", turn_id: heard.turn_id, turn_state: heard.state, silent: heard.silent });

      if (machine().state === "lost") {
        const pick = await runtime.call("select_scaffold", { topic_id: topicId, state: heard.state, verified_ids: verified, rungs_fired: machine().context.rungs_fired });
        if (pick.rung === null || !pick.scaffold_id) {
          dispatch({ type: "LADDER_EXHAUSTED", reason: "the ladder has nothing more that is verified to offer" });
        } else {
          const prompt = await runtime.call("render_prompt", { topic_id: topicId, scaffold_id: pick.scaffold_id, slot_ids: pick.slot_ids, citations: pick.citations });
          await speak(prompt);
          dispatch({ type: "RUNG_DELIVERED", rung: pick.rung as Rung, prompt_id: prompt.prompt_id, citations: pick.citations, cue_id: pick.cue?.cue_id ?? null });
        }
      }
      // A close after no answer is always kind, and never frames what happened as a failure (section 6.2).
      if (machine().state === "no_answer_today" || machine().state === "not_stored") {
        await speakIfThere(fixed.close_kind);
        break;
      }
      if (machine().state !== "recalled") continue;
      if (machine().context.answer_turn_id === null) {
        // She is with it. Ask the open follow-up, and capture what she says next - in her words, not Recall's.
        await speak(fixed.elaborate!);
        continue;
      }

      const captured = await runtime.call("capture_contribution", { topic_id: topicId, audio_intervals: [{ asset_id: window.asset_id, ...heard.evidence.span }] });
      dispatch({ type: "CONTRIBUTION_CAPTURED", contribution_hash: captured.content_hash, trims: captured.trims.length, generated_first_person_words: captured.generated_first_person_words });

      // She hears exactly what would be kept - her own recording, never a synthesis - and then the question.
      await driver.playback({ asset_id: window.asset_id, spans: captured.kept });
      await speak(fixed.store_question!);
      const storeReply = await hear();
      if (!storeReply) break;
      const store = await runtime.call("confirm_and_store", { step: "confirm", contribution_hash: captured.content_hash, audio_window: storeReply });
      if (store.step !== "confirm") throw new Error("unreachable");
      if (store.stop_requested) {
        await stop();
        break;
      }
      dispatch({ type: "STORE_CONFIRMATION_RECORDED", confirmation_id: store.confirmation_id, decision: store.decision, contribution_hash: store.contribution_hash });
      if (machine().state !== "confirmed") {
        await speakIfThere(fixed.close_not_stored);
        break;
      }

      await speak(fixed.share_question!);
      const shareReply = await hear();
      if (!shareReply) break; // a stop here leaves nothing stored: commit comes last (section 5)
      let share: ToolOutput<"confirm_share">;
      try {
        share = await runtime.call("confirm_share", { contribution_hash: captured.content_hash, audio_window: shareReply });
      } catch (e) {
        if (!(e instanceof ToolTimeoutError)) throw e;
        // Her answer to the share question never blocks storing (section 5): the reducer resolves it as "not shared",
        // and the record of that is taken with no window, so the commit still has the gate's share decision to check.
        dispatch({ type: "TOOL_TIMEOUT", tool: e.tool });
        share = await runtime.call("confirm_share", { contribution_hash: captured.content_hash, audio_window: null });
      }
      if (share.stop_requested) {
        await stop();
        break;
      }
      if (!machine().context.share_resolved) dispatch({ type: "SHARE_CONFIRMATION_RECORDED", confirmation_id: share.share_confirmation_id, decision: share.decision, contribution_hash: share.contribution_hash });

      const committed = await runtime.call("confirm_and_store", { step: "commit", contribution_hash: captured.content_hash, policy_token_id: tokenId });
      if (committed.step !== "commit") throw new Error("unreachable");
      dispatch({ type: "CONTRIBUTION_STORED", claim_id: committed.claim_id, contribution_hash: committed.contribution_hash, shared: committed.shared });
      await speakIfThere(fixed.close_warm);
    }
  } catch (e) {
    if (ended()) {
      // The run already ended safely (for instance the call length ran out mid-step). Nothing more to decide.
      if (!(e instanceof GateError) && !(e instanceof ToolTimeoutError) && !isDropped(e) && !(e instanceof Error && e.name === "InvalidTransitionError")) throw e;
    } else if (isDropped(e)) {
      // She hung up. That is a stop like any other: nothing is stored beyond metadata, and nobody calls back.
      dispatch({ type: "STOP", how: "hang_up" }, false);
    } else if (e instanceof GateError) {
      // A missing gate stops the flow. Mid-call, Recall says the safe-narrowing line - a success state (rule 7).
      const inCall = IN_CALL.includes(machine().state);
      dispatch({ type: "GATE_MISSING", gate: e.gate, detail: e.detail });
      if (inCall && connected) await speakIfThere(fixed.narrowing);
    } else if (e instanceof ToolTimeoutError) {
      dispatch({ type: "TOOL_TIMEOUT", tool: e.tool });
      if (machine().context.fallback_active && connected && !ended()) {
        // Fixed script, no tools: restate the current question once, then close kindly.
        const current = ctx.session.spoken.at(-1);
        const again = current ? ctx.session.prompts.find((p) => p.prompt_id === current.prompt_id) : undefined;
        if (again) {
          await speakIfThere(again);
          dispatch({ type: "FIXED_RESTATEMENT_DELIVERED", prompt_id: again.prompt_id }, false);
        }
        await speakIfThere(fixed.close_kind);
        dispatch({ type: "CALL_CLOSED" }, false);
      }
    } else throw e;
  }

  return finish(env, connected ? openLine.hangUp : null, connected);
}

async function finish(env: RunEnv, hangUp: (() => Promise<void>) | null, connected: boolean): Promise<RunResult> {
  const { ctx, runtime, store } = env;
  if (hangUp) await hangUp();

  // Rule 8: at call end, anything she did not confirm is dropped. Only a committed contribution is kept.
  if (ctx.session.stored === null && (ctx.session.contribution !== null || ctx.session.call_asset_id !== null)) {
    ctx.session.contribution = null;
    ctx.session.store_confirmation = null;
    ctx.session.share_confirmation = null;
    ctx.session.unconfirmed_audio_discarded = true;
  }

  // What happened on the topic, and the fact of the call. Metadata only; a tool that does not respond must not mask how the run ended.
  if (connected && ctx.session.topic) {
    try {
      const last = ctx.session.assessments.at(-1);
      await runtime.call("record_retrieval_outcome", { topic_id: ctx.session.topic.topic_id, scaffold_id: ctx.session.spoken.filter((s) => s.rung !== null).at(-1)?.script_id ?? null, state: last?.state ?? "none" });
    } catch (e) {
      if (!(e instanceof ToolTimeoutError)) throw e;
    }
  }

  let receipt: RunResult["receipt"] = null;
  try {
    receipt = await runtime.call("build_caregiver_receipt", { session_id: ctx.session.session_id });
  } catch (e) {
    if (!(e instanceof ToolTimeoutError)) throw e;
  }
  // Nothing is sent to anyone here. The receipt and the record appear when an approved member opens the dashboard (rule 5).
  return { machine: store.getState().machine, receipt };
}
