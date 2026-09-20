"use client";
import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

/** Local, nonverbal sound only; mounted for the unanswered incoming command. */
export function IncomingRingtone() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const ring = audio.current;
    if (!ring) return;
    let cancelled = false;
    ring.volume = 0.35;
    // Browsers that block autoplay expose the same explicit play control below.
    void ring.play().catch(() => { if (!cancelled) setPlaying(false); });
    const stop = () => { ring.pause(); ring.currentTime = 0; };
    window.addEventListener("pagehide", stop);
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", stop);
      stop();
    };
  }, []);

  function toggle() {
    const ring = audio.current;
    if (!ring) return;
    if (ring.paused) void ring.play().catch(() => setPlaying(false));
    else { ring.pause(); ring.currentTime = 0; }
  }

  return <>
    <audio ref={audio} src="/audio/incoming-call.wav" loop preload="auto" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
    <button className="recall-button recall-secondary" onClick={toggle}>
      {playing ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
      {playing ? "Silence ring" : "Play ringtone"}
    </button>
  </>;
}
