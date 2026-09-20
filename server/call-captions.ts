/** Ephemeral, patient-only captions. The final WAV transcription remains the engine's evidence. */
import { DeepgramLive, requireDeepgramKey, type LiveHandlers } from "@/lib/providers/deepgram";

export type CallCaption = { step: string; text: string; final: boolean; unavailable: boolean };
export type CaptionStream = Pick<DeepgramLive, "sendAudio" | "end">;
export type CaptionFactory = (rate: number, handlers: LiveHandlers) => CaptionStream;
const connect: CaptionFactory = (sampleRate, handlers) => new DeepgramLive(requireDeepgramKey(process.env.DEEPGRAM_API_KEY), { sampleRate }, handlers);

export class CallCaptions {
  private stream: CaptionStream | null = null;
  private value: CallCaption | null = null;
  private stable = "";
  private rate = 0;
  private sequence = 0;
  private bytes = 0;
  private generation = 0;
  private finished = false;
  constructor(private create: CaptionFactory = connect) {}
  get snapshot(): CallCaption | null { return this.value ? { ...this.value } : null; }
  start(step: string) {
    this.clear();
    this.value = { step, text: "", final: false, unavailable: false };
    this.finished = false;
  }
  receive(step: string, pcm: Uint8Array, rate: number, sequence: number) {
    if (this.value?.step !== step || this.finished) throw new Error("The caption turn has ended.");
    if (!Number.isInteger(rate) || rate < 8000 || rate > 96000 || (this.rate && rate !== this.rate) || !pcm.length || pcm.length % 2 || pcm.length > rate * 2 || sequence !== this.sequence || this.bytes + pcm.length > rate * 2 * 80) throw new Error("Invalid caption audio.");
    this.sequence++; this.bytes += pcm.length;
    if (this.value.unavailable) return;
    const generation = this.generation;
    const current = () => this.generation === generation && !this.finished && this.value?.step === step && !this.value.unavailable;
    const unavailable = () => { if (current()) { this.value!.unavailable = true; this.closeStream(); } };
    try {
      if (!this.stream) {
        this.rate = rate;
        this.stream = this.create(rate, {
          onTranscript: (text, final) => {
            if (!current()) return;
            if (final && text.trim()) this.stable = `${this.stable} ${text}`.trim().slice(-4000);
            this.value = { step, text: `${this.stable} ${final ? "" : text}`.trim().slice(-4000), final, unavailable: false };
          },
          onTurn: () => {}, // Never feed preview text into safety, confirmation, or the graph.
          onError: unavailable,
          onClosed: unavailable,
        });
      }
      this.stream.sendAudio(pcm);
    } catch { unavailable(); }
  }
  finish() { this.finished = true; this.generation++; this.closeStream(); }
  complete(step: string, text: string) {
    if (this.value?.step !== step) return;
    this.finish();
    this.value = { step, text: text.slice(-4000), final: true, unavailable: false };
  }
  clear() {
    this.finish(); this.value = null; this.stable = ""; this.rate = 0; this.sequence = 0; this.bytes = 0;
  }
  private closeStream() { const stream = this.stream; this.stream = null; try { stream?.end(); } catch {} }
}
