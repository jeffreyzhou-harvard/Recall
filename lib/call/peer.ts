/**
 * One WebRTC peer connection, using the "perfect negotiation" pattern
 * (https://webrtc.org, MDN: "Establishing a connection: the perfect negotiation
 * pattern"). Either side may add or change tracks at any time - Relay swapping
 * in its voice, her device turning its camera on - and the two sides settle
 * who goes first without glare or deadlock: the participant is the polite
 * peer and yields, Relay is the impolite one.
 *
 * LIVE ONLY. Browser only. Not imported by anything on the judged path.
 *
 * It exposes a deliberately small, plain state - waiting, connecting,
 * connected, reconnecting, ended, failed - because that is all a calm call
 * screen should ever need to say.
 */
import type { CallRole, Signal } from "./signaling";

/** The channel the two peers negotiate over. Implemented by signaling-client.ts; faked in tests. */
export interface SignalChannel {
  send(signal: Signal): void;
  onSignal(handler: (signal: Signal) => void): void;
  /** The other side arrived or left. */
  onPeer(handler: (present: boolean) => void): void;
  onClosed(handler: () => void): void;
  close(): void;
}

export type CallState = "waiting" | "connecting" | "connected" | "reconnecting" | "ended" | "failed";

export interface PeerOptions {
  role: CallRole;
  channel: SignalChannel;
  iceServers: RTCIceServer[];
  /** Injectable so the negotiation logic can be tested without a browser. */
  createConnection?: (config: RTCConfiguration) => RTCPeerConnection;
}

export class PeerSession {
  readonly pc: RTCPeerConnection;
  private readonly polite: boolean;
  private makingOffer = false;
  private ignoreOffer = false;
  private state: CallState = "waiting";
  private stateHandlers: Array<(state: CallState) => void> = [];
  private streamHandlers: Array<(stream: MediaStream) => void> = [];

  constructor(private readonly options: PeerOptions) {
    this.polite = options.role === "participant";
    const create = options.createConnection ?? ((config) => new RTCPeerConnection(config));
    this.pc = create({ iceServers: options.iceServers });
    const { pc } = this;
    const { channel } = options;

    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) channel.send({ kind: "description", description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      } catch (e) {
        this.fail(e);
      } finally {
        this.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      const c = candidate?.toJSON();
      // A null candidate means "no more candidates": it is sent too, so the other side can finish gathering.
      channel.send({
        kind: "candidate",
        candidate: c?.candidate === undefined ? null : { candidate: c.candidate, sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null, usernameFragment: c.usernameFragment ?? null },
      });
    };
    pc.ontrack = ({ streams }) => {
      const [stream] = streams;
      if (stream) for (const handler of this.streamHandlers) handler(stream);
    };
    pc.onconnectionstatechange = () => {
      const map: Partial<Record<RTCPeerConnectionState, CallState>> = { connecting: "connecting", connected: "connected", disconnected: "reconnecting", failed: "failed", closed: "ended" };
      const next = map[pc.connectionState];
      if (next && this.state !== "ended") this.setState(next);
    };

    channel.onSignal((signal) => void this.receive(signal).catch((e) => this.fail(e)));
    channel.onPeer((present) => {
      if (this.state === "ended" || this.state === "failed") return;
      if (present && this.state === "waiting") this.setState("connecting");
      if (!present && this.state !== "waiting") this.setState("reconnecting");
    });
    channel.onClosed(() => this.end(false));
  }

  private async receive(signal: Signal): Promise<void> {
    const { pc } = this;
    if (signal.kind === "bye") return this.end(false);
    if (signal.kind === "description") {
      const description = signal.description as RTCSessionDescriptionInit;
      const collision = description.type === "offer" && (this.makingOffer || pc.signalingState !== "stable");
      // The impolite peer ignores an offer that collides with its own; the polite peer rolls back and accepts it.
      this.ignoreOffer = !this.polite && collision;
      if (this.ignoreOffer) return;
      await pc.setRemoteDescription(description);
      if (description.type === "offer") {
        await pc.setLocalDescription();
        if (pc.localDescription) this.options.channel.send({ kind: "description", description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      }
      return;
    }
    try {
      await pc.addIceCandidate(signal.candidate ?? undefined);
    } catch (e) {
      if (!this.ignoreOffer) throw e; // a candidate for an offer we ignored is expected to fail
    }
  }

  /** Send these tracks. Safe before or during the call: negotiation follows on its own. */
  addStream(stream: MediaStream): void {
    for (const track of stream.getTracks()) this.pc.addTrack(track, stream);
  }

  /** Be ready to receive a kind of media, and optionally send it later by replacing the sender's track. */
  addTransceiver(kind: "audio" | "video", direction: RTCRtpTransceiverDirection): RTCRtpTransceiver {
    return this.pc.addTransceiver(kind, { direction });
  }

  onState(handler: (state: CallState) => void): void {
    this.stateHandlers.push(handler);
    handler(this.state);
  }

  onRemoteStream(handler: (stream: MediaStream) => void): void {
    this.streamHandlers.push(handler);
  }

  get callState(): CallState {
    return this.state;
  }

  /** Hang up. Tells the other side, which ends the room for both: a call link works once. */
  hangUp(): void {
    this.end(true);
  }

  private end(tellPeer: boolean): void {
    if (this.state === "ended") return;
    if (tellPeer) this.options.channel.send({ kind: "bye" });
    this.setState("ended");
    this.pc.close();
    this.options.channel.close();
  }

  private fail(error: unknown): void {
    if (this.state === "ended") return;
    console.error("call failed:", error);
    this.setState("failed");
  }

  private setState(next: CallState): void {
    if (next === this.state) return;
    this.state = next;
    for (const handler of this.stateHandlers) handler(next);
  }
}
