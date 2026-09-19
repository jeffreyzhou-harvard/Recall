/**
 * ICE servers: how two browsers find a route to each other.
 *
 *   STUN  tells a browser its public address. Enough on most home networks.
 *   TURN  relays the media when no direct route exists. Campus, hotel, and
 *         conference wifi often need it - a hackathon venue very likely does.
 *
 * Configured with RELAY_ICE_SERVERS and handed out only to someone holding a
 * valid call token, so TURN credentials are never baked into the page. With
 * nothing configured it falls back to one public STUN server: fine for a home
 * network or two tabs on one laptop, not something to rely on at a venue.
 */
import { z } from "zod";

const iceServerSchema = z.strictObject({
  urls: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  username: z.string().optional(),
  credential: z.string().optional(),
});
export type IceServer = z.infer<typeof iceServerSchema>;

export const DEFAULT_ICE_SERVERS: IceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export function iceServersFrom(json: string | undefined): IceServer[] {
  if (!json || json.trim() === "") return DEFAULT_ICE_SERVERS;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("RELAY_ICE_SERVERS is not valid JSON");
  }
  const parsed = z.array(iceServerSchema).min(1).safeParse(raw);
  if (!parsed.success) throw new Error(`RELAY_ICE_SERVERS is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  for (const server of parsed.data) {
    for (const url of [server.urls].flat()) {
      if (!/^(stun|stuns|turn|turns):/.test(url)) throw new Error(`RELAY_ICE_SERVERS: "${url}" is not a stun: or turn: URL`);
    }
  }
  return parsed.data;
}

export const hasTurn = (servers: readonly IceServer[]): boolean => servers.some((s) => [s.urls].flat().some((u) => /^turns?:/.test(u)));
