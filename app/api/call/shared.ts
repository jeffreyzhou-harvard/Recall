/** Shared by the call routes. LIVE ONLY. */
import { HubError, type HubRefusal } from "@/lib/call/signaling";

const STATUS: Record<HubRefusal, number> = { unknown_room: 404, bad_token: 403, expired: 410, closed: 410, invalid_signal: 400 };

/** Plain words for the person holding the link; the code is for us. Never says why in a way that helps guess a token. */
export function refusal(e: unknown): Response {
  if (e instanceof HubError) return Response.json({ error: "This call link is not valid any more.", code: e.code }, { status: STATUS[e.code] });
  throw e;
}

export const tokenOf = (request: Request): string | null => new URL(request.url).searchParams.get("token");
export type RoomParams = { params: Promise<{ room: string }> };

/** Server-Sent Events: push `T`s down one long response until the client goes away. Shared by every live stream. */
export function eventStream<T>(request: Request, subscribe: (push: (event: T) => void, close: () => void) => () => void): Response {
  const encoder = new TextEncoder();
  let cleanup = (): void => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const write = (chunk: string): void => {
        if (open) controller.enqueue(encoder.encode(chunk));
      };
      const heartbeat = setInterval(() => write(": keep-alive\n\n"), 15_000);
      const unsubscribe = subscribe(
        (event) => write(`data: ${JSON.stringify(event)}\n\n`),
        () => cleanup(),
      );
      cleanup = () => {
        if (!open) return;
        open = false;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };
      request.signal.addEventListener("abort", cleanup);
    },
    cancel: () => cleanup(),
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}
