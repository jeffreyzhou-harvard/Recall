import { afterEach, describe, expect, it, vi } from "vitest";
import { CallCaptions } from "@/server/call-captions";
import { CaptionUpload } from "@/client/call-captions";
import { DeepgramError, type LiveHandlers } from "@/lib/providers/deepgram";

const pcm = new Uint8Array(16000);
function captions() {
  const streams: { rate: number; handlers: LiveHandlers; sendAudio: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }[] = [];
  const value = new CallCaptions((rate, handlers) => {
    const stream = { rate, handlers, sendAudio: vi.fn(), end: vi.fn() };
    streams.push(stream); return stream;
  });
  return { value, streams };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("ephemeral patient captions", () => {
  it("replaces interim words, appends finalized segments, and accepts the authoritative completed transcript", () => {
    const { value, streams } = captions();
    value.start("one"); value.receive("one", pcm, 16000, 0);
    const emit = streams[0]!.handlers.onTranscript!;
    emit("We visited the", false); emit("We visited Cape May.", true); emit("With my", false);
    expect(value.snapshot).toMatchObject({ text: "We visited Cape May. With my", final: false });
    emit("With Maya.", true);
    expect(value.snapshot?.text).toBe("We visited Cape May. With Maya.");
    value.finish(); emit("Late provider text", false);
    expect(value.snapshot?.text).not.toContain("Late");
    value.complete("one", "We visited Cape May with Maya.");
    expect(value.snapshot).toMatchObject({ text: "We visited Cape May with Maya.", final: true });
    expect(streams[0]!.end).toHaveBeenCalledOnce();
  });
  it("clears stopped words and prevents stale callbacks or turn IDs from repopulating a later turn", () => {
    const { value, streams } = captions();
    value.start("one"); value.receive("one", pcm, 16000, 0);
    streams[0]!.handlers.onTranscript!("Unconfirmed words", false);
    value.clear(); expect(value.snapshot).toBeNull();
    streams[0]!.handlers.onTranscript!("Late words", true);
    value.complete("one", "Late final transcript"); expect(value.snapshot).toBeNull();
    value.start("two");
    expect(() => value.receive("one", pcm, 16000, 1)).toThrow();
    streams[0]!.handlers.onTranscript!("Old turn", true);
    expect(value.snapshot?.text).toBe("");
    value.receive("two", pcm, 16000, 0); expect(streams).toHaveLength(2);
    value.clear();
  });
  it("rejects reordered, oversized, odd-sized and changing-rate audio before sending it", () => {
    const { value, streams } = captions();
    value.start("one");
    for (const [bytes, rate, sequence] of [[pcm, 16000, 1], [new Uint8Array(3), 16000, 0], [new Uint8Array(32002), 16000, 0], [pcm, Number.NaN, 0], [pcm, 192000, 0]] as const) expect(() => value.receive("one", bytes, rate, sequence)).toThrow();
    expect(streams).toEqual([]);
    value.receive("one", pcm, 48000, 0); expect(streams[0]!.rate).toBe(48000);
    expect(() => value.receive("one", pcm, 16000, 1)).toThrow();
    expect(() => value.receive("one", pcm, 48000, 0)).toThrow();
    expect(streams[0]!.sendAudio).toHaveBeenCalledOnce(); value.clear();
  });
  it("keeps streaming failure separate from the completed recording's transcript", () => {
    const { value, streams } = captions();
    value.start("one"); value.receive("one", pcm, 16000, 0);
    streams[0]!.handlers.onError(new DeepgramError(null, "offline"));
    expect(value.snapshot?.unavailable).toBe(true);
    streams[0]!.handlers.onTranscript!("Late words", false);
    value.receive("one", pcm, 16000, 1);
    expect(streams[0]!.sendAudio).toHaveBeenCalledOnce();
    value.complete("one", "My final words.");
    expect(value.snapshot).toMatchObject({ text: "My final words.", final: true, unavailable: false });
  });
});
describe("caption audio uploads", () => {
  it("sends chunks in order and stops queued uploads on hang-up", async () => {
    let release!: (response: Response) => void;
    const fetch = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>(resolve => { release = resolve; })); vi.stubGlobal("fetch", fetch);
    const unavailable = vi.fn(), upload = new CaptionUpload("/api/demo/call", "turn:one", unavailable);
    upload.send(pcm, 16000); upload.send(pcm, 16000);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(String(fetch.mock.calls[0]![0])).toContain("sequence=0");
    release(Response.json({ accepted: true }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(String(fetch.mock.calls[1]![0])).toContain("sequence=1");
    upload.send(pcm, 16000); upload.close(); release(Response.json({ accepted: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fetch).toHaveBeenCalledTimes(2); expect(unavailable).not.toHaveBeenCalled();
  });
  it("bounds pending audio when the connection stalls", async () => {
    const fetch = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>(() => {})); vi.stubGlobal("fetch", fetch);
    const unavailable = vi.fn(), upload = new CaptionUpload("/api/call", "one", unavailable);
    upload.send(pcm, 16000); await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    for (let n = 0; n < 10; n++) upload.send(pcm, 16000);
    expect(unavailable).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
    expect((fetch.mock.calls[0]![1] as RequestInit).signal?.aborted).toBe(true);
  });
});
