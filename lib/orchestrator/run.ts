/**
 * The orchestrator walks the enforced tool sequence and feeds the reducer:
 *
 *   inspect request -> verify identities -> get policy -> query permitted graph
 *   -> verify evidence -> assess conversation state -> select least-helpful
 *   scaffold -> render only cited context -> capture exact contribution
 *   -> play back for assent -> publish only if assent/audience/hash still match
 *   -> build caregiver receipt
 *
 * It holds no judgment of its own. Tools decide, gates refuse, and the reducer
 * records. A GateError or a timeout is not something to recover from here: it
 * becomes the corresponding deterministic transition and the run ends safely.
 */
import type { StoreApi } from "zustand/vanilla";
import { NOTICE_TEXT } from "@/lib/bridge/thread-bridge";
import type { RelayEvent } from "@/lib/state/machine";
import { TERMINAL } from "@/lib/state/machine";
import type { MachineState } from "@/lib/state/reducer";
import type { RelayStore } from "@/lib/state/store";
import { GateError, ToolTimeoutError, type ScaffoldId, type ToolContext, type ToolOutput, type ToolRuntime } from "@/lib/tools";
import type { CallDriver } from "./call-driver";

export interface RunEnv {
  thread_id: string;
  ctx: ToolContext;
  runtime: ToolRuntime;
  store: StoreApi<RelayStore>;
  /** Called exactly once, and only after the policy has been granted: no grant, no call. */
  callDriver: (() => CallDriver) | null;
}

export interface RunResult {
  machine: MachineState;
  receipt: ToolOutput<"build_caregiver_receipt"> | null;
}

type Prompt = ToolOutput<"render_prompt">;

export async function runAsk(env: RunEnv): Promise<RunResult> {
  const { ctx, runtime, store } = env;
  const machine = (): MachineState => store.getState().machine;
  let driver: CallDriver | null = null;

  /** Dispatch an event, stamped with the injected clock and linked to the tool call that caused it. */
  const dispatch = (event: RelayEvent, fromTool = true): MachineState => {
    const before = machine().state;
    const seq = fromTool ? runtime.lastSeq() : null;
    const next = store.getState().dispatch(event, { at: ctx.clock.iso(), tool_call_seq: seq });
    if (seq) runtime.noteTransition(seq, before, next.state);
    return next;
  };

  /** Say a rendered line on the call, and record that it was actually said. */
  const speak = async (prompt: Prompt): Promise<void> => {
    await driver!.speak(prompt);
    ctx.session.spoken.push({ prompt_id: prompt.prompt_id, kind: prompt.kind, text: prompt.text, at: ctx.clock.iso() });
  };

  // Rendered and cited before the call is placed, so the fixed script needs no tool if tools later fail.
  let brief: Prompt | null = null;
  const fixed: Partial<Record<"narrowing" | "wrap_up" | "close_kindly", Prompt>> = {};
  let connected = false;

  try {
    const ask = await runtime.call("inspect_request", { thread_id: env.thread_id });
    dispatch({ type: "ASK_FORWARDED", ask_id: ask.ask_id, thread_id: ask.thread_id, asker_id: ask.asker_id, addressee_id: ask.addressee_id });

    const identity = await runtime.call("resolve_identity_and_relationships", { ask_id: ask.ask_id, participants: ask.participants });
    if (!identity.verified) {
      throw new GateError("identity", identity.mismatches.map((m) => `${m.participant}: ${m.reason}`).join("; "));
    }

    const policy = await runtime.call("get_access_policy", {
      ask_id: ask.ask_id,
      person: ask.addressee_id,
      purpose: "answer_current_ask",
      audience: ask.requested_audience,
    });
    if (policy.decision === "denied") {
      dispatch({ type: "POLICY_DENIED", reason: policy.reason });
      return await finish(env, null);
    }
    dispatch({ type: "POLICY_GRANTED", policy_token_id: policy.policy_token_id, audience: ask.requested_audience });
    const tokenId = policy.policy_token_id;

    const retrieval = await runtime.call("query_context_graph", {
      ask_id: ask.ask_id,
      question: ask.text,
      allowed_sources: policy.allowed_source_classes,
      max_hops: 2,
      policy_token_id: tokenId,
    });

    const askFacts = [ask.asker_id, ...ask.topic_ids, ...ask.event_ids, ...ask.artifacts.map((a) => a.artifact_id)];
    const support = await runtime.call("verify_claim_support", {
      ask_id: ask.ask_id,
      claim_ids: [...new Set([...askFacts, ...retrieval.candidates.map((c) => c.root_id)])],
      policy_token_id: tokenId,
    });
    if (support.conflicts.length > 0) {
      dispatch({ type: "CLAIMS_CONFLICT", claim_ids: support.conflicts.flatMap((c) => [c.a, c.b]) });
    }
    const verified = support.verified.map((v) => v.claim_id);
    const only = (ids: readonly string[]): string[] => ids.filter((id) => verified.includes(id));

    brief = await runtime.call("render_prompt", {
      ask_id: ask.ask_id,
      scaffold_id: "brief",
      citations: only([ask.asker_id, ...ask.event_ids, ...ask.topic_ids.filter((t) => !ask.option_topic_ids.includes(t))]),
    });
    fixed.narrowing = await runtime.call("render_prompt", { ask_id: ask.ask_id, scaffold_id: "narrowing", citations: only([ask.asker_id]) });
    fixed.wrap_up = await runtime.call("render_prompt", { ask_id: ask.ask_id, scaffold_id: "wrap_up", citations: [] });
    fixed.close_kindly = await runtime.call("render_prompt", { ask_id: ask.ask_id, scaffold_id: "close_kindly", citations: [] });

    if (!env.callDriver) throw new Error("the policy was granted but this deployment has no way to place a call");
    driver = env.callDriver();
    await driver.connect();
    connected = true;
    ctx.session.call_asset_id = driver.call_asset_id;
    dispatch({ type: "CALL_CONNECTED", session_id: ctx.session.session_id }, false);

    await speak(brief);
    dispatch({ type: "BRIEF_DELIVERED", prompt_id: brief.prompt_id, citations: brief.segments.flatMap((s) => s.citation_ids) }, false);

    const history: Array<{ turn_id: string; turn_state: ToolOutput<"assess_conversation_state">["state"] }> = [];
    while (!TERMINAL.has(machine().state)) {
      const window = await driver.listen();
      const heard = await runtime.call("assess_conversation_state", { ask_id: ask.ask_id, audio_window: window, turn_history: history });
      history.push({ turn_id: heard.turn_id, turn_state: heard.state });
      dispatch({ type: "TURN_ASSESSED", turn_id: heard.turn_id, turn_state: heard.state });

      if (machine().state === "wrapped_up") {
        await speak(fixed.wrap_up!);
        break;
      }

      if (machine().state === "lost") {
        const pick = await runtime.call("select_scaffold", {
          ask_id: ask.ask_id,
          state: heard.state,
          repair_target: heard.evidence.repair_target,
          verified_ids: verified,
          scaffolds_used: machine().context.scaffolds_used as ScaffoldId[],
        });
        if (pick.scaffold_id === null) throw new GateError("evidence", "no scaffold has verified evidence to stand on");
        const prompt = await runtime.call("render_prompt", { ask_id: ask.ask_id, scaffold_id: pick.scaffold_id, citations: pick.citations });
        await speak(prompt);
        dispatch({
          type: "SCAFFOLD_DELIVERED",
          scaffold_id: pick.scaffold_id,
          prompt_id: prompt.prompt_id,
          citations: prompt.segments.flatMap((s) => s.citation_ids),
        });
        continue;
      }

      if (heard.state !== "answer_present") continue;

      const captured = await runtime.call("capture_exact_contribution", {
        ask_id: ask.ask_id,
        audio_intervals: [{ asset_id: window.asset_id, ...heard.evidence.span }],
      });
      dispatch({
        type: "CONTRIBUTION_CAPTURED",
        contribution_hash: captured.content_hash,
        trims: captured.trims.length,
        generated_first_person_words: captured.generated_first_person_words,
      });

      const confirm = await runtime.call("render_prompt", { ask_id: ask.ask_id, scaffold_id: "confirm_send", citations: only([ask.asker_id]) });
      await speak(confirm);
      await driver.playback();
      dispatch({ type: "PLAYBACK_STARTED", contribution_hash: captured.content_hash }, false);

      const reply = await driver.listen();
      const assent = await runtime.call("request_assent", {
        ask_id: ask.ask_id,
        contribution_hash: captured.content_hash,
        audience: ask.requested_audience,
        audio_window: reply,
      });
      dispatch({
        type: "ASSENT_RECORDED",
        assent_id: assent.assent_id,
        decision: assent.decision,
        contribution_hash: assent.contribution_hash,
        audience: assent.audience,
      });
      if (machine().state !== "assented") break;

      const delivery = await runtime.call("publish_contribution", {
        ask_id: ask.ask_id,
        hash: captured.content_hash,
        destination: ask.requested_audience,
        policy_token_id: tokenId,
      });
      dispatch({
        type: "PUBLISHED",
        delivery_id: delivery.delivery_id,
        contribution_hash: delivery.contribution_hash,
        destination: delivery.delivered_to,
      });
    }
  } catch (e) {
    if (e instanceof GateError) {
      // A missing gate stops the flow. Mid-call, Relay says the safe-narrowing line - a success state (rule 7).
      dispatch({ type: "GATE_MISSING", gate: e.gate, detail: e.detail });
      if (machine().state === "narrowed" && driver && fixed.narrowing) await speak(fixed.narrowing);
    } else if (e instanceof ToolTimeoutError) {
      dispatch({ type: "TOOL_TIMEOUT", tool: e.tool });
      if (machine().state === "fallback" && driver && brief && fixed.close_kindly) {
        // Fixed script, no tools: restate the question once, then close kindly.
        await speak(brief);
        dispatch({ type: "FIXED_RESTATEMENT_DELIVERED", prompt_id: brief.prompt_id }, false);
        await speak(fixed.close_kindly);
        dispatch({ type: "CALL_CLOSED" }, false);
      }
    } else throw e;
  }

  return finish(env, connected ? driver : null);
}

async function finish(env: RunEnv, driver: CallDriver | null): Promise<RunResult> {
  const { ctx, runtime, store } = env;
  if (driver) await driver.hangUp();

  // Rule 8: at call end, anything she did not approve is dropped. Only a delivered contribution is kept.
  if (ctx.session.delivery === null && (ctx.session.contribution !== null || ctx.session.call_asset_id !== null)) {
    ctx.session.contribution = null;
    ctx.session.assent = null;
    ctx.session.unapproved_audio_discarded = true;
  }

  let receipt: RunResult["receipt"] = null;
  try {
    receipt = await runtime.call("build_caregiver_receipt", { session_id: ctx.session.session_id });
  } catch (e) {
    // A receipt that cannot be built must not mask how the run actually ended.
    if (!(e instanceof ToolTimeoutError)) throw e;
  }

  // What the family sees. Everything goes through the bridge, as a reply to the forward this run answers.
  const machine = store.getState().machine;
  const ask = ctx.session.ask;
  const notice = machine.context.family_notice;
  if (ask && notice) {
    await ctx.bridge.post(
      { kind: "family_notice", in_reply_to: ask.forward_id, to: { thread_id: ask.thread_id }, notice, text: NOTICE_TEXT[notice], authored_by: "relay" },
      ctx.clock.iso(),
    );
  }
  // The non-clinical support receipt follows a delivery, and goes only to the relatives the joint setup named.
  if (ask && receipt && machine.state === "delivered") {
    const support = { session_id: receipt.session_id, lines: receipt.lines, scaffolds_logged: receipt.scaffolds_logged };
    for (const person_id of ctx.policy.support_receipt.recipients) {
      await ctx.bridge.post({ kind: "support_receipt", in_reply_to: ask.forward_id, to: { person_id }, receipt: support }, ctx.clock.iso());
    }
  }
  return { machine, receipt };
}
