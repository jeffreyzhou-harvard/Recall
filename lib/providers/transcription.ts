/**
 * Transcription boundary. The judged path reads a literal, time-aligned
 * transcript fixture. The optional live side demo would put Deepgram streaming
 * STT (word timings, endpointing) or Meta Muse Voice Transcribe behind this
 * same interface.
 *
 * Transcription only ever goes speech -> text. There is no text -> speech for
 * the participant anywhere in Relay: her audio is played back, never
 * synthesized (rules 1 and 2).
 */
import type { MediaSpan } from "@/lib/graph/types";

/** `participant` is the person Relay calls. `playback` is her own recorded audio being played back to her. */
export type Speaker = "participant" | "relay" | "playback";

export interface Word {
  w: string;
  start_ms: number;
  end_ms: number;
}

export interface Turn {
  turn_id: string;
  speaker: Speaker;
  start_ms: number;
  end_ms: number;
  /** Endpointing result. The state machine classifies answers and assent on final turns only. */
  is_final: boolean;
  words: Word[];
}

export interface CallTranscript {
  asset_id: string;
  provider: "fixture" | "deepgram" | "muse_voice_transcribe";
  /** `placeholder` until timings are measured from the real recording. */
  timing_status: "placeholder" | "measured";
  note?: string;
  turns: Turn[];
}

export interface AudioWindow extends MediaSpan {
  asset_id: string;
}

export interface TranscriptionProvider {
  readonly label: string;
  /** Turns that lie wholly inside the window, in order. */
  turnsIn(window: AudioWindow): Promise<Turn[]>;
  /** Every turn of the recording, in order. */
  allTurns(assetId: string): Promise<Turn[]>;
}

export class FixtureTranscription implements TranscriptionProvider {
  readonly label = "fixture transcript";
  private readonly byAsset = new Map<string, CallTranscript>();

  constructor(transcripts: CallTranscript[]) {
    for (const t of transcripts) this.byAsset.set(t.asset_id, t);
  }

  private get(assetId: string): CallTranscript {
    const t = this.byAsset.get(assetId);
    if (!t) throw new Error(`no transcript fixture for asset "${assetId}"`);
    return t;
  }

  async turnsIn(window: AudioWindow): Promise<Turn[]> {
    return this.get(window.asset_id).turns.filter((t) => t.start_ms >= window.start_ms && t.end_ms <= window.end_ms);
  }

  async allTurns(assetId: string): Promise<Turn[]> {
    return this.get(assetId).turns;
  }
}

export const turnText = (turn: Pick<Turn, "words">): string => turn.words.map((w) => w.w).join(" ");

/** Lowercased word tokens with punctuation stripped, for lexical rules. Never used to rewrite her words. */
export const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
