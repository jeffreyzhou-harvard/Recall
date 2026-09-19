/**
 * Edit-decision list. The ONLY edits Relay may make to her contribution are
 * silence trims and disfluency trims, and every one is listed (rule 1). There
 * is no operation here that adds, reorders, substitutes, or re-times a word,
 * so such an edit cannot be expressed, let alone applied.
 *
 * Source audio is immutable. An EDL is a set of cut points over it; nothing
 * is ever re-encoded.
 */
import type { MediaSpan } from "@/lib/graph/types";
import type { Word } from "@/lib/providers/transcription";

export const TRIM_KINDS = ["silence", "disfluency"] as const;
export type TrimKind = (typeof TRIM_KINDS)[number];

export interface Trim extends MediaSpan {
  kind: TrimKind;
}

export interface EditDecisionList {
  source_asset_id: string;
  source_sha256: string;
  /** The stretches of the recording the contribution is drawn from. */
  intervals: MediaSpan[];
  trims: Trim[];
  /** `intervals` minus `trims`: exactly what plays, in order. */
  kept: MediaSpan[];
}

export interface EdlOptions {
  /** A gap between two of her words longer than this is trimmed. */
  min_silence_ms: number;
  /** Silence left on each side of a trim so words are never clipped. */
  pad_ms: number;
  /** Standalone filler tokens that may be trimmed. Whole words only. */
  fillers: readonly string[];
}

export const DEFAULT_EDL_OPTIONS: EdlOptions = { min_silence_ms: 700, pad_ms: 150, fillers: ["um", "uh", "er", "hmm"] };

export class EdlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EdlError";
  }
}

const bare = (w: string): string => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
const overlaps = (a: MediaSpan, b: MediaSpan): boolean => a.start_ms < b.end_ms && b.start_ms < a.end_ms;

function subtract(intervals: MediaSpan[], trims: Trim[]): MediaSpan[] {
  const kept: MediaSpan[] = [];
  const sorted = [...trims].sort((a, b) => a.start_ms - b.start_ms);
  for (const interval of intervals) {
    let cursor = interval.start_ms;
    for (const t of sorted) {
      if (t.end_ms <= cursor || t.start_ms >= interval.end_ms) continue;
      if (t.start_ms > cursor) kept.push({ start_ms: cursor, end_ms: t.start_ms });
      cursor = Math.max(cursor, t.end_ms);
    }
    if (cursor < interval.end_ms) kept.push({ start_ms: cursor, end_ms: interval.end_ms });
  }
  return kept;
}

/** Build the EDL for a contribution from her word timings. Deterministic: same words in, same cuts out. */
export function buildEdl(
  source: { asset_id: string; sha256: string },
  intervals: MediaSpan[],
  words: Word[],
  options: EdlOptions = DEFAULT_EDL_OPTIONS,
): EditDecisionList {
  const trims: Trim[] = [];
  const fillers = new Set(options.fillers);
  for (const interval of intervals) {
    const inside = words
      .filter((w) => w.start_ms >= interval.start_ms && w.end_ms <= interval.end_ms)
      .sort((a, b) => a.start_ms - b.start_ms);
    for (const w of inside) {
      if (fillers.has(bare(w.w))) trims.push({ kind: "disfluency", start_ms: w.start_ms, end_ms: w.end_ms });
    }
    for (let i = 0; i + 1 < inside.length; i++) {
      const gapStart = inside[i]!.end_ms;
      const gapEnd = inside[i + 1]!.start_ms;
      if (gapEnd - gapStart > options.min_silence_ms) {
        trims.push({ kind: "silence", start_ms: gapStart + options.pad_ms, end_ms: gapEnd - options.pad_ms });
      }
    }
  }
  trims.sort((a, b) => a.start_ms - b.start_ms);
  const edl: EditDecisionList = {
    source_asset_id: source.asset_id,
    source_sha256: source.sha256,
    intervals,
    trims,
    kept: subtract(intervals, trims),
  };
  validateEdl(edl, words, options);
  return edl;
}

/**
 * Independent check, run on every EDL whether Relay built it or not. Throws if
 * any trim is of an unknown kind, falls outside the intervals, overlaps
 * another trim, or - the one that matters - removes any part of a word that
 * is not a listed filler.
 */
export function validateEdl(edl: EditDecisionList, words: Word[], options: EdlOptions = DEFAULT_EDL_OPTIONS): void {
  const fillers = new Set(options.fillers);
  for (const [i, trim] of edl.trims.entries()) {
    if (!TRIM_KINDS.includes(trim.kind)) throw new EdlError(`trim ${i}: "${String(trim.kind)}" is not a permitted edit`);
    if (trim.end_ms <= trim.start_ms) throw new EdlError(`trim ${i}: empty or reversed span`);
    if (!edl.intervals.some((iv) => trim.start_ms >= iv.start_ms && trim.end_ms <= iv.end_ms)) {
      throw new EdlError(`trim ${i}: lies outside the contribution intervals`);
    }
    if (edl.trims.some((other, j) => j !== i && overlaps(trim, other))) throw new EdlError(`trim ${i}: overlaps another trim`);
    for (const w of words) {
      if (!overlaps(trim, w)) continue;
      const isWholeFiller =
        trim.kind === "disfluency" && fillers.has(bare(w.w)) && trim.start_ms <= w.start_ms && trim.end_ms >= w.end_ms;
      if (!isWholeFiller) throw new EdlError(`trim ${i} (${trim.kind}) would cut into the word "${w.w}"`);
    }
  }
  const expected = subtract(edl.intervals, edl.trims);
  if (JSON.stringify(expected) !== JSON.stringify(edl.kept)) {
    throw new EdlError("kept spans do not equal intervals minus trims");
  }
}

export const trimCount = (edl: EditDecisionList, kind: TrimKind): number => edl.trims.filter((t) => t.kind === kind).length;
