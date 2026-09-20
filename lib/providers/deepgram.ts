/**
 * Deepgram speech-to-text (https://developers.deepgram.com): word timings,
 * endpointing, and exact transcript spans for the live call.
 *
 *   streaming    wss://api.deepgram.com/v1/listen   raw linear16 PCM in, JSON results out
 *   prerecorded  POST https://api.deepgram.com/v1/listen   (used to measure a recording's word timings)
 *
 * LIVE ONLY, SERVER ONLY. The key never reaches a browser: her audio goes
 * browser -> our server -> Deepgram. Nothing on the judged path imports this.
 *
 * What Recall takes from it, and what it leaves:
 *   + her literal words, with a start and end time for each. The edit-decision list needs exactly
 *     that to find the pauses it may trim, so a live contribution is trimmed the same way a
 *     prerecorded one is.
 *   + endpointing. Recall assembles a turn only when Deepgram says she has finished speaking, and the
 *     state machine classifies answers and assent on those final turns alone - never on a partial.
 *   - confidence scores are read by nobody. They are not stored, shown, or used to judge anything
 *     about her (rule 4; "never surface model confidence").
 *
 * It only goes speech -> text. There is no text -> speech for her anywhere in Recall (rules 1 and 2).
 */
import { z } from "zod";
import type { Word } from "./transcription";

export const DEEPGRAM_MODEL = "nova-3";
export const DEEPGRAM_SAMPLE_RATE = 16_000;
const HOST = "api.deepgram.com/v1/listen";

export class DeepgramError extends Error {
  constructor(
    public readonly status: number | null,
    detail: string,
  ) {
    super(`Deepgram error${status ? ` (${status})` : ""}: ${detail}`);
    this.name = "DeepgramError";
  }
}

export function requireDeepgramKey(key: string | undefined): string {
  if (!key || key.trim() === "") throw new DeepgramError(null, "DEEPGRAM_API_KEY is not set (put it in .env.local; never commit it)");
  return key.trim();
}

export interface DeepgramOptions {
  /** Words worth listening for: the names and dishes in this ask. Biasing only; it cannot put a word in her mouth. */
  keyterms?: string[];
  /** Match the actual microphone PCM rate; the call recorder usually requests 16 kHz. */
  sampleRate?: number;
}

/** A finished stretch of her speech. Times are milliseconds into the audio that was sent. */
export interface HeardTurn {
  start_ms: number;
  end_ms: number;
  words: Word[];
}

const dgWord = z.object({ word: z.string(), start: z.number(), end: z.number(), punctuated_word: z.string().optional() });
const results = z.object({
  type: z.literal("Results"),
  is_final: z.boolean().optional(),
  speech_final: z.boolean().optional(),
  channel: z.object({ alternatives: z.array(z.object({ transcript: z.string(), words: z.array(dgWord).default([]) })).min(1) }),
});

const toWords = (words: Array<z.infer<typeof dgWord>>): Word[] =>
  words.map((w) => ({ w: w.punctuated_word ?? w.word, start_ms: Math.round(w.start * 1000), end_ms: Math.round(w.end * 1000) }));

const query = (options: DeepgramOptions, extra: Record<string, string>): string => {
  const params = new URLSearchParams({ model: DEEPGRAM_MODEL, punctuate: "true", smart_format: "false", ...extra });
  for (const term of options.keyterms ?? []) params.append("keyterm", term);
  return params.toString();
};

/** The subset of WebSocket this needs. Node 22's global WebSocket satisfies it; tests pass a fake. */
export interface SocketLike {
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
}

export interface LiveHandlers {
  /** Display-only captions. Interim words must never classify a turn or authorize storage. */
  onTranscript?: (text: string, final: boolean) => void;
  /** She started speaking. Lets a caller tell silence from a pause mid-sentence. */
  onSpeechStarted?: (atMs: number) => void;
  /** A final, endpointed turn. The only event Recall acts on. */
  onTurn: (turn: HeardTurn) => void;
  onError: (error: DeepgramError) => void;
  onClosed?: () => void;
}

/** The timers this needs. Injectable so a test can run the clock by hand; the default is the real one. */
export interface TimersLike {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}
type Handle = Parameters<typeof clearTimeout>[0];
const REAL_TIMERS: TimersLike = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as Handle),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as Handle),
};

/** Deepgram closes a socket that has carried no audio for 10 s, and she may well be quiet for longer than that. */
export const KEEP_ALIVE_MS = 5_000;
/** How long Deepgram gets to send its last results and close, after CloseStream, before this closes the socket itself. */
export const CLOSE_GRACE_MS = 2_500;
/** Chunks held while the socket opens. That takes a moment; hundreds of chunks still waiting means something is wrong, and it is said, not hidden. */
const BACKLOG_LIMIT = 400;
/** Interim and final word timings for the same word can differ by a little. */
const TIMING_SLACK_MS = 200;

export class DeepgramLive {
  private readonly socket: SocketLike;
  private pending: Word[] = [];
  private open = false;
  private ended = false;
  private closed = false;
  private readonly backlog: Uint8Array[] = [];
  private overflowed = false;
  private keepAlive: unknown = null;
  private closeFallback: unknown = null;
  /** End of the last word handed over in a turn, and whether it was Deepgram's endpointing that closed that turn. */
  private deliveredThroughMs = -1;
  private closedBySpeechFinal = false;
  /** An UtteranceEnd that arrived before the final result carrying its words: the turn is closed when they do arrive. */
  private owedThroughMs: number | null = null;

  constructor(
    apiKey: string,
    options: DeepgramOptions,
    private readonly handlers: LiveHandlers,
    // Deepgram accepts the key as a WebSocket subprotocol ("token", <key>), which works where custom headers do not.
    createSocket: (url: string, protocols: string[]) => SocketLike = (url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike,
    private readonly timers: TimersLike = REAL_TIMERS,
  ) {
    const url = `wss://${HOST}?${query(options, { encoding: "linear16", sample_rate: String(options.sampleRate ?? DEEPGRAM_SAMPLE_RATE), channels: "1", interim_results: "true", endpointing: "500", utterance_end_ms: "1500", vad_events: "true", mip_opt_out: "true" })}`;
    this.socket = createSocket(url, ["token", apiKey]);
    this.socket.onopen = () => {
      if (this.ended || this.closed) { this.socket.close(); return; }
      this.open = true;
      for (const chunk of this.backlog.splice(0)) this.socket.send(chunk);
      this.keepAlive = this.timers.setInterval(() => this.socket.send(JSON.stringify({ type: "KeepAlive" })), KEEP_ALIVE_MS);
    };
    this.socket.onmessage = (event) => this.receive(event.data);
    this.socket.onerror = () => this.handlers.onError(new DeepgramError(null, "the streaming transcription socket failed"));
    this.socket.onclose = () => {
      if (this.closed) return;
      this.closed = true;
      this.stopTimers();
      this.flush(false);
      this.ended = true;
      this.handlers.onClosed?.();
    };
  }

  private receive(data: unknown): void {
    if (this.closed || typeof data !== "string") return;
    let raw: { type?: unknown; timestamp?: unknown; last_word_end?: unknown };
    try {
      raw = JSON.parse(data) as typeof raw;
    } catch {
      return;
    }
    if (raw.type === "SpeechStarted" && typeof raw.timestamp === "number") return this.handlers.onSpeechStarted?.(Math.round(raw.timestamp * 1000));
    if (raw.type === "UtteranceEnd") return this.utteranceEnd(typeof raw.last_word_end === "number" && raw.last_word_end >= 0 ? Math.round(raw.last_word_end * 1000) : null);
    const parsed = results.safeParse(raw);
    if (!parsed.success) return;
    this.handlers.onTranscript?.(parsed.data.channel.alternatives[0]!.transcript, !!parsed.data.is_final);
    if (!parsed.data.is_final) return; // interim results never reach the call engine
    const words = toWords(parsed.data.channel.alternatives[0]!.words);
    this.pending.push(...words);
    const owed = this.owedThroughMs;
    if (owed !== null && words.length > 0) {
      this.owedThroughMs = null;
      // The words that UtteranceEnd closed have arrived. (Words that start after it are a new turn, still in progress.)
      if (words[0]!.start_ms <= owed) return this.flush(false);
    }
    if (parsed.data.speech_final) this.flush(true);
  }

  /**
   * Deepgram works UtteranceEnd out from interim word timings, so it can arrive BEFORE the final result that carries those
   * words. With nothing pending there is nothing to close yet - but dropping the signal would leave her words stuck until
   * she next spoke. It is remembered, and the turn closes when the words arrive. The ordinary case is told apart by
   * `last_word_end`: an UtteranceEnd for words already handed over (after a speech_final) closes nothing.
   */
  private utteranceEnd(lastWordEndMs: number | null): void {
    if (this.pending.length > 0) return this.flush(false);
    const alreadyDelivered = lastWordEndMs !== null ? lastWordEndMs <= this.deliveredThroughMs + TIMING_SLACK_MS : this.closedBySpeechFinal;
    this.closedBySpeechFinal = false;
    if (!alreadyDelivered) this.owedThroughMs = lastWordEndMs ?? Number.POSITIVE_INFINITY;
  }

  /** Close out the turn in progress. Called when Deepgram says she has finished, by either of its two signals. */
  private flush(bySpeechFinal: boolean): void {
    if (this.pending.length === 0) return;
    const words = this.pending;
    this.pending = [];
    this.deliveredThroughMs = words[words.length - 1]!.end_ms;
    this.closedBySpeechFinal = bySpeechFinal;
    this.handlers.onTurn({ start_ms: words[0]!.start_ms, end_ms: this.deliveredThroughMs, words });
  }

  /** Send her audio: signed 16-bit little-endian mono PCM at 16 kHz. */
  sendAudio(pcm: Uint8Array): void {
    if (this.ended) return;
    if (this.open) return this.socket.send(pcm);
    if (this.backlog.length < BACKLOG_LIMIT) return void this.backlog.push(pcm); // held only until the socket opens
    // Past the limit her audio is being lost, and a caller has to know: said once, through the same path as any other failure.
    if (!this.overflowed) this.handlers.onError(new DeepgramError(null, `the socket is still not open after ${BACKLOG_LIMIT} chunks of audio; audio is being dropped`));
    this.overflowed = true;
  }

  /**
   * She has finished. Deepgram answers CloseStream with the final results for the audio it is still holding, and then closes
   * the socket itself. A WebSocket delivers nothing once close() has been called, so closing here - as this once did - threw
   * her last words away. The socket is closed from this side only if Deepgram has not done so within CLOSE_GRACE_MS.
   */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.stopTimers();
    if (!this.open) {
      this.backlog.length = 0;
      return this.socket.close(); // never opened: Deepgram holds nothing to wait for
    }
    try {
      this.socket.send(JSON.stringify({ type: "CloseStream" }));
    } catch {
      return this.socket.close();
    }
    this.closeFallback = this.timers.setTimeout(() => this.socket.close(), CLOSE_GRACE_MS);
  }

  private stopTimers(): void {
    if (this.keepAlive !== null) this.timers.clearInterval(this.keepAlive);
    if (this.closeFallback !== null) this.timers.clearTimeout(this.closeFallback);
    this.keepAlive = this.closeFallback = null;
  }
}

export type DeepgramFetch = (url: string, init: { method: string; headers: Record<string, string>; body: Uint8Array }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

const prerecorded = z.object({ results: z.object({ channels: z.array(z.object({ alternatives: z.array(z.object({ transcript: z.string(), words: z.array(dgWord).default([]) })).min(1) })).min(1) }) });

/** Word timings for a whole WAV. This is how a recorded call's placeholder timings get replaced with measured ones. */
export async function transcribeWav(apiKey: string, wav: Uint8Array, options: DeepgramOptions = {}, fetchImpl: DeepgramFetch = (url, init) => fetch(url, init as RequestInit)): Promise<{ transcript: string; words: Word[] }> {
  const res = await fetchImpl(`https://${HOST}?${query(options, {})}`, { method: "POST", headers: { authorization: `Token ${apiKey}`, "content-type": "audio/wav" }, body: wav });
  if (!res.ok) throw new DeepgramError(res.status, (await res.text().catch(() => "")).slice(0, 300) || "transcription failed");
  const parsed = prerecorded.safeParse(await res.json());
  if (!parsed.success) throw new DeepgramError(res.status, "the response was not a transcription");
  const best = parsed.data.results.channels[0]!.alternatives[0]!;
  return { transcript: best.transcript, words: toWords(best.words) };
}
