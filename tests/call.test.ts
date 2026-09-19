/**
 * The live video call (WebRTC). No browser here: signaling is pure, and the
 * negotiation logic runs against a fake RTCPeerConnection. A real two-browser
 * connection is checked separately, end to end, in headless Chrome.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ICE_SERVERS, hasTurn, iceServersFrom } from "@/lib/call/ice";
import { PeerSession, type CallState, type SignalChannel } from "@/lib/call/peer";
import { ParticipantRecorder } from "@/lib/call/recorder";
import { HubError, SignalingHub, type HubEvent, type Signal } from "@/lib/call/signaling";
import { cutWav, encodeWavPcm16, floatToPcm16 } from "@/lib/provenance/wav";

const OFFER: Signal = { kind: "description", description: { type: "offer", sdp: "v=0" } };
const CANDIDATE: Signal = { kind: "candidate", candidate: { candidate: "candidate:1 1 udp 1 10.0.0.1 9 typ host", sdpMid: "0", sdpMLineIndex: 0, usernameFragment: null } };

function hub(ttlMs?: number) {
  let n = 0;
  const clock = { t: 1_000, now: () => clock.t };
  return { hub: new SignalingHub(() => `id-${++n}`, clock, ttlMs), clock };
}
const inbox = (): { events: HubEvent[]; deliver: (e: HubEvent) => void } => {
  const events: HubEvent[] = [];
  return { events, deliver: (e) => void events.push(e) };
};

describe("signaling hub", () => {
  it("seats exactly two peers, each by their own token, and tells each when the other arrives", () => {
    const { hub: h } = hub();
    const room = h.createRoom();
    const [relay, her] = [inbox(), inbox()];
    expect(h.subscribe(room.room_id, room.tokens.relay, relay.deliver).role).toBe("relay");
    expect(relay.events).toEqual([]); // alone so far
    expect(h.subscribe(room.room_id, room.tokens.participant, her.deliver).role).toBe("participant");
    expect(relay.events).toEqual([{ type: "peer", present: true }]);
    expect(her.events).toEqual([{ type: "peer", present: true }]);
  });

  it("relays signals to the other peer only, in order, and keeps nothing", () => {
    const { hub: h } = hub();
    const room = h.createRoom();
    const [relay, her] = [inbox(), inbox()];
    h.subscribe(room.room_id, room.tokens.relay, relay.deliver);
    h.subscribe(room.room_id, room.tokens.participant, her.deliver);
    h.send(room.room_id, room.tokens.relay, OFFER);
    h.send(room.room_id, room.tokens.relay, CANDIDATE);
    expect(her.events.slice(1)).toEqual([{ type: "signal", signal: OFFER }, { type: "signal", signal: CANDIDATE }]);
    expect(relay.events.filter((e) => e.type === "signal")).toEqual([]); // never echoed back
  });

  it("holds signals for a peer who has not connected yet: candidates routinely arrive early", () => {
    const { hub: h } = hub();
    const room = h.createRoom();
    h.subscribe(room.room_id, room.tokens.relay, inbox().deliver);
    h.send(room.room_id, room.tokens.relay, OFFER);
    h.send(room.room_id, room.tokens.relay, CANDIDATE);
    const her = inbox();
    h.subscribe(room.room_id, room.tokens.participant, her.deliver);
    expect(her.events.filter((e) => e.type === "signal").map((e) => (e as { signal: Signal }).signal.kind)).toEqual(["description", "candidate"]);
  });

  it("cannot be joined by a third party, a guessed token, or an empty one", () => {
    const { hub: h } = hub();
    const room = h.createRoom();
    const other = h.createRoom();
    for (const token of ["guess", "", null, undefined, other.tokens.relay]) {
      expect(() => h.subscribe(room.room_id, token, () => {})).toThrow(HubError);
    }
    expect(() => h.subscribe("no-such-room", room.tokens.relay, () => {})).toThrow(/unknown_room/);
  });

  it("lets a browser reconnect into its own seat, without ever holding two listeners", () => {
    const { hub: h } = hub();
    const room = h.createRoom();
    const [first, second, relay] = [inbox(), inbox(), inbox()];
    h.subscribe(room.room_id, room.tokens.relay, relay.deliver);
    const old = h.subscribe(room.room_id, room.tokens.participant, first.deliver);
    h.subscribe(room.room_id, room.tokens.participant, second.deliver);
    old.unsubscribe(); // the stale connection closing must not unseat the new one
    h.send(room.room_id, room.tokens.relay, OFFER);
    expect(first.events.filter((e) => e.type === "signal")).toEqual([]);
    expect(second.events.filter((e) => e.type === "signal")).toHaveLength(1);
    expect(relay.events.filter((e) => e.type === "peer" && !e.present)).toEqual([]);
  });

  it("a call link works once: hanging up closes the room for good, for both sides", () => {
    const { hub: h } = hub();
    const room = h.createRoom();
    const [relay, her] = [inbox(), inbox()];
    h.subscribe(room.room_id, room.tokens.relay, relay.deliver);
    h.subscribe(room.room_id, room.tokens.participant, her.deliver);
    h.send(room.room_id, room.tokens.participant, { kind: "bye" });
    expect(relay.events.slice(-2)).toEqual([{ type: "signal", signal: { kind: "bye" } }, { type: "closed" }]);
    expect(her.events.at(-1)).toEqual({ type: "closed" });
    expect(() => h.subscribe(room.room_id, room.tokens.participant, () => {})).toThrow(/closed/);
    expect(() => h.send(room.room_id, room.tokens.relay, OFFER)).toThrow(/closed/);
    expect(h.openRooms).toBe(0);
  });

  it("expires", () => {
    const { hub: h, clock } = hub(60_000);
    const room = h.createRoom();
    clock.t += 60_001;
    expect(() => h.roleFor(room.room_id, room.tokens.relay)).toThrow(/expired/);
  });

  it("carries negotiation and nothing else: no extra fields, no free text, no oversized payloads", () => {
    const { hub: h } = hub();
    const room = h.createRoom();
    const send = (raw: unknown) => () => h.send(room.room_id, room.tokens.relay, raw);
    expect(send({ kind: "chat", text: "hello" })).toThrow(/invalid_signal/);
    expect(send({ ...OFFER, note: "smuggled" })).toThrow(/invalid_signal/);
    expect(send({ kind: "description", description: { type: "offer", sdp: "x".repeat(200_001) } })).toThrow(/invalid_signal/);
    expect(send({ kind: "candidate", candidate: null })).not.toThrow(); // end of candidates
  });
});

// --- perfect negotiation, against a fake RTCPeerConnection -------------------------------------------------

class FakePC {
  signalingState: RTCSignalingState = "stable";
  connectionState: RTCPeerConnectionState = "new";
  localDescription: { type: RTCSdpType; sdp: string } | null = null;
  remote: RTCSessionDescriptionInit[] = [];
  candidates = 0;
  onnegotiationneeded: (() => void) | null = null;
  onicecandidate: ((e: { candidate: null }) => void) | null = null;
  ontrack: unknown = null;
  onconnectionstatechange: (() => void) | null = null;
  constructor(readonly name: string) {}

  async setLocalDescription(): Promise<void> {
    await Promise.resolve();
    if (this.signalingState === "stable") {
      this.localDescription = { type: "offer", sdp: `offer-from-${this.name}` };
      this.signalingState = "have-local-offer";
    } else if (this.signalingState === "have-remote-offer") {
      this.localDescription = { type: "answer", sdp: `answer-from-${this.name}` };
      this.signalingState = "stable";
    } else throw new Error(`${this.name}: cannot setLocalDescription in ${this.signalingState}`);
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit): Promise<void> {
    await Promise.resolve();
    this.remote.push(d);
    if (d.type === "offer") this.signalingState = "have-remote-offer"; // includes the polite peer's implicit rollback
    else if (d.type === "answer" && this.signalingState === "have-local-offer") this.signalingState = "stable";
    else throw new Error(`${this.name}: unexpected ${d.type} in ${this.signalingState}`);
  }
  async addIceCandidate(): Promise<void> {
    this.candidates++;
  }
  addTrack(): void {}
  addTransceiver(): void {}
  close(): void {
    this.connectionState = "closed";
  }
  become(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

/** Two channels joined back to back, delivering asynchronously like a network. */
function linkedChannels(): [SignalChannel & { sent: Signal[] }, SignalChannel & { sent: Signal[] }] {
  const make = () => ({ sent: [] as Signal[], signal: [] as Array<(s: Signal) => void>, peer: [] as Array<(p: boolean) => void>, closed: [] as Array<() => void> });
  const [a, b] = [make(), make()];
  const channel = (me: ReturnType<typeof make>, them: ReturnType<typeof make>) => ({
    sent: me.sent,
    send: (s: Signal) => {
      me.sent.push(s);
      setTimeout(() => them.signal.forEach((h) => h(s)), 0);
    },
    onSignal: (h: (s: Signal) => void) => void me.signal.push(h),
    onPeer: (h: (p: boolean) => void) => void me.peer.push(h),
    onClosed: (h: () => void) => void me.closed.push(h),
    close: () => {},
  });
  return [channel(a, b), channel(b, a)];
}
const settle = () => new Promise((r) => setTimeout(r, 20));

describe("peer session", () => {
  const pair = () => {
    const [relayChannel, herChannel] = linkedChannels();
    const [relayPc, herPc] = [new FakePC("relay"), new FakePC("participant")];
    const relay = new PeerSession({ role: "relay", channel: relayChannel, iceServers: [], createConnection: () => relayPc as unknown as RTCPeerConnection });
    const her = new PeerSession({ role: "participant", channel: herChannel, iceServers: [], createConnection: () => herPc as unknown as RTCPeerConnection });
    return { relay, her, relayPc, herPc, relayChannel, herChannel };
  };

  it("negotiates: an offer is answered and both sides settle", async () => {
    const { relayPc, herPc } = pair();
    relayPc.onnegotiationneeded!();
    await settle();
    expect([relayPc.signalingState, herPc.signalingState]).toEqual(["stable", "stable"]);
    expect(herPc.remote.map((d) => d.sdp)).toEqual(["offer-from-relay"]);
    expect(relayPc.remote.map((d) => d.sdp)).toEqual(["answer-from-participant"]);
  });

  it("survives glare: when both offer at once, she yields, Relay's offer stands, and nobody deadlocks", async () => {
    const { relayPc, herPc } = pair();
    relayPc.onnegotiationneeded!();
    herPc.onnegotiationneeded!();
    await settle();
    expect([relayPc.signalingState, herPc.signalingState]).toEqual(["stable", "stable"]);
    expect(relayPc.remote.map((d) => d.type)).toEqual(["answer"]); // the impolite peer ignored her colliding offer
    expect(herPc.remote.map((d) => d.sdp)).toEqual(["offer-from-relay"]); // the polite peer rolled back and accepted
  });

  it("speaks in a small, plain set of states", async () => {
    const { her, herPc } = pair();
    const seen: CallState[] = [];
    her.onState((s) => seen.push(s));
    for (const s of ["connecting", "connected", "disconnected", "connected"] as const) herPc.become(s);
    expect(seen).toEqual(["waiting", "connecting", "connected", "reconnecting", "connected"]);
  });

  it("hanging up ends the call on both sides", async () => {
    const { relay, her, relayChannel } = pair();
    relay.hangUp();
    await settle();
    expect(relayChannel.sent.at(-1)).toEqual({ kind: "bye" });
    expect([relay.callState, her.callState]).toEqual(["ended", "ended"]);
  });
});

describe("ICE servers", () => {
  it("default to one public STUN server, and say plainly when there is no TURN", () => {
    expect(iceServersFrom(undefined)).toEqual(DEFAULT_ICE_SERVERS);
    expect(hasTurn(DEFAULT_ICE_SERVERS)).toBe(false);
    const turn = iceServersFrom('[{"urls":["stun:s.example:3478","turn:t.example:3478"],"username":"u","credential":"c"}]');
    expect(hasTurn(turn)).toBe(true);
  });

  it("reject anything that is not a stun: or turn: server", () => {
    expect(() => iceServersFrom('[{"urls":"https://evil.example"}]')).toThrow(/not a stun: or turn: URL/);
    expect(() => iceServersFrom("{oops")).toThrow(/not valid JSON/);
    expect(() => iceServersFrom('[{"urls":"stun:s.example","extra":1}]')).toThrow(/invalid/);
  });
});

describe("capturing her audio (rule 8)", () => {
  const SECOND = 16_000;
  /** One second of samples per value, so a span's contents say exactly which second it came from. */
  const filled = () => {
    const recorder = new ParticipantRecorder();
    (recorder as unknown as { chunks: Int16Array[] }).chunks = [1, 2, 3].map((v) => new Int16Array(SECOND).fill(v * 100));
    return recorder;
  };

  it("has no way to get the whole recording out: only `finish`, which takes the approved spans", () => {
    expect(Object.getOwnPropertyNames(ParticipantRecorder.prototype).sort()).toEqual(["constructor", "elapsedMs", "finish", "start"]);
  });

  it("returns only what she approved, and wipes the rest", async () => {
    const recorder = filled();
    const chunks = (recorder as unknown as { chunks: Int16Array[] }).chunks;
    expect(recorder.elapsedMs).toBe(3000);
    const kept = (await recorder.finish([{ start_ms: 1000, end_ms: 2000 }]))!;
    const samples = new Int16Array(kept.wav.buffer, 44);
    expect(samples).toHaveLength(SECOND);
    expect(new Set(samples)).toEqual(new Set([200])); // the middle second, and nothing else
    expect(kept.source_sha256).toMatch(/^[0-9a-f]{64}$/); // a commitment to audio it no longer holds
    expect(chunks.every((c) => c.every((s) => s === 0)), "captured audio is zeroed before it is released").toBe(true);
    await expect(recorder.finish(null)).rejects.toThrow(/already been finished/);
  });

  it("keeps nothing at all when she approved nothing", async () => {
    const recorder = filled();
    const chunks = (recorder as unknown as { chunks: Int16Array[] }).chunks;
    expect(await recorder.finish(null)).toBeNull();
    expect(chunks.every((c) => c.every((s) => s === 0))).toBe(true);
  });

  it("captures as PCM the edit-decision list can cut byte for byte, clamped and never scaled", () => {
    expect([...floatToPcm16(new Float32Array([0, 1, -1, 2, -2, 0.5]))]).toEqual([0, 32767, -32768, 32767, -32768, 16384]);
    const wav = encodeWavPcm16([new Int16Array([1, 2, 3, 4])], 1000);
    expect([...new Int16Array(cutWav(wav, [{ start_ms: 1, end_ms: 3 }])!.buffer, 44)]).toEqual([2, 3]);
  });
});

describe("call routes", () => {
  afterEach(() => vi.unstubAllEnvs());
  const post = (headers: Record<string, string> = {}) => new Request("http://relay.test/api/call/rooms", { method: "POST", headers });

  it("only Relay can start a call: in production it needs the operator secret, and with none set nobody can", async () => {
    const { POST } = await import("@/app/api/call/rooms/route");
    vi.stubEnv("NODE_ENV", "production");
    expect((await POST(post())).status).toBe(403); // no secret configured: fail closed
    vi.stubEnv("RELAY_OPERATOR_SECRET", "a-long-operator-secret");
    expect((await POST(post())).status).toBe(403);
    expect((await POST(post({ "x-relay-operator": "wrong-operator-secret!" }))).status).toBe(403);
    const ok = await POST(post({ "x-relay-operator": "a-long-operator-secret" }));
    expect(ok.status).toBe(200);
    const room = (await ok.json()) as { participant_path: string; relay_token: string };
    expect(room.participant_path).toMatch(/^\/call\/[0-9a-f-]{36}#[0-9a-f-]{36}$/); // her token is in the fragment: never sent to a server
  });

  it("hands ICE servers only to someone holding a token for that room", async () => {
    const { POST } = await import("@/app/api/call/rooms/route");
    const { GET } = await import("@/app/api/call/[room]/config/route");
    const room = (await (await POST(post())).json()) as { room_id: string; relay_token: string };
    const config = (token: string) => GET(new Request(`http://relay.test/api/call/${room.room_id}/config?token=${token}`), { params: Promise.resolve({ room: room.room_id }) });
    expect(await (await config(room.relay_token)).json()).toEqual({ role: "relay", ice_servers: DEFAULT_ICE_SERVERS });
    const refused = await config("guess");
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toBe("This call link is not valid any more.");
  });
});
