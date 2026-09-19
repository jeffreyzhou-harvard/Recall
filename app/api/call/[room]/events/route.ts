/** Signaling messages down, as Server-Sent Events. Carries negotiation only; audio and video never pass through here. */
import type { HubEvent } from "@/lib/call/signaling";
import { callHub } from "@/server/call-rooms";
import { refusal, tokenOf, type RoomParams } from "../../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: RoomParams): Promise<Response> {
  const { room } = await params;
  const token = tokenOf(request);
  try {
    callHub().roleFor(room, token); // refuse with a proper status before opening a stream
  } catch (e) {
    return refusal(e);
  }

  const encoder = new TextEncoder();
  let cleanup = (): void => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const write = (chunk: string): void => {
        if (open) controller.enqueue(encoder.encode(chunk));
      };
      const seat = callHub().subscribe(room, token, (event: HubEvent) => {
        write(`data: ${JSON.stringify(event)}\n\n`);
        if (event.type === "closed") cleanup();
      });
      const heartbeat = setInterval(() => write(": keep-alive\n\n"), 15_000);
      cleanup = () => {
        if (!open) return;
        open = false;
        clearInterval(heartbeat);
        seat.unsubscribe();
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
