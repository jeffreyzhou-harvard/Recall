/**
 * Muse Spark, via the Meta Model API (https://dev.meta.ai/docs). Built from the
 * published protocol, not from guesswork:
 *
 *   POST https://api.meta.ai/v1/chat/completions      (OpenAI-compatible)
 *   Authorization: Bearer <MODEL_API_KEY>
 *   model: "muse-spark-1.3"
 *
 * LIVE ONLY, SERVER ONLY. The key must never reach a browser, and nothing on
 * the judged path imports this.
 *
 * Recall never lets a model's output act directly. `structured` asks for JSON
 * matching a zod schema and then VALIDATES what comes back against that same
 * schema: a reply that does not parse is an error, not a best effort. What the
 * validated output is allowed to do is decided by the caller's own guards -
 * `applyAnswer` for graph facts, the scaffold ladder's eligibility rules for
 * support - never by the model.
 */
import { z } from "zod";

export const MUSE_API_BASE = "https://api.meta.ai/v1";
export const MUSE_SPARK_MODEL = "muse-spark-1.3";
/** Verified against the live API: muse-spark-1.3 rejects "none", although the docs page lists it. */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type MuseFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string | FormData; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export class MuseApiError extends Error {
  constructor(
    public readonly status: number | null,
    detail: string,
  ) {
    super(`Muse API error${status ? ` (${status})` : ""}: ${detail}`);
    this.name = "MuseApiError";
  }
}

/** Refuses anything that does not look like a Model API key, so a missing or mangled key fails at start-up, not mid-call. */
export function requireMuseKey(key: string | undefined): string {
  if (!key || key.trim() === "") throw new MuseApiError(null, "MUSE_API_KEY is not set (put it in .env.local; never commit it)");
  return key.trim();
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }), finish_reason: z.string().nullish() })).min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number(), total_tokens: z.number() }).optional(),
});

export interface SparkOptions {
  reasoning_effort?: ReasoningEffort;
  /**
   * Spark's REASONING is billed against this too (verified live: a few hundred tokens even at "minimal").
   * Set it too low and the reply comes back empty with finish_reason "length". Leave real headroom.
   */
  max_completion_tokens?: number;
  temperature?: number;
  /** Give up after this long. Someone may be waiting on the line; every caller already has a fallback. */
  timeout_ms?: number;
}

export class MuseSpark {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: MuseFetch = (url, init) => fetch(url, init),
    private readonly base = MUSE_API_BASE,
    private readonly model = MUSE_SPARK_MODEL,
  ) {}

  private async complete({ timeout_ms, ...body }: Record<string, unknown> & SparkOptions): Promise<string> {
    const res = await this.fetchImpl(`${this.base}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, ...body }),
      ...(timeout_ms ? { signal: AbortSignal.timeout(timeout_ms) } : {}),
    }).catch((e: unknown) => {
      throw new MuseApiError(null, e instanceof Error && e.name === "TimeoutError" ? `no reply within ${timeout_ms} ms` : `the request did not complete (${e instanceof Error ? e.message : "unknown"})`);
    });
    if (!res.ok) throw new MuseApiError(res.status, (await res.text().catch(() => "")).slice(0, 300) || "request failed");
    const parsed = completionSchema.safeParse(await res.json());
    if (!parsed.success) throw new MuseApiError(res.status, "the response was not a chat completion");
    const { message, finish_reason } = parsed.data.choices[0]!;
    const content = message.content;
    if (content === null || content.trim() === "") {
      throw new MuseApiError(res.status, finish_reason === "length" ? "the model spent its whole max_completion_tokens reasoning and never answered; raise the limit" : "the model returned no content");
    }
    return content;
  }

  chat(messages: ChatMessage[], options: SparkOptions = {}): Promise<string> {
    return this.complete({ messages, ...options });
  }

  /**
   * Ask for JSON matching `schema`, and accept nothing else. The schema is sent as the response format
   * and then enforced here: the model's word that it complied is not taken.
   */
  async structured<T>(name: string, schema: z.ZodType<T>, messages: ChatMessage[], options: SparkOptions = {}): Promise<T> {
    const content = await this.complete({
      messages,
      response_format: { type: "json_schema", json_schema: { name, strict: true, schema: z.toJSONSchema(schema) } },
      ...options,
    });
    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      throw new MuseApiError(null, `"${name}": the model did not return JSON`);
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new MuseApiError(null, `"${name}": the model's JSON does not match the schema (${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")})`);
    }
    return parsed.data;
  }
}
