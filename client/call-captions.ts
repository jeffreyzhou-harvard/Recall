/** Bounded, ordered audio uploads for display-only captions. No credentials or transcripts are stored. */
export class CaptionUpload {
  private pending = Promise.resolve();
  private queued = 0;
  private sequence = 0;
  private closed = false;
  private abort = new AbortController();
  constructor(private apiBase: string, private step: string, private unavailable: () => void) {}
  send(pcm: Uint8Array, rate: number) {
    if (this.closed) return;
    if (this.queued >= 8) { this.fail(); return; }
    this.queued++;
    const sequence = this.sequence++;
    this.pending = this.pending.then(async () => {
      if (this.closed) return;
      const params = new URLSearchParams({ action: "caption", step: this.step, rate: String(rate), sequence: String(sequence) });
      const response = await fetch(`${this.apiBase}/action?${params}`, { method: "POST", body: new Uint8Array(pcm), headers: { "Content-Type": "application/octet-stream" }, credentials: "same-origin", signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(5000)]) });
      if (!response.ok) throw new Error("Captions unavailable.");
    }).catch(() => { if (!this.closed) this.fail(); }).finally(() => { this.queued--; });
  }
  close() { this.closed = true; this.abort.abort(); }
  private fail() { this.close(); this.unavailable(); }
}
