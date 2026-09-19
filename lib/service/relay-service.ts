/**
 * The application seam. Two operations, matching the two things that can
 * happen to Relay from outside:
 *
 *   forwardAsk(payload)   a relative forwarded one ask out of the family thread
 *   runSession(threadId)  act on that thread's current ask, start to finish
 *
 * Everything is injected, so the judged path (fixtures, in-memory graph and
 * bridge, prerecorded call) and a live deployment (LadybugDB, a real bridge,
 * a live call driver) are the same code with different parts plugged in.
 * Nothing under /lib imports a fixture.
 */
import { NOTICE_TEXT, type ThreadBridge } from "@/lib/bridge/thread-bridge";
import type { Clock, FixtureClock } from "@/lib/clock";
import type { GraphStore } from "@/lib/graph/store";
import { LexicalAnswerInterpreter, applyAnswer, type Answer, type AnswerInterpreter, type ApplyResult } from "@/lib/discovery/answers";
import { findGaps } from "@/lib/discovery/gaps";
import { ingestLibrary, type IngestResult } from "@/lib/discovery/ingest";
import { assertSpeakable, questionFor, type Question } from "@/lib/discovery/questions";
import { IntakeError, type IntakeRejection } from "@/lib/intake/contract";
import { intakeForwardedAsk, type IntakeResult } from "@/lib/intake/intake";
import { LexicalAskInterpreter, type AskInterpreter } from "@/lib/intake/interpret";
import type { CallDriver } from "@/lib/orchestrator/call-driver";
import { runAsk } from "@/lib/orchestrator/run";
import type { AssetIndex } from "@/lib/provenance/assets";
import { ProvLog } from "@/lib/provenance/prov-log";
import type { TranscriptionProvider } from "@/lib/providers/transcription";
import { buildRecording, type SessionRecording } from "@/lib/session/recording";
import { createRelayStore } from "@/lib/state/store";
import { GateKeeper, TOOL_IMPLS, ToolRuntime, newSession, type AccessPolicy, type Fault, type ScaffoldAdvisor, type ToolContext, type ToolName } from "@/lib/tools";

export interface RelayDeps {
  graph: GraphStore;
  policy: AccessPolicy;
  assets: AssetIndex;
  clock: Clock;
  bridge: ThreadBridge;
  transcription: TranscriptionProvider;
  /** Places the call once the policy has been granted. Never invoked before that. Null means this deployment cannot call. */
  callDriver: (() => CallDriver) | null;
  interpreter?: AskInterpreter;
  /** Reads facts out of an answer. It only proposes: applyAnswer decides what is grounded enough to keep. */
  answerInterpreter?: AnswerInterpreter;
  /** Live only (Muse Spark). May pick among the scaffold rungs the ladder found eligible; see select_scaffold. */
  scaffoldAdvisor?: ScaffoldAdvisor;
  runtime?: {
    faults?: Fault[];
    fixtureLatency?: { clock: FixtureClock; ms: Partial<Record<ToolName, number>>; default_ms: number };
    timeout_ms?: number;
  };
}

export type ForwardOutcome =
  | ({ accepted: true } & IntakeResult)
  | { accepted: false; code: IntakeRejection; detail: string; clarify_posted: boolean };

/** A run in full: the recording for the views, plus the live objects for tests and the judge console. */
export interface SessionRun {
  recording: SessionRecording;
  ctx: ToolContext;
  runtime: ToolRuntime;
}

export class RelayService {
  private readonly interpreter: AskInterpreter;
  private readonly answerInterpreter: AnswerInterpreter;

  constructor(private readonly deps: RelayDeps) {
    this.interpreter = deps.interpreter ?? new LexicalAskInterpreter();
    this.answerInterpreter = deps.answerInterpreter ?? new LexicalAnswerInterpreter();
  }

  // --- discovery loop: photos -> questions -> answers -> richer graph --------------------------------------
  // Pull-based on purpose. Relay never schedules a question or starts a conversation: someone opens a
  // sitting and asks what Relay would like to know. No sitting, no questions.

  /** Observations from a photo library the family shared. Refused unless the joint setup allows it, kind by kind. */
  ingestLibrary(observations: unknown, grantedBy: string): Promise<IngestResult> {
    return ingestLibrary(observations, { graph: this.deps.graph, assets: this.deps.assets, policy: this.deps.policy, granted_by: grantedBy });
  }

  /** What Relay does not know yet, most useful first, each already worded and checked to cite only what it may. */
  async nextQuestions(limit = 3, askedThisSitting: ReadonlySet<string> = new Set()): Promise<Question[]> {
    const { graph, policy } = this.deps;
    if (!policy.discovery.enabled) return [];
    const gaps = await findGaps(graph, { participant_id: policy.person_id, invite_her_confirmation: policy.discovery.invite_her_confirmation, asked_this_session: askedThisSitting });
    const questions: Question[] = [];
    for (const gap of gaps.slice(0, limit)) {
      const q = await questionFor(gap, graph, policy.person_id);
      await assertSpeakable(q, graph);
      questions.push(q);
    }
    return questions;
  }

  /** Someone answered. Only what they literally said is kept as fact; see lib/discovery/answers.ts. */
  async answerQuestion(question: Question, answer: Answer): Promise<ApplyResult> {
    const { graph, policy } = this.deps;
    const speaker = { id: answer.by, is_participant: answer.by === policy.person_id };
    const proposals = await this.answerInterpreter.interpret(question, answer, speaker, policy.person_id);
    return applyAnswer(question, answer, proposals, { graph, policy });
  }

  /**
   * Request intake. A forward Relay cannot honestly write down is refused and leaves nothing in the
   * graph. If it came from a thread the family set up, that thread is asked to clarify; if even the
   * thread is unknown, Relay says nothing to anyone.
   */
  async forwardAsk(payload: unknown): Promise<ForwardOutcome> {
    const { graph, assets, bridge, clock, policy } = this.deps;
    try {
      const result = await intakeForwardedAsk(payload, { graph, assets, interpreter: this.interpreter, ask_ttl_hours: policy.ask_ttl_hours });
      bridge.registerForward(result.forward_id, result.thread_id);
      return { accepted: true, ...result };
    } catch (e) {
      if (!(e instanceof IntakeError)) throw e;
      const origin = payload as { forward_id?: unknown; thread_id?: unknown } | null;
      const thread = typeof origin?.thread_id === "string" ? await graph.getNode(origin.thread_id) : null;
      const knownThread = thread?.type === "Artifact" && thread.props.kind === "thread";
      let posted = false;
      if (knownThread && typeof origin?.forward_id === "string") {
        bridge.registerForward(origin.forward_id, thread.id);
        await bridge.post(
          { kind: "family_notice", in_reply_to: origin.forward_id, to: { thread_id: thread.id }, notice: "clarify", text: NOTICE_TEXT.clarify, authored_by: "relay" },
          clock.iso(),
        );
        posted = true;
      }
      return { accepted: false, code: e.code, detail: e.message, clarify_posted: posted };
    }
  }

  /** Act on the thread's current ask: gates, call, capture, assent, delivery, receipts. Always ends safely. */
  async runSession(threadId: string, sessionId: string): Promise<SessionRun> {
    const { deps } = this;
    const store = createRelayStore();
    const ctx: ToolContext = {
      graph: deps.graph,
      policy: deps.policy,
      assets: deps.assets,
      clock: deps.clock,
      gate: new GateKeeper(),
      transcription: deps.transcription,
      session: newSession(sessionId),
      prov: new ProvLog(),
      bridge: deps.bridge,
      machine: () => store.getState().machine,
      scaffoldAdvisor: deps.scaffoldAdvisor,
    };
    const runtime = new ToolRuntime(ctx, TOOL_IMPLS, deps.runtime ?? {});
    const already = deps.bridge.posted().length;
    const startedAt = deps.clock.iso();

    const { machine, receipt } = await runAsk({ thread_id: threadId, ctx, runtime, store, callDriver: deps.callDriver });

    const recording = await buildRecording({
      thread_id: threadId,
      started_at: startedAt,
      ended_at: deps.clock.iso(),
      machine,
      session: ctx.session,
      tool_log: runtime.log,
      messages: deps.bridge.posted().slice(already),
      receipt,
      graph: deps.graph,
    });
    return { recording, ctx, runtime };
  }
}
