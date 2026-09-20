/**
 * Tool runtime. Every call goes through here, which is what makes the tool
 * log complete: input and output JSON, latency, source ids, policy decision,
 * and the state transition the call caused (AGENTS.md section 6).
 *
 * The log is for the judge console. None of it is ever shown to the
 * participant.
 */
import type { Clock, FixtureClock } from "@/lib/clock";
import { ENFORCED_SEQUENCE, contracts, isFamilyTool, type CallToolName, type FamilyToolName, type ToolInput, type ToolName, type ToolOutput, type ToolParsedInput } from "./contracts";
import type { FamilyToolContext, ToolContext } from "./context";
import { GateError } from "./gates";

export class ToolTimeoutError extends Error {
  constructor(public readonly tool: ToolName) {
    super(`${tool} did not respond in time`);
    this.name = "ToolTimeoutError";
  }
}

export class ToolContractError extends Error {
  constructor(
    public readonly tool: ToolName,
    public readonly side: "input" | "output",
    detail: string,
  ) {
    super(`${tool} ${side} does not match its contract: ${detail}`);
    this.name = "ToolContractError";
  }
}

/**
 * A family tool is handed the family context and cannot be handed the other one: the whitelist projection
 * is enforced by this type, so there is no family tool that "could" read the graph and merely does not.
 */
export type ContextFor<T extends ToolName> = T extends FamilyToolName ? FamilyToolContext : ToolContext;
export type ToolImpl<T extends ToolName> = (input: ToolParsedInput<T>, ctx: ContextFor<T>) => Promise<ToolOutput<T>>;
export type ToolImpls = { [T in ToolName]: ToolImpl<T> };

/** A runtime serves a call, the family side, or both. A tool whose context is absent cannot run. */
export interface RuntimeContexts {
  clock: Clock;
  call?: ToolContext;
  family?: FamilyToolContext;
}

/** Data-driven fault injection for branch tests. `on_call` counts calls to that tool, from 1. */
export interface Fault {
  tool: ToolName;
  on_call: number;
  kind: "timeout";
}

export interface ToolCallRecord {
  seq: number;
  tool: ToolName;
  /** Position in the enforced sequence, from 1. */
  step: number;
  started_at: string;
  latency_ms: number;
  input: unknown;
  output: unknown;
  error: { name: string; message: string; gate: string | null } | null;
  source_ids: string[];
  policy_decision: string | null;
  state_transition: { from: string; to: string } | null;
}

export interface RuntimeOptions {
  faults?: Fault[];
  /** Judged path only: advance the fixture clock by a fixed latency per call so timings replay identically. */
  fixtureLatency?: { clock: FixtureClock; ms: Partial<Record<ToolName, number>>; default_ms: number };
  /** Live only: deadline for each transcription/model request. Storage and alerts are awaited to completion. */
  timeout_ms?: number;
  /** Keep only the most recent calls. For a runtime that lives as long as the server does (the family side). */
  max_log?: number;
}

/**
 * What of a call's input goes in the log. The log is for showing what Recall did, and rule 8 outranks it: a
 * family member's question is never kept - not in the graph, and not here - and nor is who asked it.
 */
const LOGGED_INPUT: Partial<Record<ToolName, (input: unknown) => unknown>> = {
  handle_family_query: (input) => ({ question: "(not logged)", question_chars: typeof (input as { question?: unknown })?.question === "string" ? (input as { question: string }).question.length : 0, requester_id: "(not logged)" }),
};

/** Collect every evidence id an output mentions, for the log's `source_ids` column. */
function collectSourceIds(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => collectSourceIds(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if ((k === "source_id" || k === "node_id" || k === "root_id") && typeof v === "string") out.add(v);
      else if ((k === "citations" || k === "citation_ids") && Array.isArray(v)) {
        for (const c of v) typeof c === "string" ? out.add(c) : collectSourceIds(c, out);
      } else collectSourceIds(v, out);
    }
  }
  return out;
}

export class ToolRuntime {
  readonly log: ToolCallRecord[] = [];
  /** How many records have been dropped off the front of `log`, so that `seq` keeps counting. */
  private dropped = 0;
  private readonly callCounts = new Map<ToolName, number>();

  constructor(
    private readonly contexts: RuntimeContexts,
    private readonly impls: ToolImpls,
    private readonly options: RuntimeOptions = {},
  ) {}

  private contextFor<T extends ToolName>(tool: T): ContextFor<T> {
    const ctx = isFamilyTool(tool) ? this.contexts.family : this.contexts.call;
    if (!ctx) throw new Error(`${tool} cannot run here: this runtime has no ${isFamilyTool(tool) ? "family" : "call"} context`);
    return ctx as ContextFor<T>;
  }

  /**
   * Only race dependencies that return data and cannot mutate the tool context. Racing the whole
   * implementation leaves graph writes and consent updates running after a timeout exit. Writes and
   * alert delivery are instead awaited, so the caller always observes their actual outcome.
   */
  private contextForExecution<T extends ToolName>(tool: T): ContextFor<T> {
    const context = this.contextFor(tool);
    if (isFamilyTool(tool) || !this.options.timeout_ms) return context;
    const ctx = context as ToolContext;
    const transcription = ctx.transcription;
    return {
      ...ctx,
      transcription: {
        label: transcription.label,
        turnsIn: (window) => this.withTimeout(tool, transcription.turnsIn(window)),
        allTurns: (assetId) => this.withTimeout(tool, transcription.allTurns(assetId)),
      },
      scaffoldAdvisor: ctx.scaffoldAdvisor
        ? (advice) => this.withTimeout(tool, ctx.scaffoldAdvisor!(structuredClone(advice)))
        : undefined,
    } as ContextFor<T>;
  }

  async call<T extends ToolName>(tool: T, rawInput: ToolInput<T>): Promise<ToolOutput<T>> {
    const count = (this.callCounts.get(tool) ?? 0) + 1;
    this.callCounts.set(tool, count);
    const startedAt = this.contexts.clock.iso();
    const startedMs = this.contexts.clock.now();
    const record: ToolCallRecord = {
      seq: this.dropped + this.log.length + 1,
      tool,
      step: ENFORCED_SEQUENCE.indexOf(tool as CallToolName) + 1,
      started_at: startedAt,
      latency_ms: 0,
      input: LOGGED_INPUT[tool]?.(rawInput) ?? rawInput,
      output: null,
      error: null,
      source_ids: [],
      policy_decision: null,
      state_transition: null,
    };
    this.log.push(record);
    const max = this.options.max_log;
    if (max && this.log.length > max) this.dropped += this.log.splice(0, this.log.length - max).length;

    try {
      if (this.options.faults?.some((f) => f.tool === tool && f.on_call === count && f.kind === "timeout")) {
        throw new ToolTimeoutError(tool);
      }
      const input = contracts[tool].input.safeParse(rawInput);
      if (!input.success) throw new ToolContractError(tool, "input", input.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));

      const impl = this.impls[tool] as ToolImpl<T>;
      const context = this.contextForExecution(tool);
      const execute = () => impl(input.data as ToolParsedInput<T>, context);
      const call = !isFamilyTool(tool) ? context as ToolContext : null;
      const commit = tool === "confirm_and_store" && (input.data as { step: string }).step === "commit";
      const raw = call?.graph.atomic && (commit || tool === "record_retrieval_outcome")
        ? await call.graph.atomic(execute)
        : await execute();

      const output = contracts[tool].output.safeParse(raw);
      if (!output.success) throw new ToolContractError(tool, "output", output.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));

      record.output = output.data;
      record.source_ids = [...collectSourceIds(output.data)].sort();
      record.policy_decision = this.describePolicy(tool, output.data);
      return output.data as ToolOutput<T>;
    } catch (e) {
      const err = e as Error;
      record.error = { name: err.name, message: err.message, gate: e instanceof GateError ? e.gate : null };
      if (e instanceof GateError) record.policy_decision = `gate_failed:${e.gate}`;
      throw e;
    } finally {
      const fx = this.options.fixtureLatency;
      if (fx) fx.clock.advance(fx.ms[tool] ?? fx.default_ms);
      record.latency_ms = this.contexts.clock.now() - startedMs;
    }
  }

  /** Link the most recent call of a tool to the transition it caused, so the console can show cause and effect. */
  noteTransition(seq: number, from: string, to: string): void {
    const record = this.log[seq - 1 - this.dropped];
    if (record) record.state_transition = { from, to };
  }

  lastSeq(): number {
    return this.dropped + this.log.length;
  }

  /**
   * Rule 8: when a call ends with nothing confirmed, only metadata remains - and the log is no exception. What
   * she said is taken out of every record; that a turn was heard, how it was classified, and when, all stay.
   */
  forgetHerWords(): void {
    for (const record of this.log) {
      const out = record.output as Record<string, unknown> | null;
      if (!out) continue;
      if (record.tool === "assess_conversation_state" && out.evidence && typeof out.evidence === "object") (out.evidence as Record<string, unknown>).transcript = "";
      if (record.tool === "capture_contribution") Object.assign(out, { literal_transcript: "", words: [] });
    }
  }

  private describePolicy(tool: ToolName, output: unknown): string | null {
    if (tool === "place_recall_call") {
      const o = output as ToolOutput<"place_recall_call">;
      return o.decision === "granted" ? "granted" : `denied:${o.reason}`;
    }
    if (tool === "query_context_graph" || tool === "verify_claim_support" || tool === "render_prompt") return "token_valid";
    if (tool === "build_weekly_note" || tool === "get_topic_record") return (output as { status: string }).status === "no_access" ? "denied:no_dashboard_access" : "access_granted";
    if (tool === "export_record_for_clinician") return (output as { status: string }).status === "refused" ? "denied:not_an_approved_member" : "access_granted";
    return null;
  }

  private async withTimeout<R>(tool: ToolName, work: Promise<R>): Promise<R> {
    const ms = this.options.timeout_ms;
    if (!ms) return work;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ToolTimeoutError(tool)), ms);
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
