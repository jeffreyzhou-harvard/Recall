/**
 * The one signaling hub for this server process. LIVE ONLY.
 *
 * Randomness and the wall clock live here, outside /lib: the hub takes them
 * as injected functions so it stays deterministic and testable.
 *
 * Rooms are held in memory, so this works on a long-running Node server
 * (`next dev`, `next start`, a VM, a container). It does NOT work on
 * serverless hosting, where each request may land on a different instance
 * that has never heard of the room. Putting rooms in a shared store is the
 * change to make if this is ever deployed that way.
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
import { iceServersFrom, type IceServer } from "@/lib/call/ice";
import { SignalingHub } from "@/lib/call/signaling";

// Survive Next's dev-mode module reloads: a reload must not orphan a call in progress.
const cache = globalThis as unknown as { __relayCallHub?: SignalingHub };

export function callHub(): SignalingHub {
  cache.__relayCallHub ??= new SignalingHub(() => randomUUID(), { now: () => Date.now() });
  return cache.__relayCallHub;
}

export const iceServers = (): IceServer[] => iceServersFrom(process.env.RELAY_ICE_SERVERS);

/**
 * May this request start a call? A call is only ever placed by Relay, after the policy grants an
 * ask - never by a visitor. In production a shared secret is required; without one configured,
 * nobody can create a room (fail closed). In development it is open, for local testing.
 */
export function mayCreateRoom(request: Request): boolean {
  const secret = process.env.RELAY_OPERATOR_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const [a, b] = [Buffer.from(request.headers.get("x-relay-operator") ?? ""), Buffer.from(secret)];
  return a.length === b.length && timingSafeEqual(a, b);
}
