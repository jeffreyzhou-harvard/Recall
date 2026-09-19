/**
 * The live path: Deepgram, Muse Spark, and a video call driving a real Relay
 * session. No network and no keys here - sockets and fetch are fakes. The real
 * services are exercised separately (see scripts/e2e-live.mjs).
 */
import { describe, expect, it } from "vitest";
import { CALL_SCRIPT, FAMILY_COPY, FAMILY_SEED, MANIFEST, POLICY, RECORD_THRESHOLDS, SAFETY_PHRASES } from "@/fixtures";
import type { CallCommand } from "@/lib/call/control";
import { CallUnavailableError, LiveCall } from "@/lib/call/live-call";
import { MemoryGraphStore } from "@/lib/graph/memory-store";
import { buildGraph } from "@/lib/graph/seed";
import { AssetIndex } from "@/lib/provenance/assets";
import { DeepgramLive, transcribeWav, type HeardTurn, type SocketLike } from "@/lib/providers/deepgram";
import { museScaffoldAdvisor } from "@/lib/providers/muse/reasoning";
import { MuseApiError, MuseSpark, type MuseFetch } from "@/lib/providers/muse/spark";
import { RelayService } from "@/lib/service/relay-service";
import { MemoryAlertChannel } from "@/lib/safety/alert";
import type { RelayEvent } from "@/lib/state/machine";
import { replay, visitedStates } from "@/lib/state/reducer";
import { SetupStore, type ScaffoldAdvisor } from "@/lib/tools";
import { HER_LINE, SAID } from "./helpers";

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

// --- a live call, driving a real session ---------------------------------------------------------------------------

const SECOND = new Uint8Array(32_000); // one second of 16 kHz 16-bit silence

/** Stands in for Relay's call page and for Deepgram: acks what it is told to say, and "hears" her scripted replies. */
function rig(replies: Array<(atMs: number) => HeardTurn | null>, options: { silence_ms?: number } = {}) {
  const assets = new AssetIndex(MANIFEST);
  const commands: CallCommand[] = [];
  let onTurn: (t: HeardTurn) => void = () => {};
  let audioMs = 0;
  const call = new LiveCall({ room_id: "room-1", assets, silence_ms: options.silence_ms ?? 3_000, connect_timeout_ms: 500, startTranscriber: (turn) => ((onTurn = turn), { sendAudio: () => {}, end: () => {} }) });
  const hear = (seconds: number): void => {
    for (let i = 0; i < seconds; i++) call.pushAudio(SECOND);
    audioMs += seconds * 1000;
  };
  let reply = 0;
  // Relay listens after an invitation, a cue, or a question - not after its greeting or a line that ends the call.
  const NO_REPLY = new Set([SAID.greeting, SAID.closeWarm, SAID.closeKind, SAID.closeNotStored, SAID.stopAck, SAID.safety]);
  const expectsReply = (text: string): boolean => !NO_REPLY.has(text);
  call.attach((command) => {
    commands.push(command);
    if (command.type === "hangup") return;
    hear(3); // Relay's line, or the playback, takes three seconds of call time
    call.acknowledge(command.type === "say" ? { type: "said", prompt_id: command.prompt_id } : { type: "played", playback_id: command.playback_id });
    if (command.type !== "say" || !expectsReply(command.text)) return;
    queueMicrotask(() => {
      const turn = replies[reply++]?.(audioMs + 1000) ?? null;
      if (turn) {
        hear(Math.ceil((turn.end_ms - audioMs) / 1000) + 1);
        onTurn(turn);
      } else hear(6); // she says nothing
    });
  });
  const join = (): void => {
    call.acknowledge({ type: "connected" });
    hear(1);
  };
  return { call, assets, commands, join, hear, heard: (t: HeardTurn) => onTurn(t) };
}
const says = (text: string) => (atMs: number): HeardTurn => {
  const words = text.split(" ").map((w, i) => ({ w, start_ms: atMs + i * 400, end_ms: atMs + i * 400 + 300 }));
  return { start_ms: atMs, end_ms: words.at(-1)!.end_ms, words };
};

async function runLive(replies: Array<(atMs: number) => HeardTurn | null>, scaffoldAdvisor?: ScaffoldAdvisor) {
  const r = rig(replies);
  const alerts = new MemoryAlertChannel();
  const graph = MemoryGraphStore.from(buildGraph(FAMILY_SEED, r.assets));
  const at = "2026-11-05T17:30:00.000Z";
  const service = new RelayService({ graph, setup: new SetupStore(POLICY), assets: r.assets, clock: { now: () => Date.parse(at), iso: () => at }, transcription: r.call, script: CALL_SCRIPT, copy: FAMILY_COPY, thresholds: RECORD_THRESHOLDS, safetyPhrases: SAFETY_PHRASES, alerts, callDriver: () => (queueMicrotask(r.join), r.call), scaffoldAdvisor });
  const run = await service.runScheduledCall("session:live");
  return { ...r, ...run!, graph, alerts, service };
}
const GOLDEN = [says("Cape May...?"), says("I'm not sure."), says("Maya, my daughter!"), says(HER_LINE), says("Yes."), says("Yes.")];

describe("a live video call drives a real recall session", () => {
  it("the whole golden conversation, live: the ladder climbs, her exact words are captured, played back, confirmed, stored", async () => {
    const run = await runLive(GOLDEN);
    expect(visitedStates(replay(run.recording.trace))).toEqual(["idle", "scheduled", "policy_passed", "connected", "topic_selected", "asking", "lost", "reanchored", "lost", "reanchored", "recalled", "confirming", "confirmed", "stored"]);
    expect(run.commands.map((c) => (c.type === "say" ? c.text : c.type))).toEqual([SAID.greeting, SAID.rung1, SAID.rung2, SAID.rung3, SAID.elaborate, "playback", SAID.storeQuestion, SAID.shareQuestion, SAID.closeWarm, "hangup"]);
    const p = run.recording.provenance_receipt!;
    expect(p.literal_transcript).toBe(HER_LINE);
    expect(p.waveform.asset_id).toMatch(/^live:room-1:w\d+$/); // cites a hashed window of the live call
    expect(p.edits.generated_first_person_words).toBe(0);
    expect((await run.graph.getNode(p.claim_id))!.prov).toMatchObject({ author: "person:susan", patient_confirmed: true });
  });

  it("plays back exactly the kept spans of the pending contribution, in call time - her own audio, before the question", async () => {
    const run = await runLive(GOLDEN);
    const at = run.commands.findIndex((c) => c.type === "playback");
    const playback = run.commands[at]!;
    const kept = run.ctx.session.contribution!.kept;
    if (playback.type !== "playback") throw new Error("unreachable");
    expect(playback.spans).toHaveLength(kept.length);
    expect(playback.spans[0]!.end_ms - playback.spans[0]!.start_ms).toBe(kept[0]!.end_ms - kept[0]!.start_ms);
    expect(run.commands[at + 1]).toMatchObject({ type: "say", text: SAID.storeQuestion });
  });

  it("two quiet windows: a gentle wrap-up, and nothing is kept", async () => {
    const run = await runLive([() => null, () => null]);
    expect(run.recording.final_state).toBe("no_answer_today");
    expect(run.commands.filter((c) => c.type === "say").map((c) => (c as { text: string }).text)).toEqual([SAID.greeting, SAID.rung1, SAID.rung2, SAID.closeKind]);
    expect((await run.graph.nodesOfType("Contribution")).length).toBe(0);
  });

  it("wipes her audio when the call ends, stored or not", async () => {
    const run = await runLive(GOLDEN);
    expect([...run.call.wavFor(run.recording.provenance_receipt!.waveform.asset_id)!].every((b) => b === 0)).toBe(true);
    expect(run.call.ended).toBe(true);
  });

  it("a safety phrase on a live call alerts her caregiver and ends the recall flow", async () => {
    const run = await runLive([says("Cape May...?"), says("I fell this morning and my hip hurts.")]);
    expect(run.recording.final_state).toBe("safety_handoff");
    expect(run.alerts.sentTo("person:maya")).toHaveLength(1);
    expect(run.alerts.sentTo("person:maya")[0]!.text).not.toMatch(/hip|morning/);
    expect(run.commands.filter((c) => c.type === "say").at(-1)).toMatchObject({ text: SAID.safety });
  });

  it("never takes Relay's own voice for hers: anything heard while Relay was talking is discarded", async () => {
    const r = rig([]);
    r.join();
    await r.call.connect();
    const speaking = r.call.speak({ prompt_id: "prompt:greeting", text: "Hi Susan, I'm Relay." });
    r.heard({ start_ms: 1500, end_ms: 2500, words: [{ w: "Relay", start_ms: 1500, end_ms: 2500 }] }); // Deepgram hears Relay's own line through her speaker
    await speaking;
    const listening = r.call.listen();
    r.hear(1);
    r.heard(says("Cape May...?")(4600));
    const window = await listening;
    expect((await r.call.turnsIn(window)).filter((t) => t.speaker === "participant").map((t) => t.words.map((w) => w.w).join(" "))).toEqual(["Cape May...?"]);
  });

  it("nobody joins: no answer today. She hangs up mid-call: stopped. Neither claims anything happened that did not", async () => {
    const nobody = rig([]);
    const graph = MemoryGraphStore.from(buildGraph(FAMILY_SEED, nobody.assets));
    const at = "2026-11-05T17:30:00.000Z";
    const deps = { graph, setup: new SetupStore(POLICY), assets: nobody.assets, clock: { now: () => Date.parse(at), iso: () => at }, transcription: nobody.call, script: CALL_SCRIPT, copy: FAMILY_COPY, thresholds: RECORD_THRESHOLDS, safetyPhrases: SAFETY_PHRASES, alerts: new MemoryAlertChannel() };
    const unanswered = await new RelayService({ ...deps, callDriver: () => nobody.call }).runScheduledCall("session:nobody");
    expect(unanswered!.recording.final_state).toBe("no_answer_today");
    expect(unanswered!.recording.spoken).toEqual([]);

    // She answers once, and then the line goes dead instead of a second reply.
    const dropped: ReturnType<typeof rig> = rig([says("Cape May...?"), () => (dropped.call.acknowledge({ type: "ended" }), null)]);
    const service = new RelayService({ ...deps, graph: MemoryGraphStore.from(buildGraph(FAMILY_SEED, dropped.assets)), assets: dropped.assets, transcription: dropped.call, callDriver: () => (queueMicrotask(dropped.join), dropped.call) });
    const run = await service.runScheduledCall("session:dropped");
    expect(run!.recording.final_state).toBe("stopped");
    expect(replay(run!.recording.trace).context.stop_how).toBe("hang_up");
    expect(run!.recording.provenance_receipt).toBeNull();
  });
});

describe("Muse Spark only proposes", () => {
  it("never chooses a rung. It may pick WHICH cue, where the retrieval layer has no preference - and is overruled the moment it steps outside what was offered", async () => {
    // With the seeded retrieval layer, Maya is already the preferred cue: the advisor is not even asked.
    let asked = 0;
    const preferred = await runLive(GOLDEN, async (advice) => (asked++, { cue_id: advice.eligible[0]!.cue_id, citations: advice.eligible[0]!.citations }));
    expect(asked).toBe(0);
    expect(replay(preferred.recording.trace).context.cues_offered).toEqual([{ rung: 3, cue_id: "person:maya" }]);
  });

  it("speaks Spark's pick through the real client, and falls back when Spark is slow, wrong, or down", async () => {
    const { bench } = await import("./helpers");
    const pickVia = async (advisor: ScaffoldAdvisor) => {
      const b = await bench();
      await b.service.clearRetrievalLayer(); // no preference, so the front-runners are level
      Object.assign(b.ctx, { scaffoldAdvisor: advisor });
      const events: RelayEvent[] = [
        { type: "CALL_SCHEDULED", person_id: "person:susan", topic_id: b.topicId, topic_label: "x", family_sourced: false },
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
