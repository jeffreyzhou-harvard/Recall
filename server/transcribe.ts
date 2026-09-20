import { transcribeWav, requireDeepgramKey } from "@/lib/providers/deepgram";
/** Completed turns only. Provider timeouts cancel network I/O; no graph mutations occur here. */
export async function transcribe(bytes: Buffer, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(15000), combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  return transcribeWav(requireDeepgramKey(process.env.DEEPGRAM_API_KEY), bytes, {}, (url, init) => fetch(`${url}&mip_opt_out=true`, { ...init, body: new Uint8Array(init.body), signal: combined }));
}
