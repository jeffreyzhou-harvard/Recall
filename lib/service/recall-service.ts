/**
 * Recall's service layer: the one place the call side and the family side meet.
 *
 *   runScheduledCall   the scheduler's tick: pick the topic that is due, check
 *                      the joint setup, call her, climb the ladder, capture,
 *                      confirm, store. Always ends safely.
 *   family flows       tell Recall a memory, the redirect-only ask box, the
 *                      Weekly Note, the per-topic record, the export.
 *   caregiver controls pause, revoke, clear a record layer.
 *
 * There is no method here by which a family member can cause a call to her
 * (rule 5). `runScheduledCall` takes no topic and no requester: what it does is
 * decided by the graph, the joint setup, and the clock. Nothing here sends
 * anything to family either, except the safety alert inside a call (rule 15):
 * the family side is read when an approved member opens it.
 */
import { dashboardAccess } from "@/lib/tools/policy";
import type { Clock, FixtureClock } from "@/lib/clock";
import { LexicalAnswerInterpreter, applyAnswer, type Answer, type AnswerInterpreter, type ApplyResult } from "@/lib/discovery/answers";
import { findGaps } from "@/lib/discovery/gaps";
import { ingestLibrary, type IngestResult } from "@/lib/discovery/ingest";
import { assertSpeakable, questionFor, type Question } from "@/lib/discovery/questions";
import type { FamilyCopy, RecordThresholds } from "@/lib/family/copy";
import { FamilyView } from "@/lib/family/projection";
import { clearRetrievalLayer, clearTopicRecord } from "@/lib/graph/retrieval-layer";
import type { GraphStore } from "@/lib/graph/store";
import type { CallDriver } from "@/lib/orchestrator/call-driver";
import { runRecallCall } from "@/lib/orchestrator/run";
import type { AssetIndex } from "@/lib/provenance/assets";
import { ProvLog } from "@/lib/provenance/prov-log";
import type { TranscriptionProvider } from "@/lib/providers/transcription";
import type { AlertChannel } from "@/lib/safety/alert";
import type { SafetyPhrases } from "@/lib/safety/phrases";
import type { CallScript } from "@/lib/script/call-script";
import { buildRecording, type SessionRecording } from "@/lib/session/recording";
import { createRecallStore } from "@/lib/state/store";
import { GateKeeper, TOOL_IMPLS, ToolRuntime, newSession, type FamilyToolContext, type Fault, type ScaffoldAdvisor, type SetupStore, type ToolContext, type ToolInput, type ToolName, type ToolOutput } from "@/lib/tools";

export interface RecallDeps {
  graph: GraphStore;
  /** The live joint setup. Read fresh at every call and every dashboard load, so a revocation is in force before the next one. */
  setup: SetupStore;
  assets: AssetIndex;
  clock: Clock;
  transcription: TranscriptionProvider;
  script: CallScript;
  copy: FamilyCopy;
  thresholds: RecordThresholds;
  safetyPhrases: SafetyPhrases;
  alerts: AlertChannel;
  /** Places the call once the policy has granted it. Never invoked before that. Null means this deployment cannot call. */
  callDriver: (() => CallDriver) | null;
  /** Reads facts out of an answer. It only proposes: applyAnswer decides what is grounded enough to keep. */
  answerInterpreter?: AnswerInterpreter;
  /** Live only (Muse Spark). May pick WHICH cue where the retrieval layer has no preference; see select_scaffold. */
  scaffoldAdvisor?: ScaffoldAdvisor;
  runtime?: {
    faults?: Fault[];
    fixtureLatency?: { clock: FixtureClock; ms: Partial<Record<ToolName, number>>; default_ms: number };
    timeout_ms?: number;
  };
}

export interface SessionRun {
  recording: SessionRecording;
  ctx: ToolContext;
  runtime: ToolRuntime;
}

type FamilyTool = "receive_family_contribution" | "handle_family_query" | "build_weekly_note" | "get_topic_record" | "export_record_for_clinician";

export class RecallService {
  private readonly answerInterpreter: AnswerInterpreter;
  /** The family side's tool log, for the judge console. Kept apart from any call's log. */
  readonly familyRuntime: ToolRuntime;

  constructor(private readonly deps: RecallDeps) {
    this.answerInterpreter = deps.answerInterpreter ?? new LexicalAnswerInterpreter();
    const family: FamilyToolContext = {
      view: new FamilyView(deps.graph, deps.setup.current().person_id),
      assets: deps.assets,
      setup: deps.setup,
      clock: deps.clock,
      script: deps.script,
      copy: deps.copy,
      thresholds: deps.thresholds,
    };
    // A runtime with a family context and no call context: a family flow cannot run a call tool even by mistake.
    this.familyRuntime = new ToolRuntime({ clock: deps.clock, family }, TOOL_IMPLS, { max_log: 500 });
  }

  // --- the recall call -----------------------------------------------------------------------------------------

  /**
   * One tick of the schedule. Picks the topic that is due, and - only if the joint setup allows it, now -
   * calls her. A blocked call is a finished, recorded run like any other. Returns null when nothing is due.
   */
  async runScheduledCall(sessionId: string): Promise<SessionRun | null> {
    const { deps } = this;
    const store = createRecallStore();
    const personId = deps.setup.current().person_id;
    const ctx: ToolContext = {
      graph: deps.graph,
      setup: deps.setup,
      assets: deps.assets,
      clock: deps.clock,
      gate: new GateKeeper(),
      transcription: deps.transcription,
      session: newSession(sessionId),
      prov: new ProvLog(),
      script: deps.script,
      copy: deps.copy,
      safetyPhrases: deps.safetyPhrases,
      alerts: deps.alerts,
      machine: () => store.getState().machine,
      scaffoldAdvisor: deps.scaffoldAdvisor,
    };
    const runtime = new ToolRuntime({ clock: deps.clock, call: ctx }, TOOL_IMPLS, deps.runtime ?? {});
    const startedAt = deps.clock.iso();
    const { machine, receipt } = await runRecallCall({ person_id: personId, ctx, runtime, store, callDriver: deps.callDriver });
    if (machine.state === "idle") return null;
    const recording = await buildRecording({ person_id: personId, started_at: startedAt, ended_at: deps.clock.iso(), machine, session: ctx.session, tool_log: runtime.log, receipt });
    return { recording, ctx, runtime };
  }

  // --- the family side: read when an approved member opens it, never pushed ----------------------------------------

  /**
   * One family request at a time. Each one reads the graph and then writes to it - the next note's id, the access
   * log - so two dashboards opened at the same moment would mint the same id, and one of them would fail. A
   * request that fails does not hold up the next.
   */
  private familyQueue: Promise<unknown> = Promise.resolve();
  private family<T extends FamilyTool>(tool: T, input: ToolInput<T>): Promise<ToolOutput<T>> {
    const next = this.familyQueue.then(() => this.deps.graph.atomic
      ? this.deps.graph.atomic(() => this.familyRuntime.call(tool, input))
      : this.familyRuntime.call(tool, input));
    this.familyQueue = next.catch(() => undefined);
    return next;
  }

  /** "Tell Recall about a memory you share with Susan." One-way: it returns a thank-you or a hint, never anything from the graph. */
  tellRecallAMemory(input: ToolInput<"receive_family_contribution">): Promise<ToolOutput<"receive_family_contribution">> {
    return this.family("receive_family_contribution", input);
  }

  /** The "Ask about Susan" box. Whatever is typed, the reply is the redirect line (rule 10). */
  askAboutHer(question: string, requesterId: string): Promise<ToolOutput<"handle_family_query">> {
    return this.family("handle_family_query", { question, requester_id: requesterId });
  }

  /** The Weekly Note for one member, posted if one is due and there is anything to say. At most one per 7 days. */
  weeklyNote(memberId: string): Promise<ToolOutput<"build_weekly_note">> {
    return this.family("build_weekly_note", { member_id: memberId, week: { now: this.deps.clock.iso() } });
  }

  topicRecord(memberId: string): Promise<ToolOutput<"get_topic_record">> {
    return this.family("get_topic_record", { member_id: memberId });
  }

  exportRecord(requesterId: string): Promise<ToolOutput<"export_record_for_clinician">> {
    return this.family("export_record_for_clinician", { requester_id: requesterId });
  }

  /** Names and per-topic event counts only; the same whitelist as the record, with its access gate. */
  async dashboardInfo(memberId: string) {
    const policy = this.deps.setup.current();
    if (!policy.approved_people.includes(memberId)) return null;
    const view = new FamilyView(this.deps.graph, policy.person_id);
    const detail = dashboardAccess(policy, memberId);
    const rows = detail === "weekly_note_and_record" ? await view.outcomeRows() : [];
    const ordered = rows.sort((a, b) => a.at.localeCompare(b.at) || a.topic_key.localeCompare(b.topic_key));
    const sessions = ordered.map((row, i) => {
      const window = ordered.slice(0, i + 1).filter((r) => r.topic_key === row.topic_key).slice(-this.deps.thresholds.record_window_calls);
      return {
        id: `${row.topic_key}:${row.at}:${i}`, date: row.at.slice(0, 10), topicId: row.topic_key, topicName: row.topic_name,
        outcome: row.reached_at_rung === 1 ? "unaided" as const : row.reached_at_rung === 2 || row.reached_at_rung === 3 ? "cue" as const : row.reached_at_rung === 4 ? "recognition" as const : "unreached" as const,
        recentCalls: window.length,
        unaidedCalls: window.length >= this.deps.thresholds.min_calls_to_show ? window.filter((r) => r.reached_at_rung === 1).length : null,
      };
    });
    return { person_name: await view.herName(), member_name: await view.memberName(memberId), detail_level: detail, record_window_calls: this.deps.thresholds.record_window_calls, min_calls_to_show: this.deps.thresholds.min_calls_to_show, sessions, contributions: await view.ownContributions(memberId) };
  }

  // --- caregiver controls (rule 12; section 6.3) ----------------------------------------------------------------

  /** Each layer can be cleared on its own. Clearing one never touches the other. */
  clearRetrievalLayer(): Promise<number> {
    return clearRetrievalLayer(this.deps.graph);
  }

  clearTopicRecord(): Promise<number> {
    return clearTopicRecord(this.deps.graph);
  }

  // --- ask, don't assert: questions about what Recall does not know yet (section 7) ------------------------------------
  // Pull-based on purpose. Recall never schedules one of these: someone opens a sitting and asks what Recall
  // would like to know. No sitting, no questions.

  /** Observations about photos the family shared. Refused unless the joint setup allows it, kind by kind. */
  ingestLibrary(observations: unknown, grantedBy: string): Promise<IngestResult> {
    return ingestLibrary(observations, { graph: this.deps.graph, assets: this.deps.assets, policy: this.deps.setup.current(), granted_by: grantedBy });
  }

  /** What Recall does not know yet, most useful first, each already worded and checked to cite only what it may. */
  async nextQuestions(limit = 3, askedThisSitting: ReadonlySet<string> = new Set()): Promise<Question[]> {
    const { graph } = this.deps;
    const policy = this.deps.setup.current();
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
    const { graph } = this.deps;
    const policy = this.deps.setup.current();
    // Off means off: with discovery not turned on in the joint setup no answer is read - not even handed to a model - and nothing is kept.
    if (!policy.discovery.enabled) throw new Error("discovery is not turned on in the joint setup");
    const speaker = { id: answer.by, is_participant: answer.by === policy.person_id };
    const proposals = await this.answerInterpreter.interpret(question, answer, speaker, policy.person_id);
    return applyAnswer(question, answer, proposals, { graph, policy });
  }
}
