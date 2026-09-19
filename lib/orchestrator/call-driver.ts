/**
 * The phone call, as the orchestrator sees it: Recall speaks, her own audio is
 * played back, and Recall listens for her next final turn.
 *
 * The judged path uses FixtureCallDriver over a prerecorded call. Telephony,
 * ASR, and model latency never touch it (AGENTS.md section 9).
 *
 * A live call is one more implementation of `CallDriver`, paired with a
 * `TranscriptionProvider` that returns her turns for the windows `listen()`
 * hands back. What a live driver owes the engine:
 *   - `listen()` resolves on her next FINAL turn, or on silence. A window with no speech of hers is how
 *     silence is reported; the reducer decides what two of them mean.
 *   - `connect()` and `listen()` throw `CallUnavailableError` when nobody answers or the line drops. Any
 *     other error is a bug, and surfaces as one.
 *   - `hangUp()` ends the call AND wipes whatever audio the driver was holding (rule 8). The orchestrator
 *     calls it exactly once, on every way out, including an error nobody planned for.
 */
import type { FixtureClock } from "@/lib/clock";
import type { MediaSpan } from "@/lib/graph/types";
import type { AudioWindow, CallTranscript, Turn } from "@/lib/providers/transcription";
import { turnText } from "@/lib/providers/transcription";

/** Nobody answered, or the line dropped. Not a failure of the engine: the run ends `no_answer_today` or `stopped`. */
export class CallUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CallUnavailableError";
  }
}

export interface SpokenPrompt {
  prompt_id: string;
  text: string;
}

export interface CallDriver {
  readonly call_asset_id: string;
  connect(): Promise<void>;
  /** Recall speaks, in Recall's own labeled voice. Resolves when the line has finished. */
  speak(prompt: SpokenPrompt): Promise<void>;
  /** Play her own recorded audio back to her - the exact kept spans of the pending artifact. Never synthesized. */
  playback(kept?: { asset_id: string; spans: MediaSpan[] }): Promise<void>;
  /** Wait for her next final turn, or for the silence timeout. Returns the window to assess. */
  listen(): Promise<AudioWindow>;
  hangUp(): Promise<void>;
}

/**
 * Thrown when what the tools produced and what was prerecorded disagree. On
 * the judged path that would mean the audio says one thing while the trace
 * shows another, so it stops the run rather than being papered over.
 */
export class ScriptMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptMismatchError";
  }
}

export class FixtureCallDriver implements CallDriver {
  readonly call_asset_id: string;
  private cursor = 0;
  private callStartMs = 0;
  private lastEndMs = 0;

  constructor(
    private readonly transcript: CallTranscript,
    private readonly clock: FixtureClock,
    private readonly connectDelayMs: number,
  ) {
    this.call_asset_id = transcript.asset_id;
  }

  private next(expected: Turn["speaker"], doing: string): Turn {
    const turn = this.transcript.turns[this.cursor];
    if (!turn) throw new ScriptMismatchError(`${doing}, but the prerecorded call has no more turns`);
    if (turn.speaker !== expected) {
      throw new ScriptMismatchError(`${doing}, but the next prerecorded turn (${turn.turn_id}) is ${turn.speaker}`);
    }
    this.cursor++;
    return turn;
  }

  /** Move the fixture clock to where this turn ends in the recording. Tool latency may already have carried it past. */
  private advanceTo(callMs: number): void {
    const target = this.callStartMs + callMs;
    if (target > this.clock.now()) this.clock.advance(target - this.clock.now());
    this.lastEndMs = callMs;
  }

  async connect(): Promise<void> {
    this.clock.advance(this.connectDelayMs);
    this.callStartMs = this.clock.now();
  }

  async speak(prompt: SpokenPrompt): Promise<void> {
    const turn = this.next("recall", `Recall is about to say "${prompt.text}"`);
    const recorded = turnText(turn);
    if (recorded !== prompt.text) {
      throw new ScriptMismatchError(`Recall rendered "${prompt.text}" but the prerecorded line ${turn.turn_id} is "${recorded}"`);
    }
    this.advanceTo(turn.end_ms);
  }

  async playback(): Promise<void> {
    this.advanceTo(this.next("playback", "Recall is about to play her audio back").end_ms);
  }

  async listen(): Promise<AudioWindow> {
    const start = this.lastEndMs;
    const turn = this.next("participant", "Recall is listening");
    this.advanceTo(turn.end_ms);
    return { asset_id: this.call_asset_id, start_ms: start, end_ms: turn.end_ms };
  }

  async hangUp(): Promise<void> {
    const left = this.transcript.turns.length - this.cursor;
    if (left > 0) throw new ScriptMismatchError(`the call ended with ${left} prerecorded turn(s) unplayed`);
  }
}
