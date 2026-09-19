/**
 * WebRTC signaling: the small amount of out-of-band talk two browsers need
 * before they can connect to each other directly (https://webrtc.org). WebRTC
 * leaves this channel up to the application on purpose. This is ours.
 *
 * LIVE ONLY. The judged path plays a prerecorded call and never opens a room.
 *
 * A room is one call between exactly two peers:
 *
 *   relay        the Relay web app, which holds the session
 *   participant  her device
 *
 * The hub only relays signaling messages. Audio and video never pass through
 * it - once connected, media flows peer to peer - and it stores nothing: a
 * message is delivered or briefly queued, then gone. A room needs a token per
 * role, is single-use, and expires, so a call link cannot be reused or guessed.
 *
 * Pure and deterministic: ids and time are injected, so it lives under /lib
 * without touching randomness or the wall clock.
 */
import { z } from "zod";

export const CALL_ROLES = ["relay", "participant"] as const;
export type CallRole = (typeof CALL_ROLES)[number];
const other = (role: CallRole): CallRole => (role === "relay" ? "participant" : "relay");

/** Exactly what WebRTC needs exchanged, and nothing else. Strict: a peer cannot use the channel to send anything more. */
export const signalSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("description"),
    description: z.strictObject({ type: z.enum(["offer", "answer", "pranswer", "rollback"]), sdp: z.string().max(200_000).optional() }),
  }),
  z.strictObject({
    kind: z.literal("candidate"),
    candidate: z
      .strictObject({
        candidate: z.string().max(2_000),
        sdpMid: z.string().nullable().optional(),
        sdpMLineIndex: z.number().int().nullable().optional(),
        usernameFragment: z.string().nullable().optional(),
      })
      .nullable(),
  }),
  z.strictObject({ kind: z.literal("bye") }),
]);
export type Signal = z.infer<typeof signalSchema>;

export type HubEvent = { type: "signal"; signal: Signal } | { type: "peer"; present: boolean } | { type: "closed" };

export type HubRefusal = "unknown_room" | "bad_token" | "expired" | "closed" | "invalid_signal";

export class HubError extends Error {
  constructor(
    public readonly code: HubRefusal,
    detail: string,
  ) {
    super(`call refused (${code}): ${detail}`);
    this.name = "HubError";
  }
}

export interface RoomTicket {
  room_id: string;
  tokens: Record<CallRole, string>;
  expires_at: number;
}

interface Seat {
  token: string;
  deliver: ((event: HubEvent) => void) | null;
  /** Signals that arrived before this peer connected. ICE candidates routinely do. */
  queued: HubEvent[];
}

interface Room {
  seats: Record<CallRole, Seat>;
  expires_at: number;
  closed: boolean;
}

const MAX_QUEUED = 200;

export class SignalingHub {
  private readonly rooms = new Map<string, Room>();

  constructor(
    /** Unguessable ids. Injected: /lib never reaches for randomness itself. */
    private readonly newId: () => string,
    private readonly clock: { now(): number },
    private readonly ttlMs = 30 * 60_000,
  ) {}

  createRoom(): RoomTicket {
    this.sweep();
    const seat = (): Seat => ({ token: this.newId(), deliver: null, queued: [] });
    const room: Room = { seats: { relay: seat(), participant: seat() }, expires_at: this.clock.now() + this.ttlMs, closed: false };
    const room_id = this.newId();
    this.rooms.set(room_id, room);
    return { room_id, tokens: { relay: room.seats.relay.token, participant: room.seats.participant.token }, expires_at: room.expires_at };
  }

  /** Which seat a token is for. Throws unless the room exists, is open, is unexpired, and the token is one of its two. */
  roleFor(roomId: string, token: string | null | undefined): CallRole {
    const room = this.rooms.get(roomId);
    if (!room) throw new HubError("unknown_room", "no such call");
    if (room.closed) throw new HubError("closed", "this call has ended; a call link works once");
    if (room.expires_at <= this.clock.now()) throw new HubError("expired", "this call link has expired");
    const role = CALL_ROLES.find((r) => token !== null && token !== undefined && token.length > 0 && room.seats[r].token === token);
    if (!role) throw new HubError("bad_token", "that link is not for this call");
    return role;
  }

  /**
   * Take a seat and start receiving. A second connection with the same token replaces the first
   * (a browser reconnecting), so a seat never holds two listeners and a third party can never join.
   */
  subscribe(roomId: string, token: string | null | undefined, deliver: (event: HubEvent) => void): { role: CallRole; unsubscribe: () => void } {
    const role = this.roleFor(roomId, token);
    const room = this.rooms.get(roomId)!;
    const seat = room.seats[role];
    seat.deliver = deliver;
    for (const event of seat.queued.splice(0)) deliver(event);
    this.tell(room, other(role), { type: "peer", present: true });
    if (room.seats[other(role)].deliver) deliver({ type: "peer", present: true });
    return {
      role,
      unsubscribe: () => {
        if (seat.deliver !== deliver) return; // already replaced by a reconnect
        seat.deliver = null;
        if (!room.closed) this.tell(room, other(role), { type: "peer", present: false });
      },
    };
  }

  send(roomId: string, token: string | null | undefined, raw: unknown): void {
    const role = this.roleFor(roomId, token);
    const parsed = signalSchema.safeParse(raw);
    if (!parsed.success) throw new HubError("invalid_signal", parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "));
    const room = this.rooms.get(roomId)!;
    this.tell(room, other(role), { type: "signal", signal: parsed.data });
    if (parsed.data.kind === "bye") this.close(roomId);
  }

  /** End the call for both sides. The room cannot be reopened: a call link works once. */
  close(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room || room.closed) return;
    room.closed = true;
    for (const role of CALL_ROLES) {
      room.seats[role].deliver?.({ type: "closed" });
      room.seats[role].deliver = null;
      room.seats[role].queued = [];
    }
  }

  private tell(room: Room, role: CallRole, event: HubEvent): void {
    const seat = room.seats[role];
    if (seat.deliver) seat.deliver(event);
    else if (event.type === "signal" && seat.queued.length < MAX_QUEUED) seat.queued.push(event);
  }

  private sweep(): void {
    const now = this.clock.now();
    for (const [id, room] of this.rooms) if (room.closed || room.expires_at <= now) this.rooms.delete(id);
  }

  get openRooms(): number {
    return [...this.rooms.values()].filter((r) => !r.closed).length;
  }
}
