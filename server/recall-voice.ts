/** Recall's clearly identified AI voice. Called only with prompts rendered by the gated engine. */
export async function recallVoice(text: string, signal?: AbortSignal): Promise<Buffer> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("Recall's voice is not configured.");
  const response = await fetch("https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=linear16&sample_rate=16000&container=wav&mip_opt_out=true", { method: "POST", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000), headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  if (!response.ok) throw new Error("Recall's voice is unavailable.");
  return Buffer.from(await response.arrayBuffer());
}
