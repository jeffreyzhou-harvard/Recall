/**
 * Apply an edit-decision list to a PCM WAV recording: copy out the kept spans,
 * in order, and nothing else.
 *
 * This is a cut, not an edit. Samples are copied byte for byte at frame
 * boundaries - no resampling, no re-encoding, no crossfades, no gain. Every
 * sample in the output is a sample from her recording, in its original order.
 * The source bytes are never modified (they are hashed; see assets.ts).
 *
 * PCM WAV only. A compressed source has no sample-exact byte ranges, so it
 * must be decoded by something else first; this returns null rather than guess.
 */
import type { MediaSpan } from "@/lib/graph/types";

interface WavLayout {
  channels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  dataOffset: number;
  dataSize: number;
}

const ascii = (bytes: Uint8Array, at: number, length: number): string => String.fromCharCode(...bytes.subarray(at, at + length));

function layoutOf(bytes: Uint8Array): WavLayout | null {
  if (bytes.byteLength < 44 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fmt: Omit<WavLayout, "dataOffset" | "dataSize"> | null = null;
  for (let at = 12; at + 8 <= bytes.byteLength; ) {
    const id = ascii(bytes, at, 4);
    const size = view.getUint32(at + 4, true);
    if (id === "fmt ") {
      if (view.getUint16(at + 8, true) !== 1) return null; // not uncompressed PCM
      fmt = {
        channels: view.getUint16(at + 10, true),
        sampleRate: view.getUint32(at + 12, true),
        byteRate: view.getUint32(at + 16, true),
        blockAlign: view.getUint16(at + 20, true),
        bitsPerSample: view.getUint16(at + 22, true),
      };
    } else if (id === "data") {
      return fmt ? { ...fmt, dataOffset: at + 8, dataSize: Math.min(size, bytes.byteLength - at - 8) } : null;
    }
    at += 8 + size + (size % 2);
  }
  return null;
}

/** The kept spans of a PCM WAV, as a new WAV. Null if the source is not PCM WAV. Throws if a span lies outside the recording. */
export function cutWav(source: Uint8Array, kept: readonly MediaSpan[]): Uint8Array | null {
  const wav = layoutOf(source);
  if (!wav) return null;

  const frameAt = (ms: number): number => Math.round((ms / 1000) * wav.sampleRate) * wav.blockAlign;
  const ranges = kept.map((span) => {
    const [start, end] = [frameAt(span.start_ms), frameAt(span.end_ms)];
    if (start < 0 || end > wav.dataSize || end <= start) throw new Error(`span ${span.start_ms}-${span.end_ms}ms lies outside the recording`);
    return { start, end };
  });
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i]!.start < ranges[i - 1]!.end) throw new Error("kept spans must be in order and must not overlap: her words are never reordered");
  }

  const dataSize = ranges.reduce((n, r) => n + (r.end - r.start), 0);
  const out = new Uint8Array(44 + dataSize);
  const view = new DataView(out.buffer);
  const put = (at: number, text: string): void => void [...text].forEach((c, i) => (out[at + i] = c.charCodeAt(0)));
  put(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  put(8, "WAVE");
  put(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, wav.channels, true);
  view.setUint32(24, wav.sampleRate, true);
  view.setUint32(28, wav.byteRate, true);
  view.setUint16(32, wav.blockAlign, true);
  view.setUint16(34, wav.bitsPerSample, true);
  put(36, "data");
  view.setUint32(40, dataSize, true);

  let at = 44;
  for (const r of ranges) {
    out.set(source.subarray(wav.dataOffset + r.start, wav.dataOffset + r.end), at);
    at += r.end - r.start;
  }
  return out;
}

/** 16-bit mono PCM samples as a WAV file. What a live call is captured into, so `cutWav` can apply the EDL to it. */
export function encodeWavPcm16(chunks: readonly Int16Array[], sampleRate: number): Uint8Array {
  const samples = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(44 + samples * 2);
  const view = new DataView(out.buffer);
  const put = (at: number, text: string): void => void [...text].forEach((c, i) => (out[at + i] = c.charCodeAt(0)));
  put(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  put(8, "WAVE");
  put(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  put(36, "data");
  view.setUint32(40, samples * 2, true);
  let at = 44;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      view.setInt16(at, sample, true);
      at += 2;
    }
  }
  return out;
}

/** Float samples in [-1, 1], as the Web Audio API delivers them, to 16-bit PCM. Clamped, never scaled or "improved". */
export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    out[i] = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff);
  }
  return out;
}
