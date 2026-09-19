/**
 * The live path: Deepgram, Muse Spark, and a video call driving a real Recall
 * session. No network and no keys here - sockets and fetch are fakes. The real
 * services are exercised separately (see scripts/e2e-live.mjs).
 */
import { describe, expect, it } from "vitest";
import { FAMILY_SEED, MANIFEST, POLICY } from "@/fixtures";
import { GuardedThreadBridge, MemoryThreadBridge, type ThreadMessage } from "@/lib/bridge/thread-bridge";
import type { CallCommand } from "@/lib/call/control";
import { CallUnavailableError, LiveCall } from "@/lib/call/live-call";
import { SystemClock } from "@/lib/clock";
import { LexicalAnswerInterpreter, applyAnswer, type Answer } from "@/lib/discovery/answers";
import { MemoryGraphStore } from "@/lib/graph/memory-store";
import { buildGraph } from "@/lib/graph/seed";
import { AssetIndex } from "@/lib/provenance/assets";
import { cutWav } from "@/lib/provenance/wav";
import { DeepgramLive, transcribeWav, type HeardTurn, type SocketLike } from "@/lib/providers/deepgram";
import { MuseAnswerInterpreter, museScaffoldAdvisor } from "@/lib/providers/muse/reasoning";
import { MuseApiError, MuseSpark, type MuseFetch } from "@/lib/providers/muse/spark";
import { RecallService } from "@/lib/service/recall-service";
import { initialState, reduce } from "@/lib/state/reducer";
import { policySchema, type ScaffoldAdvisor } from "@/lib/tools";
import { replay, visitedStates } from "@/lib/state/reducer";
import { diwaliForward } from "./fixtures";

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

/** Stands in for Recall's call page and for Deepgram: acks what it is told to say, and "hears" her scripted replies. */
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
  call.attach((command) => {
    commands.push(command);
    if (command.type === "hangup") return;
    hear(3); // Recall's line, or the playback, takes three seconds of call time
    call.acknowledge(command.type === "say" ? { type: "said", prompt_id: command.prompt_id } : { type: "played", playback_id: command.playback_id });
    if (command.type === "say" && ["wrap_up", "close_kindly"].some((k) => command.prompt_id.includes(k))) return;
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

async function runLive(replies: Array<(atMs: number) => HeardTurn | null>, scaffoldAdvisor?: ScaffoldAdvisor, bridgeFor: (call: LiveCall) => MemoryThreadBridge = () => new MemoryThreadBridge()) {
  const r = rig(replies);
  const bridge = bridgeFor(r.call);
  const service = new RecallService({ graph: MemoryGraphStore.from(buildGraph(FAMILY_SEED, r.assets)), policy: policySchema.parse(POLICY), assets: r.assets, clock: { now: () => Date.parse("2026-11-05T17:30:00.000Z"), iso: () => "2026-11-05T17:30:00.000Z" }, bridge, transcription: r.call, callDriver: () => (queueMicrotask(r.join), r.call), scaffoldAdvisor });
  const forward = diwaliForward();
  await service.forwardAsk(forward);
  const run = await service.runSession(forward.thread_id as string, "session:live");
  return { ...r, ...run, bridge };
}

describe("a live video call drives a real session", () => {
  it("the whole golden conversation, live: re-anchored, her exact words captured, played back, approved, delivered", async () => {
    const run = await runLive([says("Which thing again?"), says("Make the kheer. Your grandfather always added cardamom last."), says("Yes.")]);
    expect(visitedStates(replay(run.recording.trace))).toEqual(["idle", "ask_received", "policy_passed", "connected", "following", "lost", "reanchored", "contributed", "playback", "assented", "delivered"]);
    expect(run.commands.map((c) => (c.type === "say" ? c.text : c.type))).toEqual(["Anika wants your help with Diwali dessert.", "Kheer or halwa. Anika sent this photo.", "Want me to send that to Anika?", "playback", "hangup"]);
    const card = run.bridge.voiceCards()[0]!;
    expect(card.literal_transcript).toBe("Make the kheer. Your grandfather always added cardamom last.");
    expect(card.audio.asset_id).toMatch(/^live:room-1:w\d+$/); // cites a hashed window of the live call
    expect(run.recording.provenance_receipt!.edits.generated_first_person_words).toBe(0);
  });

  it("plays back exactly the kept spans of the pending artifact, in call time", async () => {
    const run = await runLive([says("Make the kheer."), says("Yes.")]);
    const playback = run.commands.find((c) => c.type === "playback")!;
    const kept = run.ctx.session.contribution!.kept;
    if (playback.type !== "playback") throw new Error("unreachable");
    expect(playback.spans).toHaveLength(kept.length);
    expect(playback.spans[0]!.end_ms - playback.spans[0]!.start_ms).toBe(kept[0]!.end_ms - kept[0]!.start_ms);
  });

  it("silence after the re-anchor is a second lost-thread signal: a gentle wrap-up, nothing sent", async () => {
    const run = await runLive([says("Which thing again?"), () => null]);
    expect(run.recording.final_state).toBe("wrapped_up");
    expect(run.bridge.voiceCards()).toEqual([]);
    expect(run.recording.messages.map((m) => m.kind)).toEqual(["family_notice"]);
  });

  it("delivers while the call is still up: her recording exists, and cuts to the kept spans, at the moment it is posted", async () => {
    // A transport like Telegram fetches the audio when the card is posted. After hang-up there is nothing left to fetch.
    const atPost: Array<{ ended: boolean; cut_bytes: number; kept_ms: number }> = [];
    class Fetching extends GuardedThreadBridge {
      constructor(private readonly call: LiveCall) {
        super();
      }
      protected async deliver(message: ThreadMessage): Promise<void> {
        if (message.kind !== "voice_contribution") return;
        const { asset_id, kept } = message.card.audio;
        atPost.push({ ended: this.call.ended, cut_bytes: cutWav(this.call.wavFor(asset_id)!, kept)?.byteLength ?? 0, kept_ms: kept.reduce((ms, k) => ms + k.end_ms - k.start_ms, 0) });
      }
    }
    await runLive([says("Make the kheer."), says("Yes.")], undefined, (call) => new Fetching(call) as unknown as MemoryThreadBridge);
    expect(atPost).toHaveLength(1);
    expect(atPost[0]!.ended).toBe(false);
    expect(atPost[0]!.cut_bytes).toBe(44 + (atPost[0]!.kept_ms / 1000) * 32_000); // a WAV header and exactly her kept samples
  });

  it("wipes her audio when the call ends, delivered or not", async () => {
    const run = await runLive([says("Make the kheer."), says("Yes.")]);
    const delivered = run.bridge.voiceCards()[0]!.audio.asset_id;
    expect([...run.call.wavFor(delivered)!].every((b) => b === 0)).toBe(true);
    expect(run.call.ended).toBe(true);
  });

  it("never takes Recall's own voice for hers: anything heard while Recall was talking is discarded", async () => {
    const r = rig([]);
    r.join();
    await r.call.connect();
    const speaking = r.call.speak({ prompt_id: "prompt:brief", text: "Anika wants your help." });
    r.heard({ start_ms: 1500, end_ms: 2500, words: [{ w: "Anika", start_ms: 1500, end_ms: 1900 }, { w: "wants", start_ms: 2000, end_ms: 2500 }] }); // her mic picking up her own speaker
    await speaking;
    r.hear(1);
    r.heard(says("Make the kheer.")(5200));
    r.hear(3);
    const window = await r.call.listen();
    const turns = await r.call.allTurns(window.asset_id);
    expect(turns.map((t) => `${t.speaker}: ${t.words.map((w) => w.w).join(" ")}`)).toEqual(["recall: Anika wants your help.", "participant: Make the kheer."]);
  });

  it("ends safely when nobody joins, and when the call drops - without claiming anything happened that did not", async () => {
    const r = rig([]);
    await expect(r.call.connect()).rejects.toBeInstanceOf(CallUnavailableError);
    const at = { at: "2026-11-05T17:30:00.000Z" };
    const dropped = (from: Parameters<typeof reduce>[1][]) => from.reduce((m, e) => reduce(m, e, at), initialState());
    const asked = { type: "ASK_FORWARDED", ask_id: "a", thread_id: "t", asker_id: "p", addressee_id: "m" } as const;
    const drop = { type: "CALL_DROPPED", detail: "nobody joined" } as const;
    expect(dropped([asked, { type: "POLICY_GRANTED", policy_token_id: "k", audience: "t" }, drop])).toMatchObject({ state: "blocked", context: { family_notice: "not_this_time" } });
    const inCall = dropped([asked, { type: "POLICY_GRANTED", policy_token_id: "k", audience: "t" }, { type: "CALL_CONNECTED", session_id: "s" }, { type: "BRIEF_DELIVERED", prompt_id: "p", citations: [] }, drop]);
    expect(inCall.state).toBe("wrapped_up");
    expect(inCall.trace.map((t) => t.event)).not.toContain("FIXED_RESTATEMENT_DELIVERED");
  });
});

describe("Muse Spark only proposes", () => {
  it("may pick among the scaffolds the ladder found eligible - and is overruled the moment it steps outside them", async () => {
    const replies = [says("Which thing again?"), says("Make the kheer."), says("Yes.")];
    const chosen = async (advisor: ScaffoldAdvisor) => (await runLive(replies, advisor)).runtime.log.find((c) => c.tool === "select_scaffold")!.output as { scaffold_id: string; decided_by: string };

    const offered: string[][] = [];
    expect(await chosen(async (advice) => (offered.push(advice.eligible.map((e) => e.scaffold_id)), { scaffold_id: "source_backed_cue", citations: advice.eligible[1]!.citations }))).toEqual(expect.objectContaining({ scaffold_id: "source_backed_cue", decided_by: "muse_spark" }));
    expect(offered).toEqual([["restate_options", "source_backed_cue"]]); // "repeat" and "name the asker" were never on offer: they do not answer "which thing?"

    expect(await chosen(async () => ({ scaffold_id: "repeat", citations: ["person:anika"] }))).toEqual(expect.objectContaining({ scaffold_id: "restate_options", decided_by: "deterministic_ladder" }));
    expect(await chosen(async (a) => ({ scaffold_id: a.eligible[0]!.scaffold_id, citations: ["pref:mom-festival-desserts"] }))).toEqual(expect.objectContaining({ decided_by: "deterministic_ladder" }));
    expect(await chosen(async () => Promise.reject(new MuseApiError(500, "down")))).toEqual(expect.objectContaining({ scaffold_id: "restate_options", decided_by: "deterministic_ladder" }));
    const viaSpark = museScaffoldAdvisor(sparkReturning({ scaffold_id: "restate_options", citations: ["topic:kheer"] }).spark);
    expect((await chosen(viaSpark)).decided_by).toBe("muse_spark");
  });

  it("gets no more trust than the lexical matcher when reading facts: a name she never said is refused", async () => {
    const graph = MemoryGraphStore.from(buildGraph(FAMILY_SEED, new AssetIndex(MANIFEST)));
    const policy = policySchema.parse(POLICY);
    const question = { question_id: "q", expects: "Person", show_photo_id: null, rungs: [], gap: { gap_id: "g", kind: "how_related", cluster_id: "c", photo_count: 1, expects: "Person", together_with: [], identified_as: { node_id: "person:anika", name: "Anika", edge_id: "e" } } } as never;
    const answer: Answer = { answer_id: "a1", by: "person:mom", text: "She is my daughter.", at: "2026-11-01T15:00:00.000Z", recording: null };
    const speaker = { id: "person:mom", is_participant: true };

    const honest = new MuseAnswerInterpreter(sparkReturning({ facts: [{ kind: "relate", from: { id: "person:mom" }, relation: "child", to: { id: "person:anika" }, said_as: "daughter", basis: "stated" }] }).spark, graph);
    expect((await applyAnswer(question, answer, await honest.interpret(question, answer, speaker, "person:mom"), { graph, policy })).created).toEqual(["RELATED_TO:child:person:mom->person:anika"]);

    const inventive = new MuseAnswerInterpreter(sparkReturning({ facts: [{ kind: "relate", from: { id: "person:anika" }, relation: "lived_in", to: { type: "Place", name: "Boston" }, said_as: null, basis: "stated" }] }).spark, graph);
    await expect(applyAnswer(question, { ...answer, answer_id: "a2" }, await inventive.interpret(question, answer, speaker, "person:mom"), { graph, policy })).rejects.toThrow(/"Boston" does not appear in what was said/);
    expect(new LexicalAnswerInterpreter().label).toContain("lexical"); // the deterministic default remains
    void SystemClock;
  });
});
