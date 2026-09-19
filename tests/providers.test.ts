/**
 * The provider clients - Deepgram (speech to words with timings) and Muse Spark (proposals only) - tested
 * against fakes built from their published protocols, and Muse Spark's one place in the engine: choosing
 * WHICH cue to offer. No call transport is tested here; the call feature is being built separately.
 */
import { describe, expect, it } from "vitest";
import { runFixture } from "@/fixtures/harness";
import { DeepgramLive, transcribeWav, type HeardTurn, type SocketLike } from "@/lib/providers/deepgram";
import { museScaffoldAdvisor } from "@/lib/providers/muse/reasoning";
import { MuseApiError, MuseSpark, type MuseFetch } from "@/lib/providers/muse/spark";
import type { RelayEvent } from "@/lib/state/machine";
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
    this.closed = true;
    this.onclose?.({});
  }
  say(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
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
    const turns: HeardTurn[] = [];
    let opened: { url: string; protocols: string[] } | null = null;
    const live = new DeepgramLive(KEY, { keyterms: ["kheer"] }, { onTurn: (t) => turns.push(t), onError: () => {} }, (url, protocols) => ((opened = { url, protocols }), socket));
    return { socket, turns, live, opened: () => opened! };
  };

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
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: "CloseStream" }));
    expect(socket.closed).toBe(true);
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
      const events: RelayEvent[] = [
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
