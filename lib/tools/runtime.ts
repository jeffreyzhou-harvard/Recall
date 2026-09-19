/**
 * Tool runtime. Every call goes through here, which is what makes the tool
 * log complete: input and output JSON, latency, source ids, policy decision,
 * and the state transition the call caused (AGENTS.md section 6).
 *
 * The log is for the judge console. None of it is ever shown to the
 * participant.
 */
import type { FixtureClock } from "@/lib/clock";
import { ENFORCED_SEQUENCE, contracts, type ToolInput, type ToolName, type ToolOutput, type ToolParsedInput } from "./contracts";
import type { ToolContext } from "./context";
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

export type ToolImpl<T extends ToolName> = (input: ToolParsedInput<T>, ctx: ToolContext) => Promise<ToolOutput<T>>;
export type ToolImpls = { [T in ToolName]: ToolImpl<T> };

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
  /** Live side demo only: real timeout per call. */
  timeout_ms?: number;
}

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
  private readonly callCounts = new Map<ToolName, number>();

  constructor(
    private readonly ctx: ToolContext,
    private readonly impls: ToolImpls,
    private readonly options: RuntimeOptions = {},
  ) {}

  async call<T extends ToolName>(tool: T, rawInput: ToolInput<T>): Promise<ToolOutput<T>> {
    const count = (this.callCounts.get(tool) ?? 0) + 1;
    this.callCounts.set(tool, count);
    const startedAt = this.ctx.clock.iso();
    const startedMs = this.ctx.clock.now();
    const record: ToolCallRecord = {
      seq: this.log.length + 1,
      tool,
      step: ENFORCED_SEQUENCE.indexOf(tool) + 1,
      started_at: startedAt,
      latency_ms: 0,
      input: rawInput,
      output: null,
      error: null,
      source_ids: [],
      policy_decision: null,
      state_transition: null,
    };
    this.log.push(record);

    try {
      if (this.options.faults?.some((f) => f.tool === tool && f.on_call === count && f.kind === "timeout")) {
        throw new ToolTimeoutError(tool);
      }
      const input = contracts[tool].input.safeParse(rawInput);
      if (!input.success) throw new ToolContractError(tool, "input", input.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));

      const impl = this.impls[tool] as ToolImpl<T>;
      const raw = await this.withTimeout(tool, impl(input.data as ToolParsedInput<T>, this.ctx));

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
      record.latency_ms = this.ctx.clock.now() - startedMs;
    }
  }

  /** Link the most recent call of a tool to the transition it caused, so the console can show cause and effect. */
  noteTransition(seq: number, from: string, to: string): void {
    const record = this.log[seq - 1];
    if (record) record.state_transition = { from, to };
  }

  lastSeq(): number {
    return this.log.length;
  }

  private describePolicy(tool: ToolName, output: unknown): string | null {
    if (tool === "get_access_policy") {
      const o = output as ToolOutput<"get_access_policy">;
      return o.decision === "granted" ? "granted" : `denied:${o.reason}`;
    }
    if (tool === "query_context_graph" || tool === "verify_claim_support" || tool === "publish_contribution") {
      return "token_valid";
    }
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
