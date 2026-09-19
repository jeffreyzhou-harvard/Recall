/**
 * The provider clients - Deepgram (speech to words with timings) and Muse Spark (proposals only) - tested
 * against fakes built from their published protocols, and Muse Spark's one place in the engine: choosing
 * WHICH cue to offer. No call transport is tested here; the call feature is being built separately.
 */
import { describe, expect, it } from "vitest";
import { runFixture } from "@/fixtures/harness";
import type { Answer } from "@/lib/discovery/answers";
import type { Question } from "@/lib/discovery/questions";
import { MemoryGraphStore } from "@/lib/graph/memory-store";
import { DeepgramError, DeepgramLive, transcribeWav, type HeardTurn, type SocketLike, type TimersLike } from "@/lib/providers/deepgram";
import { INGEST_BUDGET_MS, MuseAnswerInterpreter, SCAFFOLD_ADVICE_BUDGET_MS, museScaffoldAdvisor } from "@/lib/providers/muse/reasoning";
import { MuseApiError, MuseSpark, type MuseFetch } from "@/lib/providers/muse/spark";
import type { RecallEvent } from "@/lib/state/machine";
import { replay } from "@/lib/state/reducer";
import type { ScaffoldAdvisor } from "@/lib/tools";

const KEY = "test-key-not-a-real-one";

// --- Deepgram ------------------------------------------------------------------------------------------------

class FakeSocket implements SocketLike {
  sent: Array<string | Uint8Array> = [];
  closed = false;
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onerror: SocketLike["onerror"] = null;
  onclose: SocketLike["onclose"] = null;
  send(data: string | ArrayBufferLike | ArrayBufferView): void {
    this.sent.push(typeof data === "string" ? data : new Uint8Array(data as ArrayBuffer));
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.({});
  }
  /** Deepgram speaking. Like a real WebSocket, a socket that has been closed delivers nothing more. */
  say(message: unknown): void {
    if (!this.closed) this.onmessage?.({ data: JSON.stringify(message) });
  }
  /** Deepgram closing its end, which is how a stream normally finishes after CloseStream. */
  serverCloses(): void {
    this.close();
  }
}
/** A clock run by hand: nothing fires until a test says so. */
class FakeTimers implements TimersLike {
  readonly scheduled = new Map<number, { fn: () => void; ms: number; repeats: boolean }>();
  private next = 1;
  setTimeout(fn: () => void, ms: number): unknown {
    this.scheduled.set(this.next, { fn, ms, repeats: false });
    return this.next++;
  }
  setInterval(fn: () => void, ms: number): unknown {
    this.scheduled.set(this.next, { fn, ms, repeats: true });
    return this.next++;
  }
  clearTimeout(handle: unknown): void {
    this.scheduled.delete(handle as number);
  }
  clearInterval(handle: unknown): void {
    this.scheduled.delete(handle as number);
  }
  waiting(repeats: boolean): number[] {
    return [...this.scheduled.values()].filter((t) => t.repeats === repeats).map((t) => t.ms);
  }
  fire(repeats: boolean): void {
    for (const [handle, t] of [...this.scheduled]) {
      if (t.repeats !== repeats) continue;
      if (!repeats) this.scheduled.delete(handle);
      t.fn();
    }
  }
}
const result = (words: Array<[string, number, number]>, flags: { is_final: boolean; speech_final?: boolean }) => ({
  type: "Results",
  ...flags,
  channel: { alternatives: [{ transcript: words.map((w) => w[0]).join(" "), words: words.map(([w, start, end]) => ({ word: w.toLowerCase().replace(/\W/g, ""), punctuated_word: w, start, end, confidence: 0.99 })) }] },
});

describe("Deepgram streaming", () => {
  const open = () => {
    const socket = new FakeSocket();
    const timers = new FakeTimers();
    const turns: HeardTurn[] = [];
    const errors: DeepgramError[] = [];
    let closedCount = 0;
    let opened: { url: string; protocols: string[] } | null = null;
    const live = new DeepgramLive(KEY, { keyterms: ["kheer"] }, { onTurn: (t) => turns.push(t), onError: (e) => errors.push(e), onClosed: () => closedCount++ }, (url, protocols) => ((opened = { url, protocols }), socket), timers);
    return { socket, timers, turns, errors, live, opened: () => opened!, closedCount: () => closedCount };
  };
  const CLOSE_STREAM = JSON.stringify({ type: "CloseStream" });
  const KEEP_ALIVE = JSON.stringify({ type: "KeepAlive" });

  it("authenticates by subprotocol, so the key is never in a URL, and asks for word timings and endpointing", () => {
    const { opened } = open();
    expect(opened().protocols).toEqual(["token", KEY]);
    expect(opened().url).not.toContain(KEY);
    expect(opened().url).toMatch(/encoding=linear16.*sample_rate=16000.*interim_results=true.*endpointing=\d+.*keyterm=kheer/);
  });

  it("acts only on final results, and closes a turn only when she has finished speaking", () => {
    const { socket, turns } = open();
    socket.onopen?.({});
    socket.say(result([["Make", 0.1, 0.3]], { is_final: false })); // interim: never acted on
    socket.say(result([["Make", 0.1, 0.3], ["the", 0.32, 0.4]], { is_final: true })); // final, but she is still talking
    expect(turns).toEqual([]);
    socket.say(result([["kheer.", 0.42, 0.9]], { is_final: true, speech_final: true }));
    expect(turns).toEqual([{ start_ms: 100, end_ms: 900, words: [{ w: "Make", start_ms: 100, end_ms: 300 }, { w: "the", start_ms: 320, end_ms: 400 }, { w: "kheer.", start_ms: 420, end_ms: 900 }] }]);
    expect(JSON.stringify(turns)).not.toContain("confidence"); // confidence is read by nobody and kept nowhere
  });

  it("also closes a turn on UtteranceEnd, holds audio until the socket opens, and ends cleanly", () => {
    const { socket, turns, live } = open();
    live.sendAudio(new Uint8Array([1, 2]));
    expect(socket.sent).toEqual([]);
    socket.onopen?.({});
    expect(socket.sent).toEqual([new Uint8Array([1, 2])]);
    socket.say(result([["Yes.", 1, 1.4]], { is_final: true }));
    socket.say({ type: "UtteranceEnd", last_word_end: 1.4 });
    expect(turns.map((t) => t.words.map((w) => w.w).join(" "))).toEqual(["Yes."]);
    live.end();
    expect(socket.sent.at(-1)).toBe(CLOSE_STREAM);
    live.sendAudio(new Uint8Array([3])); // nothing more is sent once she is done
    expect(socket.sent.at(-1)).toBe(CLOSE_STREAM);
    socket.serverCloses();
    expect(socket.closed).toBe(true);
  });

  it("does not drop her last words: after end() it keeps listening until Deepgram has sent its finals and closed", () => {
    const { socket, timers, turns, live, closedCount } = open();
    socket.onopen?.({});
    live.sendAudio(new Uint8Array([1, 2]));
    live.end();
    expect(socket.sent.at(-1)).toBe(CLOSE_STREAM);
    expect(socket.closed, "closing now would discard the results for audio Deepgram still holds").toBe(false);
    socket.say(result([["Every", 2, 2.3], ["summer.", 2.32, 2.9]], { is_final: true, speech_final: true }));
    expect(turns.map((t) => t.words.map((w) => w.w).join(" "))).toEqual(["Every summer."]);
    expect(timers.waiting(false)).toEqual([2500]); // the fallback, in case Deepgram never closes
    socket.serverCloses();
    expect(closedCount()).toBe(1);
    expect(timers.scheduled.size, "nothing is left ticking once the socket has closed").toBe(0);
  });

  it("closes the socket itself if Deepgram has not, and flushes what it was holding", () => {
    const { socket, timers, turns, live, closedCount } = open();
    socket.onopen?.({});
    socket.say(result([["Cape", 1, 1.2], ["May.", 1.22, 1.6]], { is_final: true })); // final, but no end-of-speech signal yet
    live.end();
    expect(socket.closed).toBe(false);
    timers.fire(false);
    expect(socket.closed).toBe(true);
    expect(turns.map((t) => t.words.map((w) => w.w).join(" "))).toEqual(["Cape May."]);
    expect(closedCount()).toBe(1);
    // A socket that never opened has nothing buffered at Deepgram to wait for.
    const unopened = open();
    unopened.live.end();
    expect(unopened.socket.closed).toBe(true);
    expect(unopened.socket.sent).toEqual([]);
  });

  it("keeps the socket alive through her silences, and stops when the stream ends", () => {
    const { socket, timers, live } = open();
    expect(timers.waiting(true)).toEqual([]); // nothing to keep alive until it opens
    socket.onopen?.({});
    expect(timers.waiting(true)).toEqual([5000]);
    timers.fire(true);
    timers.fire(true);
    expect(socket.sent).toEqual([KEEP_ALIVE, KEEP_ALIVE]);
    live.end();
    expect(timers.waiting(true)).toEqual([]);
    timers.fire(true);
    expect(socket.sent.at(-1)).toBe(CLOSE_STREAM);
  });

  it("closes the turn when UtteranceEnd arrives before the final result that carries its words", () => {
    const { socket, turns } = open();
    socket.onopen?.({});
    socket.say(result([["Yes.", 1, 1.4]], { is_final: false }));
    socket.say({ type: "UtteranceEnd", last_word_end: 1.4 }); // worked out from interim timings: the final is still on its way
    expect(turns).toEqual([]);
    socket.say(result([["Yes.", 1, 1.4]], { is_final: true })); // late, and with no speech_final of its own
    expect(turns.map((t) => t.words.map((w) => w.w).join(" "))).toEqual(["Yes."]);

    // The ordinary order - speech_final, then the UtteranceEnd for those same words - must not cut the NEXT turn short.
    socket.say(result([["We", 5, 5.2], ["went", 5.22, 5.5]], { is_final: true, speech_final: true }));
    socket.say({ type: "UtteranceEnd", last_word_end: 5.5 });
    socket.say(result([["every", 8, 8.3]], { is_final: true })); // she is still talking
    expect(turns).toHaveLength(2);
    socket.say(result([["summer.", 8.32, 8.9]], { is_final: true, speech_final: true }));
    expect(turns.map((t) => t.words.map((w) => w.w).join(" "))).toEqual(["Yes.", "We went", "every summer."]);
  });

  it("says so, once, when audio arrives faster than the socket opens - it is never dropped silently", () => {
    const { socket, errors, live } = open();
    for (let i = 0; i < 405; i++) live.sendAudio(new Uint8Array([i % 256]));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(DeepgramError);
    expect(errors[0]!.message).toMatch(/not open/);
    socket.onopen?.({});
    expect(socket.sent).toHaveLength(400); // what was held is still sent, in order
  });

  it("measures word timings for a whole recording", async () => {
    let seen: { url: string; auth: string } | null = null;
    const out = await transcribeWav(KEY, new Uint8Array(8), {}, async (url, init) => {
      seen = { url, auth: init.headers.authorization! };
      return { ok: true, status: 200, text: async () => "", json: async () => ({ results: { channels: [{ alternatives: [{ transcript: "Make the kheer.", words: [{ word: "make", punctuated_word: "Make", start: 0, end: 0.24 }] }] }] } }) };
    });
    expect(seen).toEqual({ url: expect.stringContaining("https://api.deepgram.com/v1/listen?model=nova-3"), auth: `Token ${KEY}` });
    expect(out.words).toEqual([{ w: "Make", start_ms: 0, end_ms: 240 }]);
  });
});

// --- Muse Spark ------------------------------------------------------------------------------------------------

const sparkReturning = (content: unknown, status = 200): { spark: MuseSpark; calls: Array<{ url: string; auth: string; body: Record<string, unknown> }> } => {
  const calls: Array<{ url: string; auth: string; body: Record<string, unknown> }> = [];
  const fetchImpl: MuseFetch = async (url, init) => {
    calls.push({ url, auth: init.headers.authorization!, body: JSON.parse(init.body as string) as Record<string, unknown> });
    return { ok: status === 200, status, text: async () => "upstream said no", json: async () => ({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }) };
  };
  return { spark: new MuseSpark(KEY, fetchImpl), calls };
};

describe("Muse Spark", () => {
  it("calls the documented endpoint with a bearer key and the documented model", async () => {
    const { spark, calls } = sparkReturning("ready");
    expect(await spark.chat([{ role: "user", content: "hi" }], { reasoning_effort: "minimal" })).toBe("ready");
    expect(calls[0]).toMatchObject({ url: "https://api.meta.ai/v1/chat/completions", auth: `Bearer ${KEY}`, body: { model: "muse-spark-1.3", reasoning_effort: "minimal" } });
  });

  it("does not take the model's word that it followed the schema", async () => {
    const { z } = await import("zod");
    const schema = z.strictObject({ dish: z.enum(["kheer", "halwa"]) });
    expect(await sparkReturning({ dish: "kheer" }).spark.structured("pick", schema, [])).toEqual({ dish: "kheer" });
    await expect(sparkReturning({ dish: "gulab jamun" }).spark.structured("pick", schema, [])).rejects.toBeInstanceOf(MuseApiError);
    await expect(sparkReturning({ dish: "kheer", because: "she likes it" }).spark.structured("pick", schema, [])).rejects.toThrow(/does not match the schema/);
    await expect(sparkReturning("not json").spark.structured("pick", schema, [])).rejects.toThrow(/did not return JSON/);
  });

  it("never puts the key in an error", async () => {
    await expect(sparkReturning("x", 401).spark.chat([])).rejects.toThrow(/^(?!.*test-key).*401/);
  });

  it("stops waiting when its time is up, and never sends the time limit to the API", async () => {
    let sent: { body: string; signal?: AbortSignal } | null = null;
    const never: MuseFetch = (_url, init) => ((sent = { body: init.body as string, signal: init.signal }), new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal!.reason))));
    await expect(new MuseSpark(KEY, never).chat([{ role: "user", content: "hi" }], { timeout_ms: 20 })).rejects.toThrow(/no reply within 20 ms/);
    expect(sent!.signal).toBeInstanceOf(AbortSignal);
    expect(sent!.body).not.toContain("timeout_ms");
  });

  it("turns a reply that is not JSON, or a body that never finishes arriving, into its own error", async () => {
    const notJson: MuseFetch = async () => ({ ok: true, status: 200, text: async () => "<html>", json: async () => Promise.reject(new SyntaxError("Unexpected token < in JSON at position 0")) });
    await expect(new MuseSpark(KEY, notJson).chat([])).rejects.toBeInstanceOf(MuseApiError);
    const stalled: MuseFetch = async () => ({ ok: true, status: 200, text: async () => "", json: async () => Promise.reject(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })) });
    await expect(new MuseSpark(KEY, stalled).chat([], { timeout_ms: 20 })).rejects.toThrow(/Muse API error.*no reply within 20 ms/);
  });

  it("never repeats the provider's error body, which can echo the request - and the request can hold her words (rule 8)", async () => {
    const echoing: MuseFetch = async () => ({ ok: false, status: 400, json: async () => ({}), text: async () => `{"error":"invalid request","request":{"what_they_said":"That's my daughter Maya."}}` });
    const refused: unknown = await new MuseSpark(KEY, echoing).chat([{ role: "user", content: "That's my daughter Maya." }]).then(
      () => null,
      (e: unknown) => e,
    );
    expect(refused).toBeInstanceOf(MuseApiError);
    expect((refused as MuseApiError).status).toBe(400);
    expect((refused as MuseApiError).message).toMatch(/400/);
    expect((refused as MuseApiError).message).not.toMatch(/Maya|daughter|what_they_said/);
  });

  it("gives graph ingestion a time limit too: a sitting is never left waiting on a reply that is not coming", async () => {
    const question = { expects: "Person", gap: { identified_as: null } } as unknown as Question;
    const answer: Answer = { answer_id: "a1", by: "person:susan", text: "That's my daughter Maya.", at: "2026-11-01T15:00:00.000Z", recording: null };
    let signal: AbortSignal | undefined;
    const never: MuseFetch = (_url, init) => ((signal = init.signal), new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal!.reason))));
    const interpret = (budgetMs?: number) => new MuseAnswerInterpreter(new MuseSpark(KEY, never), new MemoryGraphStore(), budgetMs).interpret(question, answer, { id: "person:susan", is_participant: true }, "person:susan");
    await expect(interpret(20)).rejects.toThrow(/no reply within 20 ms/);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(INGEST_BUDGET_MS).toBeGreaterThanOrEqual(SCAFFOLD_ADVICE_BUDGET_MS); // nobody is on the line for this one, and it reads at a higher effort
  });

  it("says so plainly when the model reasoned through its whole token limit and never answered", async () => {
    const spent: MuseFetch = async () => ({ ok: true, status: 200, text: async () => "", json: async () => ({ choices: [{ message: { content: "" }, finish_reason: "length" }] }) });
    await expect(new MuseSpark(KEY, spent).chat([])).rejects.toThrow(/max_completion_tokens/);
  });
});

// --- Muse Spark's place in the engine -----------------------------------------------------------------------------

describe("Muse Spark only proposes", () => {
  it("never chooses a rung. Where the retrieval layer already prefers a cue, Spark is not even asked", async () => {
    let asked = 0;
    const run = await runFixture({ scaffoldAdvisor: async (advice) => (asked++, { cue_id: advice.eligible[0]!.cue_id, citations: advice.eligible[0]!.citations }) });
    expect(asked).toBe(0);
    expect(run.recording.final_state).toBe("stored");
    expect(replay(run.recording.trace).context.cues_offered).toEqual([{ rung: 3, cue_id: "person:maya" }]);
  });

  it("speaks Spark's pick through the real client, and falls back when Spark is slow, wrong, or down", async () => {
    const { bench } = await import("./helpers");
    const pickVia = async (advisor: ScaffoldAdvisor) => {
      const b = await bench();
      await b.service.clearRetrievalLayer(); // no preference, so the front-runners are level
      Object.assign(b.ctx, { scaffoldAdvisor: advisor });
      const events: RecallEvent[] = [
        { type: "CALL_SCHEDULED", person_id: "person:susan", topic_id: b.topicId, topic_label: "x", family_sourced: false, reorientation_allowed: false },
        { type: "POLICY_GRANTED", policy_token_id: b.tokenId, max_call_minutes: 12 },
        { type: "CALL_CONNECTED", session_id: "s" },
        { type: "GREETING_DELIVERED", prompt_id: "p", discloses_ai: true },
        { type: "TOPIC_SELECTED", topic_id: b.topicId, citations: [] },
        { type: "RUNG_DELIVERED", rung: 1, prompt_id: "p1", citations: [], cue_id: null },
        { type: "TURN_ASSESSED", turn_id: "t", turn_state: "no_answer", silent: false },
        { type: "RUNG_DELIVERED", rung: 2, prompt_id: "p2", citations: [], cue_id: null },
        { type: "TURN_ASSESSED", turn_id: "u", turn_state: "no_answer", silent: false },
      ];
      for (const e of events) b.store.getState().dispatch(e, { at: b.clock.iso() });
      return b.runtime.call("select_scaffold", { topic_id: b.topicId, state: "no_answer", verified_ids: b.verified, rungs_fired: [1, 2] });
    };
    expect(await pickVia(async (a) => ({ cue_id: "person:maya", citations: a.eligible.find((e) => e.cue_id === "person:maya")!.citations }))).toMatchObject({ rung: 3, cue: { cue_id: "person:maya" }, decided_by: "muse_spark" });
    const fallback = { rung: 3, cue: { cue_id: "artifact:photo-cape-may" }, decided_by: "deterministic_ladder" };
    expect(await pickVia(async () => ({ cue_id: "person:priya", citations: ["person:priya"] }))).toMatchObject(fallback); // not on offer
    expect(await pickVia(async (a) => ({ cue_id: a.eligible[0]!.cue_id, citations: ["claim:taught-at-lincoln"] }))).toMatchObject(fallback); // cites outside the cue
    expect(await pickVia(async () => Promise.reject(new MuseApiError(500, "down")))).toMatchObject(fallback);
    const { spark } = sparkReturning({ cue_id: "person:maya", citations: ["person:maya"] });
    expect(await pickVia(museScaffoldAdvisor(spark))).toMatchObject({ rung: 3, cue: { cue_id: "person:maya" }, decided_by: "muse_spark" });
  });
});
