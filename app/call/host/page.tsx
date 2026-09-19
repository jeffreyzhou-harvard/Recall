"use client";

/**
 * Relay's side of a video call: an operator scaffold for checking the live path. LIVE ONLY, and
 * not a design - the panes replace it. It starts a room, shows her link, connects, and captures
 * her audio under rule 8: hanging up here approves nothing, so everything captured is dropped.
 */
import { useEffect, useRef, useState } from "react";
import { PeerSession, type CallState } from "@/lib/call/peer";
import { ParticipantRecorder } from "@/lib/call/recorder";
import { fetchCallConfig, openSignalChannel } from "@/lib/call/signaling-client";

export default function HostCall() {
  const [state, setState] = useState<CallState | "idle">("idle");
  const [link, setLink] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [capturedMs, setCapturedMs] = useState(0);
  const herVideo = useRef<HTMLVideoElement>(null);
  const session = useRef<PeerSession | null>(null);
  const recorder = useRef<ParticipantRecorder | null>(null);
  const starting = useRef(false);

  useEffect(() => {
    const tick = setInterval(() => setCapturedMs(recorder.current?.elapsedMs ?? 0), 500);
    return () => clearInterval(tick);
  }, []);

  async function start(): Promise<void> {
    if (starting.current) return; // one call per page: a second click must not open a second room
    starting.current = true;
    const secret = new URLSearchParams(window.location.search).get("operator") ?? "";
    const res = await fetch("/api/call/rooms", { method: "POST", headers: secret ? { "x-relay-operator": secret } : {} });
    if (!res.ok) return setNote("Not allowed to start a call. In production, open this page with ?operator=<RELAY_OPERATOR_SECRET>.");
    const room = (await res.json()) as { room_id: string; relay_token: string; participant_path: string };
    setLink(new URL(room.participant_path, window.location.origin).toString());

    const config = await fetchCallConfig(room.room_id, room.relay_token);
    const peer = new PeerSession({ role: config.role, channel: openSignalChannel(room.room_id, room.relay_token), iceServers: config.ice_servers });
    // Relay has a voice and no face: it can send audio (its own, labeled voice - attached later by
    // replacing this sender's track) and only ever receives video.
    peer.addTransceiver("audio", "sendrecv");
    peer.addTransceiver("video", "recvonly");
    peer.onRemoteStream((stream) => {
      if (herVideo.current) herVideo.current.srcObject = stream;
      if (!recorder.current && stream.getAudioTracks().length > 0) {
        recorder.current = new ParticipantRecorder();
        void recorder.current.start(stream).catch((e: unknown) => setNote(`could not capture audio: ${String(e)}`));
      }
    });
    peer.onState(setState);
    session.current = peer;
    Object.assign(window, { __relayCall: peer }); // a handle for scripts/e2e-call.mjs to read connection state
  }

  async function hangUp(): Promise<void> {
    session.current?.hangUp();
    const kept = await recorder.current?.finish(null);
    recorder.current = null;
    setNote(`Call ended. Nothing was approved, so nothing was kept (${kept ? kept.wav.byteLength : 0} bytes).`);
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12" data-call-state={state}>
      <h1 className="text-2xl font-semibold">Video call check</h1>
      <p className="mt-2">Scaffold, not the demo. Relay&apos;s side of a live WebRTC call.</p>

      {state === "idle" && (
        <button type="button" onClick={start} className="mt-6 min-h-11 rounded-[18px] bg-ink px-6 py-3 text-paper">
          Start a call
        </button>
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
