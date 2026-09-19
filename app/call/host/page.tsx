"use client";

/**
 * Relay's end of a video call: the operator scaffold. LIVE ONLY, and not a design - the panes replace
 * it. WebRTC only exists in browsers, so this page IS Relay's media endpoint: it receives her audio
 * and video, streams her audio to the server for transcription, relays Relay's lines to her page, and
 * plays her own recording back to her when the session asks.
 *
 * Left open, it waits for a call: when a session is granted and places one, this page joins it. The
 * button is only a connection check - a call with no session behind it, where nothing is kept.
 */
import { useEffect, useRef, useState } from "react";
import { CONTROL_CHANNEL, commandSchema, pageMessageSchema, type CallAck } from "@/lib/call/control";
import { PeerSession, type CallState } from "@/lib/call/peer";
import { ParticipantRecorder } from "@/lib/call/recorder";
import { fetchCallConfig, openSignalChannel } from "@/lib/call/signaling-client";

interface Placed {
  room_id: string;
  relay_token: string;
  participant_path: string;
}

export default function HostCall() {
  const [state, setState] = useState<CallState | "idle">("idle");
  const [link, setLink] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [said, setSaid] = useState<string[]>([]);
  const [capturedMs, setCapturedMs] = useState(0);
  const herVideo = useRef<HTMLVideoElement>(null);
  const session = useRef<PeerSession | null>(null);
  const recorder = useRef<ParticipantRecorder | null>(null);
  const busy = useRef(false);

  async function join(call: Placed, driven: boolean): Promise<void> {
    if (busy.current) return; // one call per page: a second click, or a second announcement, must not open a second one
    busy.current = true;
    setLink(new URL(call.participant_path, window.location.origin).toString());
    const api = (leaf: string): string => `/api/call/${call.room_id}/${leaf}?token=${encodeURIComponent(call.relay_token)}`;
    const ack = (body: CallAck): void => void (driven && fetch(api("control"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

    const config = await fetchCallConfig(call.room_id, call.relay_token);
    const peer = new PeerSession({ role: config.role, channel: openSignalChannel(call.room_id, call.relay_token), iceServers: config.ice_servers });
    // Relay has a voice and no face: one audio line both ways, video only ever received.
    const audio = peer.addTransceiver("audio", "sendrecv");
    peer.addTransceiver("video", "recvonly");
    const control = peer.pc.createDataChannel(CONTROL_CHANNEL);

    // Her audio goes to the server in order, a fifth of a second at a time. The transcription key lives there, never here.
    let pending: Int16Array[] = [];
    let sending: Promise<unknown> = Promise.resolve();
    const flush = setInterval(() => {
      if (!driven || pending.length === 0) return;
      const bytes = new Uint8Array(pending.reduce((n, c) => n + c.byteLength, 0));
      let at = 0;
      for (const chunk of pending) {
        bytes.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), at);
        at += chunk.byteLength;
      }
      pending = [];
      sending = sending.then(() => fetch(api("audio"), { method: "POST", body: bytes })).catch(() => undefined);
    }, 200);

    peer.onRemoteStream((stream) => {
      if (herVideo.current) herVideo.current.srcObject = stream;
      if (recorder.current || stream.getAudioTracks().length === 0) return;
      const r = (recorder.current = new ParticipantRecorder());
      void r
        .start(stream, (pcm) => pending.push(pcm))
        .then(() => audio.sender.replaceTrack(r.outgoingTrack()))
        .catch((e: unknown) => setNote(`could not capture audio: ${String(e)}`));
    });

    const end = async (): Promise<void> => {
      clearInterval(flush);
      peer.hangUp();
      // This page approves nothing: the session on the server decides what is kept. Here, everything is dropped.
      await recorder.current?.finish(null).catch(() => null);
      recorder.current = null;
    };

    if (driven) {
      const pendingSays = new Map<string, () => void>();
      control.onmessage = (event) => {
        const message = pageMessageSchema.safeParse(JSON.parse(event.data as string));
        if (message.success && message.data.type === "said") pendingSays.get(message.data.prompt_id)?.();
      };
      const whenOpen = new Promise<void>((resolve) => (control.readyState === "open" ? resolve() : (control.onopen = () => resolve())));
      const commands = new EventSource(api("control"));
      commands.onmessage = async (event) => {
        const command = commandSchema.safeParse(JSON.parse(event.data as string));
        if (!command.success) return;
        const c = command.data;
        if (c.type === "say") {
          await whenOpen;
          const heard = new Promise<void>((resolve) => pendingSays.set(c.prompt_id, resolve));
          control.send(JSON.stringify(c));
          setSaid((lines) => [...lines, c.text]);
          await heard;
          ack({ type: "said", prompt_id: c.prompt_id });
        } else if (c.type === "playback") {
          await recorder.current?.play(c.spans);
          ack({ type: "played", playback_id: c.playback_id });
        } else {
          commands.close();
          await end();
        }
      };
    }

    peer.onState((next) => {
      setState(next);
      if (next === "connected") ack({ type: "connected" });
      if (next === "ended" || next === "failed") ack({ type: "ended" });
    });
    session.current = peer;
    Object.assign(window, { __relayCall: peer, __relayHangUp: end }); // handles for the e2e scripts
  }

  useEffect(() => {
    const tick = setInterval(() => setCapturedMs(recorder.current?.elapsedMs ?? 0), 500);
    const operator = new URLSearchParams(window.location.search).get("operator") ?? "";
    const calls = new EventSource(`/api/live/calls${operator ? `?operator=${encodeURIComponent(operator)}` : ""}`);
    calls.onmessage = (event) => void join(JSON.parse(event.data as string) as Placed, true);
    return () => {
      clearInterval(tick);
      calls.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function check(): Promise<void> {
    const operator = new URLSearchParams(window.location.search).get("operator") ?? "";
    const res = await fetch("/api/call/rooms", { method: "POST", headers: operator ? { "x-relay-operator": operator } : {} });
    if (!res.ok) return setNote("Not allowed to start a call. In production, open this page with ?operator=<RELAY_OPERATOR_SECRET>.");
    await join((await res.json()) as Placed, false);
  }

  async function hangUp(): Promise<void> {
    await (window as unknown as { __relayHangUp?: () => Promise<void> }).__relayHangUp?.();
    setNote("Call ended. Nothing was approved on this page, so nothing was kept here (0 bytes).");
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12" data-call-state={state}>
      <h1 className="text-2xl font-semibold">Relay&apos;s end of the call</h1>
      <p className="mt-2">Scaffold, not the demo. Leave this open: when a session places a call, it joins here.</p>

      {state === "idle" && (
        <>
          <p className="mt-6" data-testid="waiting">Waiting for a call…</p>
          <button type="button" onClick={check} className="mt-4 min-h-11 rounded-[18px] border-2 border-ink px-6 py-3">
            Connection check (no session)
          </button>
        </>
      )}
      {link && (
        <p className="mt-6 break-all">
          Her link (works once): <a className="underline" href={link} data-testid="participant-link">{link}</a>
        </p>
      )}
      {state !== "idle" && (
        <>
          <p className="mt-6 font-mono text-sm">
            state: {state} · her audio held in memory: {(capturedMs / 1000).toFixed(1)}s · video is never recorded
          </p>
          <video ref={herVideo} autoPlay playsInline className="mt-4 w-full rounded-[18px] bg-sage" />
          {said.length > 0 && (
            <ol className="mt-4 list-decimal pl-6" data-testid="relay-said">
              {said.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ol>
          )}
          {state !== "ended" && (
            <button type="button" onClick={hangUp} className="mt-4 min-h-11 rounded-[18px] border-2 border-ink px-6 py-3">
              Hang up
            </button>
          )}
        </>
      )}
      {note && <p className="mt-6">{note}</p>}
    </main>
  );
}
