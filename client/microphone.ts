/** The microphone is read only during a call's listening turn. No background audio is uploaded. */
export class Microphone {
  private generation = 0;
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private samples: Float32Array[] = [];
  private recording = false;
  private playing: AudioBufferSourceNode | null = null;
  private length = 0;
  private started = 0;
  private lastVoice = 0;
  private tick: ReturnType<typeof setInterval> | null = null;
  async open() {
    if (this.context) return;
    const generation = ++this.generation;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }, video: false });
    if (generation !== this.generation) { stream.getTracks().forEach((t) => t.stop()); throw new Error("Microphone opening was cancelled."); }
    try {
      this.stream = stream; this.context = new AudioContext({ sampleRate: 16000 });
      await this.context.audioWorklet.addModule("/audio/capture-worklet.js");
      if (generation !== this.generation) throw new Error("Microphone opening was cancelled.");
      this.node = new AudioWorkletNode(this.context, "recall-capture");
      this.node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (!this.recording) return;
        const data = event.data; this.samples.push(data); this.length += data.length;
        let energy = 0; for (const sample of data) energy += sample * sample;
        if (Math.sqrt(energy / data.length) > 0.012) this.lastVoice = performance.now();
      };
      const source = this.context.createMediaStreamSource(stream); source.connect(this.node); this.node.connect(this.context.destination); await this.context.resume();
    } catch (e) { this.close(); throw e; }
  }
  listen(onFinal: (wav: Uint8Array) => void) {
    if (!this.context) throw new Error("Microphone is not ready.");
    this.samples = []; this.length = 0; this.started = performance.now(); this.lastVoice = 0; this.recording = true;
    if (this.tick) clearInterval(this.tick);
    this.tick = setInterval(() => {
      const now = performance.now();
      if ((this.lastVoice && now - this.lastVoice > 6500) || (!this.lastVoice && now - this.started > 25000) || now - this.started > 75000) { const bytes = this.finish(); if (bytes) onFinal(bytes); }
    }, 200);
  }
  finish(): Uint8Array | null {
    if (!this.recording) return null; this.recording = false; if (this.tick) clearInterval(this.tick); this.tick = null;
    const rate = this.context!.sampleRate, data = new Uint8Array(44 + this.length * 2), view = new DataView(data.buffer);
    const word = (at: number, text: string) => { for (let i = 0; i < text.length; i++) data[at + i] = text.charCodeAt(i); };
    word(0, "RIFF"); view.setUint32(4, data.length - 8, true); word(8, "WAVEfmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); word(36, "data"); view.setUint32(40, this.length * 2, true);
    let at = 44; for (const chunk of this.samples) for (const sample of chunk) { view.setInt16(at, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true); at += 2; }
    this.samples = []; this.length = 0; return data;
  }
  async play(bytes: ArrayBuffer, pace: "slow" | "standard" = "standard") {
    if (!this.context) throw new Error("Audio is not ready.");
    await this.context.resume();
    const buffer = await this.context.decodeAudioData(bytes);
    const source = this.context.createBufferSource(); source.buffer = buffer; source.playbackRate.value = pace === "slow" ? 0.85 : 1; source.connect(this.context.destination); this.playing = source;
    await new Promise<void>((resolve) => { source.onended = () => { source.disconnect(); this.playing = null; resolve(); }; source.start(); });
  }
  close() { ++this.generation; this.playing?.stop(); this.recording = false; this.samples = []; if (this.tick) clearInterval(this.tick); this.tick = null; this.node?.disconnect(); this.stream?.getTracks().forEach((track) => track.stop()); void this.context?.close(); this.node = null; this.context = null; this.stream = null; }
}
