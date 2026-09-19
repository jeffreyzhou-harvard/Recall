"use client";

/**
 * Her side of a video call. LIVE ONLY, and a scaffold: the real surface is designed later with the
 * Impeccable skill. Even so it already keeps the hard accessibility rules (AGENTS.md section 10):
 * one task, one large control, 24px+ text, plain words, no technical state, no countdowns, no red
 * errors. Someone may open this link for her; after that there is exactly one thing to tap.
 *
 * Relay's lines are said here, on her device, by the browser's own speech synthesis, and shown on
 * screen labeled as Relay (rule 2): a plainly synthetic system voice, never hers and never a family
 * member's. Nothing on this page ever speaks as her.
 */
import { use, useEffect, useRef, useState } from "react";
import { CONTROL_CHANNEL, pageMessageSchema } from "@/lib/call/control";
import { PeerSession, type CallState } from "@/lib/call/peer";
import { fetchCallConfig, openSignalChannel } from "@/lib/call/signaling-client";

/** What the screen says. Never "ICE", "failed", "reconnecting", or anything that reads as her doing something wrong. */
const WORDS: Record<CallState, string> = {
  waiting: "Getting ready…",
  connecting: "Connecting…",
  connected: "You're connected.",
  reconnecting: "One moment…",
  ended: "The call has ended. Thank you.",
  failed: "We couldn't connect just now. We'll try again later.",
};

/** Say Relay's line aloud at an unhurried pace. Resolves when it has finished, or after a generous wait if this device has no voice. */
function sayAloud(text: string): Promise<void> {
  return new Promise((resolve) => {
    const giveUp = setTimeout(resolve, 1500 + text.split(/\s+/).length * 450);
    const done = (): void => {
      clearTimeout(giveUp);
      resolve();
    };
    if (!("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.onend = done;
    utterance.onerror = done;
    window.speechSynthesis.speak(utterance);
  });
}

export default function ParticipantCall({ params }: { params: Promise<{ room: string }> }) {
  const { room } = use(params);
  const [state, setState] = useState<CallState | "ready" | "invalid">("ready");
  const [relayLine, setRelayLine] = useState<string | null>(null);
  const selfView = useRef<HTMLVideoElement>(null);
  const relayAudio = useRef<HTMLAudioElement>(null);
  const session = useRef<PeerSession | null>(null);
  const joining = useRef(false);

  useEffect(() => () => session.current?.hangUp(), []);

  async function join(): Promise<void> {
    // A double tap on a big button is the most natural thing in the world. It must never start a second
    // call: that would take the seat from the first and leave both stranded. So the first tap wins, at once.
    if (joining.current) return;
    joining.current = true;
    setState("waiting");
    const token = window.location.hash.slice(1);
    try {
      const config = await fetchCallConfig(room, token);
      // Camera if she allows it, voice either way: a call with no picture is still a call.
      const media = await navigator.mediaDevices
        .getUserMedia({ audio: true, video: true })
        .catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));
      if (selfView.current) selfView.current.srcObject = media;
      const peer = new PeerSession({ role: config.role, channel: openSignalChannel(room, token), iceServers: config.ice_servers });
      peer.onRemoteStream((stream) => {
        if (relayAudio.current) relayAudio.current.srcObject = stream;
      });
      // The one thing the other side can ask of this page: say this line. Anything else is ignored.
      peer.pc.ondatachannel = ({ channel }) => {
        if (channel.label !== CONTROL_CHANNEL) return;
        channel.onmessage = (event) => {
          const message = pageMessageSchema.safeParse(JSON.parse(event.data as string));
          if (!message.success || message.data.type !== "say") return;
          const { prompt_id, text } = message.data;
          setRelayLine(text);
          void sayAloud(text).then(() => channel.readyState === "open" && channel.send(JSON.stringify({ type: "said", prompt_id })));
        };
      };
      peer.onState(setState);
      peer.addStream(media);
      session.current = peer;
      Object.assign(window, { __relayCall: peer }); // a handle for the e2e scripts to read connection state
    } catch {
      setState("invalid");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-10 px-6 py-12 text-center" data-call-state={state}>
      {state === "ready" ? (
        <>
          <h1 className="text-3xl font-semibold">Your family would like to talk with you.</h1>
          <button type="button" onClick={join} className="min-h-16 rounded-[18px] bg-ink px-10 py-5 text-2xl font-semibold text-paper">
            Join the call
          </button>
        </>
      ) : state === "invalid" ? (
        <p className="text-2xl">This call isn&apos;t available any more.</p>
      ) : (
        <>
          {relayLine && state === "connected" ? (
            <p className="text-3xl font-semibold" data-testid="relay-line">
              <span className="block text-2xl font-normal">Relay</span>
              {relayLine}
            </p>
          ) : (
            <p className="text-3xl font-semibold" role="status">
              {WORDS[state]}
            </p>
          )}
          <video ref={selfView} autoPlay playsInline muted className="w-full max-w-md rounded-[18px]" />
        </>
      )}
      <audio ref={relayAudio} autoPlay />
    </main>
  );
}
