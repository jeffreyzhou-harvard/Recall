/**
 * Capturing her side of a live call - under rule 8.
 *
 *   "From each call [keep] only the approved contribution ... and assent audio.
 *    Delete unapproved call audio at call end. Never ... continuous audio."
 *
 * That rule is this class's shape, not a promise in a comment:
 *
 *   - There is NO method that returns the whole recording. `finish` takes the
 *     spans she approved and returns only those; everything else is zeroed and
 *     dropped. With no approved spans it returns nothing at all.
 *   - Audio lives in memory for the length of the call and is never written to
 *     disk, uploaded, or handed to a MediaRecorder.
 *   - It reads the AUDIO track only. Video is never recorded, by anyone:
 *     nothing in Relay ever attaches a recorder to a video track.
 *
 * Captured as 16-bit PCM so the edit-decision list can be applied by copying
 * her samples byte for byte (lib/provenance/wav.ts), with no re-encoding.
 *
 * LIVE ONLY. Browser only.
 */
import type { MediaSpan } from "@/lib/graph/types";
import { sha256Bytes } from "@/lib/provenance/hash";
import { cutWav, encodeWavPcm16, floatToPcm16 } from "@/lib/provenance/wav";

export const CAPTURE_SAMPLE_RATE = 16_000;

/** Runs on the audio thread and posts raw samples to the recorder. Inlined so no extra file has to be served. */
const WORKLET = `
class RelayCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("relay-capture", RelayCapture);
`;

export interface ApprovedAudio {
  /** A WAV holding only the approved spans, in order. */
  wav: Uint8Array;
  /** Hash of the full call audio, taken before it was dropped: the receipt can commit to a source it no longer holds. */
  source_sha256: string;
  kept: MediaSpan[];
}

export class ParticipantRecorder {
  private context: AudioContext | null = null;
  private chunks: Int16Array[] = [];
  private finished = false;

  /** Start capturing her audio. `stream` is the remote stream from the call; only its audio track is read. */
  async start(stream: MediaStream): Promise<void> {
    if (this.context) throw new Error("already recording");
    const [audio] = stream.getAudioTracks();
    if (!audio) throw new Error("the call has no audio track to capture");
    const context = new AudioContext({ sampleRate: CAPTURE_SAMPLE_RATE });
    const moduleUrl = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    try {
      await context.audioWorklet.addModule(moduleUrl);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
    const node = new AudioWorkletNode(context, "relay-capture");
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (!this.finished) this.chunks.push(floatToPcm16(e.data));
    };
    // Audio only: a new stream holding just that one track, so the video track is never even connected.
    context.createMediaStreamSource(new MediaStream([audio])).connect(node);
    this.context = context;
  }

  /** How much has been captured so far, in call time. */
  get elapsedMs(): number {
    return Math.round((this.chunks.reduce((n, c) => n + c.length, 0) / CAPTURE_SAMPLE_RATE) * 1000);
  }

  /**
   * End the capture. Returns ONLY the approved spans, or null if she approved nothing.
   * Whatever is not returned is overwritten with zeros and released before this resolves.
   */
  async finish(approved: readonly MediaSpan[] | null): Promise<ApprovedAudio | null> {
    if (this.finished) throw new Error("this recording has already been finished");
    this.finished = true;
    await this.context?.close();
    this.context = null;
    try {
      if (!approved || approved.length === 0) return null;
      const full = encodeWavPcm16(this.chunks, CAPTURE_SAMPLE_RATE);
      const wav = cutWav(full, approved);
      const source_sha256 = await sha256Bytes(full);
      full.fill(0);
      return wav ? { wav, source_sha256, kept: [...approved] } : null;
    } finally {
      for (const chunk of this.chunks) chunk.fill(0);
      this.chunks = [];
    }
  }
}
