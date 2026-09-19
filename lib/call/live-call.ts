/**
 * A live video call, as the orchestrator sees it: the real implementation of
 * `CallDriver`, and the transcript of that call as a `TranscriptionProvider`.
 * The orchestrator, the twelve tools, and every gate are unchanged - this
 * plugs into the same seam the prerecorded call does.
 *
 *   speak     send Relay's line to the call page; her device says it and shows it, labeled Relay
 *   listen    wait for her next FINAL turn (Deepgram endpointing), or for silence
 *   playback  play the exact kept spans of her own captured audio back to her
 *
 * LIVE ONLY, SERVER ONLY.
 *
 * Time is audio time: milliseconds of her audio received, counted in samples.
 * Deepgram's word timings are on the same clock, so a transcript span and an
 * audio span always mean the same samples, with no wall clock in between.
 *
 * Authorship under live conditions. Her microphone can pick up Relay's voice
 * and the playback of her own words coming out of her speaker. So every
 * stretch in which Relay spoke or played audio is marked, anything transcribed
 * inside a mark is discarded rather than attributed to her, and the marks are
 * entered in the transcript as Relay's turns - which makes the capture tool's
 * existing "no Relay speech in the interval" check bite on live audio too.
 *
 * Rule 8. Her audio is held in memory for the call only. Each `listen` hands
 * the tools one window of it as a hashed asset. `hangUp` zeroes everything.
 */
import type { CallDriver, SpokenPrompt } from "@/lib/orchestrator/call-driver";
import type { AssetIndex } from "@/lib/provenance/assets";
import { sha256Bytes } from "@/lib/provenance/hash";
import { encodeWavPcm16 } from "@/lib/provenance/wav";
import type { HeardTurn } from "@/lib/providers/deepgram";
import type { AudioWindow, TranscriptionProvider, Turn } from "@/lib/providers/transcription";
import type { MediaSpan } from "@/lib/graph/types";
import type { CallAck, CallCommand } from "./control";

const RATE = 16_000;
const toMs = (samples: number): number => Math.round((samples / RATE) * 1000);

/** The call could not be placed, or dropped. The run ends safely; the family gets the neutral notice. */
export class CallUnavailableError extends Error {
  constructor(detail: string) {
    super(`the call is not available: ${detail}`);
    this.name = "CallUnavailableError";
  }
}

export interface Transcriber {
  sendAudio(pcm: Uint8Array): void;
  end(): void;
}

export interface LiveCallOptions {
  room_id: string;
  assets: AssetIndex;
  /** Opens the transcriber once audio is flowing. Deepgram in production; a fake in tests. */
  startTranscriber: (onTurn: (turn: HeardTurn) => void, onSpeechStarted: (atMs: number) => void) => Transcriber;
  /** How long, in audio time, Relay waits after it stops talking before treating the quiet as no answer. */
  silence_ms?: number;
  /** Real-time limits, for when nothing is arriving at all. */
  connect_timeout_ms?: number;
  ack_timeout_ms?: number;
}

interface Mark extends MediaSpan {
  text: string;
}

export class LiveCall implements CallDriver, TranscriptionProvider {
  readonly label = "live call (Deepgram)";
  readonly call_asset_id: string;
  private chunks: Int16Array[] = [];
  private samples = 0;
  private transcriber: Transcriber | null = null;
  private heard: HeardTurn[] = [];
  private speakingSince: number | null = null;
  private readonly marks: Mark[] = [];
  private readonly windows = new Map<string, { turns: Turn[]; wav: Uint8Array; start_ms: number }>();
  private cursorMs = 0;
  private turnCount = 0;
  private dead = false;
  private connected = false;
  private commandSink: ((command: CallCommand) => void) | null = null;
  private readonly unsent: CallCommand[] = [];
  private readonly waiting = new Map<string, () => void>();
  private wake: (() => void) | null = null;

  constructor(private readonly options: LiveCallOptions) {
    this.call_asset_id = `live:${options.room_id}`;
  }

  private get nowMs(): number {
    return toMs(this.samples);
  }

  // --- from Relay's call page ------------------------------------------------------------------------

  /** Her audio, as it arrives: signed 16-bit little-endian mono PCM at 16 kHz. */
  pushAudio(bytes: Uint8Array): void {
    if (this.dead || bytes.byteLength < 2) return;
    const pcm = new Int16Array(bytes.byteLength >> 1);
    new Uint8Array(pcm.buffer).set(bytes.subarray(0, pcm.byteLength));
    this.chunks.push(pcm);
    this.samples += pcm.length;
    this.transcriber ??= this.options.startTranscriber(
      (turn) => {
        this.heard.push(turn);
        this.speakingSince = null;
        this.wake?.();
      },
      (atMs) => (this.speakingSince = atMs),
    );
    this.transcriber.sendAudio(bytes);
    this.wake?.();
  }

  acknowledge(ack: CallAck): void {
    if (ack.type === "connected") this.connected = true;
    else if (ack.type === "ended") this.dead = true;
    else this.waiting.get(ack.type === "said" ? ack.prompt_id : ack.playback_id)?.();
    this.wake?.();
  }

  /** Commands reach Relay's call page through this. Anything issued before the page attached is delivered on attach. */
  attach(sink: (command: CallCommand) => void): () => void {
    this.commandSink = sink;
    for (const command of this.unsent.splice(0)) sink(command);
    return () => {
      if (this.commandSink === sink) this.commandSink = null;
    };
  }

  private command(command: CallCommand): void {
    if (this.commandSink) this.commandSink(command);
    else this.unsent.push(command);
  }

  /** Resolve when `ready()` is true, re-checking whenever audio or an ack arrives. False if `ms` of real time pass first. */
  private until(ready: () => boolean, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const done = (ok: boolean): void => {
        clearTimeout(timer);
        this.wake = null;
        resolve(ok);
      };
      const timer = setTimeout(() => done(false), ms);
      const check = (): void => {
        if (ready()) done(true);
      };
      this.wake = check;
      check();
    });
  }

  // --- CallDriver ----------------------------------------------------------------------------------------

  async connect(): Promise<void> {
    const up = await this.until(() => this.dead || (this.connected && this.samples > 0), this.options.connect_timeout_ms ?? 180_000);
    if (!up || this.dead) {
      this.dead = true;
      throw new CallUnavailableError("nobody joined");
    }
  }

  /** Say a line and mark the stretch of call time it occupied, so nothing heard during it is taken as hers. */
  private async perform(key: string, command: CallCommand, text: string): Promise<void> {
    if (this.dead) return;
    const start_ms = this.nowMs;
    // The end is read at the instant the acknowledgement ARRIVES, not when this function next gets to run:
    // audio keeps flowing in between, and anything counted into the mark by mistake would be thrown away
    // as Relay's echo - which would silently eat the start of her reply.
    let ackedAtMs: number | null = null;
    const acked = new Promise<void>((resolve) =>
      this.waiting.set(key, () => {
        ackedAtMs = this.nowMs;
        resolve();
      }),
    );
    this.command(command);
    await Promise.race([acked, new Promise((r) => setTimeout(r, this.options.ack_timeout_ms ?? 30_000))]);
    this.waiting.delete(key);
    // A little past the end: the tail of Relay's voice is still leaving her speaker when the ack arrives.
    this.marks.push({ start_ms, end_ms: (ackedAtMs ?? this.nowMs) + 400, text });
    this.heard = this.heard.filter((t) => !this.inMark(t));
  }

  speak(prompt: SpokenPrompt): Promise<void> {
    return this.perform(prompt.prompt_id, { type: "say", prompt_id: prompt.prompt_id, text: prompt.text }, prompt.text);
  }

  async playback(kept?: { asset_id: string; spans: MediaSpan[] }): Promise<void> {
    const window = kept ? this.windows.get(kept.asset_id) : null;
    if (!kept || !window) return;
    const id = `playback:${this.marks.length}`;
    const spans = kept.spans.map((s) => ({ start_ms: window.start_ms + s.start_ms, end_ms: window.start_ms + s.end_ms }));
    await this.perform(id, { type: "playback", playback_id: id, spans }, "(her own recording, played back)");
  }

  private inMark(turn: MediaSpan): boolean {
    return this.marks.some((m) => turn.start_ms < m.end_ms && m.start_ms < turn.end_ms);
  }

  async listen(): Promise<AudioWindow> {
    if (this.dead) throw new CallUnavailableError("the call ended");
    const quietSince = Math.max(this.cursorMs, this.marks.at(-1)?.end_ms ?? 0);
    // Generous on purpose. She is never hurried, and there is no countdown anywhere she can see (section 10).
    const silence = this.options.silence_ms ?? 12_000;
    const next = (): HeardTurn | undefined => this.heard.find((t) => !this.inMark(t) && t.end_ms > this.cursorMs);
    // Quiet only counts once Relay has stopped talking, and never while she is mid-sentence.
    const isQuiet = (): boolean => this.speakingSince === null && this.nowMs - quietSince >= silence;
    const alive = await this.until(() => this.dead || next() !== undefined || isQuiet(), 120_000);
    if (!alive || this.dead) {
      this.dead = true;
      throw new CallUnavailableError("the call dropped");
    }
    const turn = next() ?? null;
    if (turn) this.heard = this.heard.filter((t) => t !== turn);
    return this.openWindow(turn);
  }

  /** Cut one window of call audio into a hashed asset the tools can cite, with its transcript on the window's own clock. */
  private async openWindow(turn: HeardTurn | null): Promise<AudioWindow> {
    const start_ms = this.cursorMs;
    const end_ms = Math.min(this.nowMs, turn ? turn.end_ms + 200 : this.nowMs);
    const wav = encodeWavPcm16([this.slice(start_ms, end_ms)], RATE);
    const asset_id = `${this.call_asset_id}:w${this.windows.size + 1}`;
    const rel = (ms: number): number => Math.max(0, Math.min(end_ms, ms) - start_ms);
    const turns: Turn[] = this.marks
      .filter((m) => m.end_ms > start_ms && m.start_ms < end_ms)
      .map((m, i): Turn => ({ turn_id: `${asset_id}:relay${i + 1}`, speaker: "relay", start_ms: rel(m.start_ms), end_ms: rel(m.end_ms), is_final: true, words: [{ w: m.text, start_ms: rel(m.start_ms), end_ms: rel(m.end_ms) }] }));
    if (turn) {
      turns.push({
        turn_id: `t${++this.turnCount}`,
        speaker: "participant",
        start_ms: rel(turn.start_ms),
        end_ms: rel(turn.end_ms),
        is_final: true,
        words: turn.words.map((w) => ({ w: w.w, start_ms: rel(w.start_ms), end_ms: rel(w.end_ms) })),
      });
    }
    turns.sort((a, b) => a.start_ms - b.start_ms);
    this.windows.set(asset_id, { turns, wav, start_ms });
    this.options.assets.register({ id: asset_id, path: "(held in memory for the call only)", kind: "audio", sha256: await sha256Bytes(wav), bytes: wav.byteLength, duration_ms: end_ms - start_ms, status: "final", description: "One window of a live call" });
    this.cursorMs = end_ms;
    return { asset_id, start_ms: 0, end_ms: Math.max(1, end_ms - start_ms) };
  }

  private slice(start_ms: number, end_ms: number): Int16Array {
    const [from, to] = [Math.round((start_ms / 1000) * RATE), Math.round((end_ms / 1000) * RATE)];
    const out = new Int16Array(Math.max(0, to - from));
    let at = 0;
    for (const chunk of this.chunks) {
      const [lo, hi] = [Math.max(from, at), Math.min(to, at + chunk.length)];
      if (lo < hi) out.set(chunk.subarray(lo - at, hi - at), lo - from);
      at += chunk.length;
    }
    return out;
  }

  /** End the call and wipe her audio: every sample of every window, approved or not. Delivery has already happened by now. */
  async hangUp(): Promise<void> {
    this.command({ type: "hangup" });
    this.dead = true;
    this.transcriber?.end();
    for (const chunk of this.chunks) chunk.fill(0);
    for (const window of this.windows.values()) window.wav.fill(0);
    this.chunks = [];
    this.samples = 0;
    this.wake?.();
  }

  // --- TranscriptionProvider, and the audio for a delivered voice card ---------------------------------------

  async turnsIn(window: AudioWindow): Promise<Turn[]> {
    return (this.windows.get(window.asset_id)?.turns ?? []).filter((t) => t.start_ms >= window.start_ms && t.end_ms <= window.end_ms);
  }

  async allTurns(assetId: string): Promise<Turn[]> {
    return this.windows.get(assetId)?.turns ?? [];
  }

  /** The window's audio, while the call is still up. Used once, to cut the delivered voice card. */
  wavFor(assetId: string): Uint8Array | null {
    return this.windows.get(assetId)?.wav ?? null;
  }

  get ended(): boolean {
    return this.dead;
  }
}
