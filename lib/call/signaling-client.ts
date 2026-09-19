/**
 * Browser side of the signaling channel: Server-Sent Events down, POST up.
 * Plain HTTP on purpose - it runs on Next route handlers with no WebSocket
 * server and no dependency.
 *
 * LIVE ONLY. One of the two files under /lib allowed to touch the network
 * (a test enforces the list); nothing on the judged path imports it.
 */
import type { SignalChannel } from "./peer";
import type { CallRole, HubEvent, Signal } from "./signaling";

export interface CallConfig {
  role: CallRole;
  ice_servers: RTCIceServer[];
}

const path = (roomId: string, leaf: string, token: string): string => `/api/call/${encodeURIComponent(roomId)}/${leaf}?token=${encodeURIComponent(token)}`;

/** Who this link makes you, and which ICE servers to use. Refused unless the token is one of the room's two. */
export async function fetchCallConfig(roomId: string, token: string): Promise<CallConfig> {
  const res = await fetch(path(roomId, "config", token));
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "This call link is not valid.");
  return (await res.json()) as CallConfig;
}

export function openSignalChannel(roomId: string, token: string): SignalChannel {
  const handlers = { signal: [] as Array<(s: Signal) => void>, peer: [] as Array<(p: boolean) => void>, closed: [] as Array<() => void> };
  const events = new EventSource(path(roomId, "events", token));
  let open = true;

  events.onmessage = (message) => {
    const event = JSON.parse(message.data as string) as HubEvent;
    if (event.type === "signal") handlers.signal.forEach((h) => h(event.signal));
    else if (event.type === "peer") handlers.peer.forEach((h) => h(event.present));
    else close(true);
  };

  // Signals are sent one at a time, in order: an answer must not overtake the candidates before it.
  let queue: Promise<unknown> = Promise.resolve();
  const send = (signal: Signal): void => {
    if (!open) return;
    queue = queue.then(() => fetch(path(roomId, "signal", token), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(signal) })).catch(() => undefined);
  };

  function close(notify: boolean): void {
    if (!open) return;
    open = false;
    events.close();
    if (notify) handlers.closed.forEach((h) => h());
  }

  return {
    send,
    onSignal: (h) => void handlers.signal.push(h),
    onPeer: (h) => void handlers.peer.push(h),
    onClosed: (h) => void handlers.closed.push(h),
    close: () => close(false),
  };
}
