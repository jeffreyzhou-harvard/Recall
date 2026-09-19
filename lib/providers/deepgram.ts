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
 * What Relay takes from it, and what it leaves:
 *   + her literal words, with a start and end time for each. The edit-decision list needs exactly
 *     that to find the pauses it may trim, so a live contribution is trimmed the same way a
 *     prerecorded one is.
 *   + endpointing. Relay assembles a turn only when Deepgram says she has finished speaking, and the
 *     state machine classifies answers and assent on those final turns alone - never on a partial.
 *   - confidence scores are read by nobody. They are not stored, shown, or used to judge anything
 *     about her (rule 4; "never surface model confidence").
 *
 * It only goes speech -> text. There is no text -> speech for her anywhere in Relay (rules 1 and 2).
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
  /** She started speaking. Lets a caller tell silence from a pause mid-sentence. */
  onSpeechStarted?: (atMs: number) => void;
  /** A final, endpointed turn. The only event Relay acts on. */
  onTurn: (turn: HeardTurn) => void;
  onError: (error: DeepgramError) => void;
  onClosed?: () => void;
}

export class DeepgramLive {
  private readonly socket: SocketLike;
  private pending: Word[] = [];
  private open = false;
  private ended = false;
  private readonly backlog: Uint8Array[] = [];

  constructor(
    apiKey: string,
    options: DeepgramOptions,
    private readonly handlers: LiveHandlers,
    // Deepgram accepts the key as a WebSocket subprotocol ("token", <key>), which works where custom headers do not.
    createSocket: (url: string, protocols: string[]) => SocketLike = (url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike,
  ) {
    const url = `wss://${HOST}?${query(options, { encoding: "linear16", sample_rate: String(DEEPGRAM_SAMPLE_RATE), channels: "1", interim_results: "true", endpointing: "500", utterance_end_ms: "1500", vad_events: "true" })}`;
    this.socket = createSocket(url, ["token", apiKey]);
    this.socket.onopen = () => {
      this.open = true;
      for (const chunk of this.backlog.splice(0)) this.socket.send(chunk);
    };
    this.socket.onmessage = (event) => this.receive(event.data);
    this.socket.onerror = () => this.handlers.onError(new DeepgramError(null, "the streaming transcription socket failed"));
    this.socket.onclose = () => {
      this.flush();
      this.ended = true;
      this.handlers.onClosed?.();
    };
  }

  private receive(data: unknown): void {
    if (typeof data !== "string") return;
    let raw: { type?: unknown; timestamp?: unknown };
    try {
      raw = JSON.parse(data) as typeof raw;
    } catch {
      return;
    }
    if (raw.type === "SpeechStarted" && typeof raw.timestamp === "number") return this.handlers.onSpeechStarted?.(Math.round(raw.timestamp * 1000));
    if (raw.type === "UtteranceEnd") return this.flush();
    const parsed = results.safeParse(raw);
    if (!parsed.success || !parsed.data.is_final) return; // interim results are never acted on
    this.pending.push(...toWords(parsed.data.channel.alternatives[0]!.words));
    if (parsed.data.speech_final) this.flush();
  }

  /** Close out the turn in progress. Called when Deepgram says she has finished, by either of its two signals. */
  private flush(): void {
    if (this.pending.length === 0) return;
    const words = this.pending;
    this.pending = [];
    this.handlers.onTurn({ start_ms: words[0]!.start_ms, end_ms: words[words.length - 1]!.end_ms, words });
  }

  /** Send her audio: signed 16-bit little-endian mono PCM at 16 kHz. */
  sendAudio(pcm: Uint8Array): void {
    if (this.ended) return;
    if (this.open) this.socket.send(pcm);
    else if (this.backlog.length < 400) this.backlog.push(pcm); // held only until the socket opens
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.backlog.length = 0;
    try {
      if (this.open) this.socket.send(JSON.stringify({ type: "CloseStream" }));
    } finally {
      this.socket.close();
    }
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
