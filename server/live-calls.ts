/**
 * Live calls in this server process. LIVE ONLY.
 *
 * When a session is granted and places a call, the call is announced here.
 * Relay's call page (the web app, open on the operator's machine) is listening,
 * joins as Relay's media endpoint, and shows her one-time link.
 */
import { LiveCall } from "@/lib/call/live-call";
import type { RoomTicket } from "@/lib/call/signaling";
import type { AssetIndex } from "@/lib/provenance/assets";
import { DeepgramLive, requireDeepgramKey, type HeardTurn } from "@/lib/providers/deepgram";
import { callHub } from "./call-rooms";

export interface Announcement {
  room_id: string;
  relay_token: string;
  participant_path: string;
}

interface Registry {
  calls: Map<string, LiveCall>;
  waiting: Announcement[];
  listeners: Set<(a: Announcement) => void>;
}
const cache = globalThis as unknown as { __relayLiveCalls?: Registry };
const registry = (): Registry => (cache.__relayLiveCalls ??= { calls: new Map(), waiting: [], listeners: new Set() });

export const liveCall = (roomId: string): LiveCall | null => registry().calls.get(roomId) ?? null;

/** Place a call: open a room, start listening for her audio, and announce it to Relay's call page. */
export function placeCall(assets: AssetIndex, keyterms: string[]): LiveCall {
  const key = requireDeepgramKey(process.env.DEEPGRAM_API_KEY);
  const ticket: RoomTicket = callHub().createRoom();
  const debug = process.env.RELAY_CALL_DEBUG ? callDebugger(ticket.room_id) : null;
  const call = new LiveCall({
    room_id: ticket.room_id,
    assets,
    startTranscriber: (onTurn, onSpeechStarted) => {
      const live = new DeepgramLive(key, { keyterms }, { onTurn: (turn) => (debug?.turn(turn), onTurn(turn)), onSpeechStarted, onError: (e) => console.error(`[call ${ticket.room_id}]`, e.message) });
      return debug ? { sendAudio: (bytes) => (debug.audio(bytes), live.sendAudio(bytes)), end: () => live.end() } : live;
    },
  });
  const r = registry();
  r.calls.set(ticket.room_id, call);
  const announcement: Announcement = { room_id: ticket.room_id, relay_token: ticket.tokens.relay, participant_path: `/call/${ticket.room_id}#${ticket.tokens.participant}` };
  if (r.listeners.size > 0) for (const listener of r.listeners) listener(announcement);
  else r.waiting.push(announcement); // no call page open yet: it gets the announcement when it connects
  return call;
}

/**
 * RELAY_CALL_DEBUG=1: what reached the server, second by second - how loud, and when a turn was heard.
 * Timings and counts only. Her words are never written to a log, debug or not (rule 8).
 */
function callDebugger(roomId: string): { audio(bytes: Uint8Array): void; turn(turn: HeardTurn): void } {
  let samples = 0;
  let peak = 0;
  return {
    audio(bytes) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength - (bytes.byteLength % 2));
      for (let i = 0; i < view.byteLength; i += 2) {
        peak = Math.max(peak, Math.abs(view.getInt16(i, true)));
        if (++samples % 16_000 === 0) {
          console.log(`[call ${roomId}] ${samples / 16_000}s peak ${peak}`);
          peak = 0;
        }
      }
    },
    turn: (turn) => console.log(`[call ${roomId}] heard ${turn.words.length} words, ${turn.start_ms}-${turn.end_ms}ms`),
  };
}

/** Relay's call page subscribes here. A call placed before the page opened is delivered straight away. */
export function onCallPlaced(listener: (a: Announcement) => void): () => void {
  const r = registry();
  r.listeners.add(listener);
  for (const a of r.waiting.splice(0)) listener(a);
  return () => void r.listeners.delete(listener);
}

export function forgetCall(roomId: string): void {
  registry().calls.delete(roomId);
  callHub().close(roomId);
}
