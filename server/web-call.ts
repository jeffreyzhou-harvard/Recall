/** A real browser transport for the existing call engine. Commands must finish before the engine advances. */
import { ToolTimeoutError } from "@/lib/tools/runtime";
import { randomUUID } from "node:crypto";
import { CallUnavailableError, type CallDriver, type SpokenPrompt } from "@/lib/orchestrator/call-driver";
import type { MediaSpan } from "@/lib/graph/types";
import type { AudioWindow, TranscriptionProvider, Turn, Word } from "@/lib/providers/transcription";
import type { GraphStore } from "@/lib/graph/store";
import { MediaStore, parseWav, wavFromPcm, type Media } from "./media";
import { recallVoice } from "./recall-voice";
import { transcribe } from "./transcribe";
export type WebCommand = { id: string; kind: "incoming" | "speak" | "playback" | "listen"; text?: string; pace?: "slow" | "standard" };
export class LiveTranscription implements TranscriptionProvider {
  readonly label = "Deepgram measured final turns";
  private turns = new Map<string, Turn[]>();
  put(id: string, words: Word[], duration: number) {
    if (words.some((w) => !Number.isFinite(w.start_ms) || !Number.isFinite(w.end_ms) || w.start_ms < 0 || w.end_ms > duration || w.end_ms < w.start_ms)) throw new Error("Transcription timestamps are outside the recording.");
    this.turns.set(id, words.length ? [{ turn_id: `turn:${id}`, speaker: "participant", is_final: true, start_ms: words[0]!.start_ms, end_ms: words.at(-1)!.end_ms, words }] : []);
  }
  async allTurns(id: string) { const turns = this.turns.get(id); if (!turns) throw new Error("No final transcript for this recording."); return structuredClone(turns); }
  async turnsIn(w: AudioWindow) { return (await this.allTurns(w.asset_id)).filter((t) => t.start_ms >= w.start_ms && t.end_ms <= w.end_ms); }
  forget(id: string) { this.turns.delete(id); }
}
export class WebCall implements CallDriver {
  readonly call_asset_id = `web-call:${randomUUID()}`;
  command: WebCommand | null = null;
  topicLabel = "";
  stopped = false;
  private closed = false;
  private expired = false;
  get cannotCommit() { return this.stopped || this.expired; }
  private reject: ((error: Error) => void) | null = null;
  private resolve: ((value: AudioWindow | undefined) => void) | null = null;
  private recording = new Map<string, Media>();
  private playing: Buffer | null = null;
  private processing = false;
  private abort = new AbortController();
  constructor(readonly person: string, private media: MediaStore, private transcription: LiveTranscription, private graph: GraphStore, private pace: "slow" | "standard", private maxMinutes: number, private recognize = transcribe, private voice = recallVoice) {}
  private expiry: ReturnType<typeof setTimeout> | null = null;
  private async ask(kind: WebCommand["kind"], text?: string): Promise<AudioWindow | undefined> {
    if (this.closed || this.stopped) throw new CallUnavailableError("The call ended.");
    if (this.command) throw new Error("A call command is already pending.");
    this.command = { id: randomUUID(), kind, ...(text ? { text } : {}), pace: this.pace };
    const timeout = kind === "incoming" ? 60000 : kind === "listen" ? 100000 : 60000;
    try {
      return await new Promise<AudioWindow | undefined>((resolve, reject) => {
        const timer = setTimeout(() => { this.stop(); }, timeout);
        this.resolve = (v) => { clearTimeout(timer); resolve(v); }; this.reject = (e) => { clearTimeout(timer); reject(e); };
      });
    } finally { this.resolve = null; this.reject = null; this.command = null; }
  }
  async connect() { await this.ask("incoming"); this.expiry = setTimeout(() => { this.expired = true; this.abort.abort(); this.reject?.(new ToolTimeoutError("assess_conversation_state")); }, this.maxMinutes * 60000); }
  async speak(prompt: SpokenPrompt) {
    if (this.closed || this.stopped) throw new CallUnavailableError("The call ended.");
    try { this.playing = await this.voice(prompt.text, this.abort.signal.aborted ? undefined : this.abort.signal); }
    catch {
      if (this.expired && !this.stopped) throw new ToolTimeoutError("render_prompt");
      this.stop(); throw new CallUnavailableError("Recall audio is unavailable.");
    }
    try { await this.ask("speak", prompt.text); } finally { this.playing = null; }
  }
  async playback(kept?: { asset_id: string; spans: MediaSpan[] }) {
    const media = kept && this.recording.get(kept.asset_id);
    if (!media || !kept) throw new Error("The original audio is unavailable.");
    const rate = media.bytes.readUInt32LE(24), pcm = media.bytes.subarray(44);
    this.playing = wavFromPcm(Buffer.concat(kept.spans.map((s) => pcm.subarray(Math.floor(s.start_ms * rate / 1000) * 2, Math.ceil(s.end_ms * rate / 1000) * 2))), rate);
    try { await this.ask("playback"); } finally { this.playing = null; }
  }
  async listen(): Promise<AudioWindow> { if (this.expired) throw new ToolTimeoutError("assess_conversation_state"); const window = await this.ask("listen"); if (!window) throw new Error("A final recording is required."); return window; }
  acknowledge(id: string) {
    if (!this.command || this.command.id !== id || this.command.kind === "listen" || this.processing) throw new Error("This call step is no longer available.");
    const resolve = this.resolve; this.resolve = null; resolve?.(undefined);
  }
  audio(id: string): Buffer | null { return this.command?.id === id && ["playback", "speak"].includes(this.command.kind) ? this.playing : null; }
  async receive(id: string, bytes: Buffer, stopping = false) {
    if (this.command?.id !== id || this.command.kind !== "listen" || this.processing || !this.resolve) throw new Error("This recording step has ended.");
    this.processing = true;
    try {
      const wav = parseWav(bytes);
      let result;
      try { result = await this.recognize(wav.bytes, this.abort.signal); }
      catch {
        this.reject?.(this.stopped || this.closed ? new CallUnavailableError("The call ended.") : new ToolTimeoutError("assess_conversation_state"));
        return;
      }
      if (this.closed || this.command?.id !== id || !this.resolve) throw new CallUnavailableError("The call ended.");
      const media = this.media.make(wav.bytes, this.person, "audio/wav", wav.duration);
      this.transcription.put(media.entry.id, result.words, wav.duration);
      this.recording.set(media.entry.id, media);
      // Survives a process failure during commit. Normal hang-up deletes every unreferenced recording.
      await this.media.save(media);
      this.stopped = stopping;
      const resolve = this.resolve; this.resolve = null; resolve({ asset_id: media.entry.id, start_ms: 0, end_ms: wav.duration });
    } catch (e) { this.reject?.(new CallUnavailableError("The recording could not be received.")); throw e; }
    finally { this.processing = false; }
  }
  stop() {
    this.stopped = true;
    // A final recording already received must still pass the safety check, even after hang-up.
    if (this.processing) return;
    this.abort.abort(); this.reject?.(new CallUnavailableError("The call ended."));
  }
  async retainConfirmed(evidence: { contribution_hash: string; store: unknown; share: unknown; share_audio?: { asset_id: string; start_ms: number; end_ms: number } | null }) {
    for (const confirmation of [evidence.store, evidence.share]) {
      const id = (confirmation as { audio?: { asset_id?: string } } | null)?.audio?.asset_id;
      if (id && this.recording.has(id)) { this.media.keep(id); }
    }
    if (evidence.share_audio && this.recording.has(evidence.share_audio.asset_id)) this.media.keep(evidence.share_audio.asset_id);
    this.media.receipt(evidence.contribution_hash, { ...evidence, share_audio_hash: evidence.share_audio ? this.recording.get(evidence.share_audio.asset_id)?.entry.sha256 ?? null : null });
  }
  async hangUp() {
    if (this.closed) return; this.closed = true;
    if (this.expiry) clearTimeout(this.expiry); this.abort.abort(); this.reject?.(new CallUnavailableError("The call ended.")); this.command = null; this.playing = null;
    try {
      const used = new Set((await this.graph.nodesOfType("Artifact")).map((n) => n.prov.asset_id));
      for (const [id] of this.recording) { if (used.has(id) || this.media.isPermanent(id)) this.media.keep(id); else this.media.remove(id); }
    } finally { for (const id of this.recording.keys()) this.transcription.forget(id); this.recording.clear(); }
  }
}
