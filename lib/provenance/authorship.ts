/**
 * Authorship invariants (AGENTS.md section 12.4). These are checks, not
 * aspirations: capture refuses to produce a contribution that fails them, and
 * the reducer refuses to enter `contributed` with a non-zero count.
 */
import type { MediaSpan } from "@/lib/graph/types";
import type { Turn, Word } from "@/lib/providers/transcription";

export class AuthorshipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorshipError";
  }
}

const within = (w: MediaSpan, iv: MediaSpan): boolean => w.start_ms >= iv.start_ms && w.end_ms <= iv.end_ms;
const touches = (a: MediaSpan, b: MediaSpan): boolean => a.start_ms < b.end_ms && b.start_ms < a.end_ms;

/**
 * Every word inside the intervals must have been spoken by the participant.
 * Recall's prompts and played-back audio are rejected outright, as is any
 * interval that clips a word at its edge.
 */
export function participantWordsIn(turns: Turn[], intervals: MediaSpan[]): Word[] {
  const words: Word[] = [];
  for (const turn of turns) {
    for (const w of turn.words) {
      const hit = intervals.find((iv) => touches(w, iv));
      if (!hit) continue;
      if (turn.speaker !== "participant") {
        // Where, never what: an error lands in logs, and a played-back turn is her own voice (rule 8).
        throw new AuthorshipError(`interval contains ${turn.speaker} speech at ${w.start_ms} ms; only her own words may be captured`);
      }
      if (!within(w, hit)) throw new AuthorshipError(`interval clips a word at ${w.start_ms}-${w.end_ms} ms`);
      words.push(w);
    }
  }
  if (words.length === 0) throw new AuthorshipError("intervals contain none of her words");
  return words.sort((a, b) => a.start_ms - b.start_ms);
}

/**
 * Words in an outbound artifact that cannot be matched, text and timing both,
 * to a word the participant actually spoke in the source recording. For
 * anything Recall sends this is exactly 0.
 */
export function generatedFirstPersonWords(outbound: Word[], sourceTurns: Turn[]): number {
  const spoken = new Set(
    sourceTurns
      .filter((t) => t.speaker === "participant")
      .flatMap((t) => t.words.map((w) => `${w.start_ms}:${w.end_ms}:${w.w}`)),
  );
  return outbound.filter((w) => !spoken.has(`${w.start_ms}:${w.end_ms}:${w.w}`)).length;
}

/** Share of the artifact's words that are hers, as a whole percentage. */
export function herWordsPct(outbound: Word[], sourceTurns: Turn[]): number {
  if (outbound.length === 0) return 0;
  return Math.round(((outbound.length - generatedFirstPersonWords(outbound, sourceTurns)) / outbound.length) * 100);
}
