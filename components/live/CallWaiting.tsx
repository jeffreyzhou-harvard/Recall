"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Phone, PhoneOff } from "lucide-react";
import { RecallFrame, RecallHeader } from "@/components/recall/RecallFrame";
import { api } from "@/client/api";
import { Microphone } from "@/client/microphone";
import { CaptionUpload } from "@/client/call-captions";
import type { CallCaption } from "@/server/call-captions";
import { AccessGate } from "./AccessGate";
import type { WebCommand, WebCallPhoto } from "@/server/web-call";
import { CallPhotographs } from "./CallPhotographs";
export function CallWaiting({ demo = false }: { demo?: boolean }) { return <RecallFrame><main className="recall-phone recall-call-shell"><RecallHeader /><AccessGate patient><WebCallView demo={demo} /></AccessGate></main></RecallFrame>; }
function WebCallView({ demo }: { demo: boolean }) {
  const apiBase = demo ? "/api/demo/call" : "/api/call";
  const [caller, setCaller] = useState("Recall");
  const [topic, setTopic] = useState<string | null>(null);
  const [photos, setPhotos] = useState<WebCallPhoto[]>([]);
  const [caption, setCaption] = useState<CallCaption | null>(null), [captionUnavailable, setCaptionUnavailable] = useState(false);
  const captionUpload = useRef<CaptionUpload | null>(null);
  const [command, setCommand] = useState<WebCommand | null>(null), [active, setActive] = useState(false), [message, setMessage] = useState("Checking for a call…"), [error, setError] = useState(""), [answering, setAnswering] = useState(false);
  const mic = useRef<Microphone | null>(null), handled = useRef(""), current = useRef<WebCommand | null>(null), mounted = useRef(true);
  const generation = useRef(0), stoppedLocally = useRef(false);
  const [starting, setStarting] = useState(false);
  async function startDemo() {
    if (starting) return;
    setStarting(true); setError(""); stoppedLocally.current = false;
    try { await api(`${apiBase}/start`, { method: "POST" }); setMessage("Opening your sample call…"); }
    catch (e) { setError(e instanceof Error ? e.message : "The sample call could not start."); }
    finally { setStarting(false); }
  }
  async function action(kind: string, step = "") { await api(`${apiBase}/action?action=${kind}&step=${encodeURIComponent(step)}`, { method: "POST" }); }
  async function sendAudio(step: string, bytes: Uint8Array, stop = false) {
    const send = async () => { const response = await fetch(`${apiBase}/action?action=audio&step=${encodeURIComponent(step)}${stop ? "&stop=true" : ""}`, { method: "POST", body: new Uint8Array(bytes), headers: { "Content-Type": "audio/wav" }, credentials: "same-origin" }); if (!response.ok) throw new Error("The recording could not be sent. Your call has ended."); };
    await send();
  }
  const fail = (e: unknown) => { generation.current++; stoppedLocally.current = true; current.current = null; captionUpload.current?.close(); mic.current?.close(); mic.current = null; if (mounted.current) { setCaption(null); setPhotos([]); setCommand(null); setAnswering(false); setMessage("Your call has ended."); setError(e instanceof Error ? e.message : "The call could not continue."); setActive(false); } void action("stop").catch(() => undefined); };
  useEffect(() => {
    mounted.current = true; let cancelled = false, timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const state = await api<{ status: string; message: string; command: WebCommand | null; topic: string | null; photos?: WebCallPhoto[]; caption?: CallCaption | null; display_name?: string; preparing?: boolean }>(`${apiBase}/status`);
        if (cancelled) return;
        // An in-flight poll must never put a locally ended call back on screen.
        if (stoppedLocally.current && state.status === "active") return;
        if (state.status !== "active") stoppedLocally.current = false;
        if (demo) setStarting(!!state.preparing);
        setCaller(state.display_name || "Recall"); setTopic(state.topic); current.current = state.command; setCommand(state.command); setMessage(state.message); setActive(state.status === "active");
        setPhotos(state.status === "active" && state.command?.kind !== "incoming" ? state.photos ?? [] : []);
        setCaption(state.status === "active" ? state.caption ?? null : null);
        if (state.status !== "active") { captionUpload.current?.close(); mic.current?.close(); mic.current = null; handled.current = ""; }
      } catch { if (!cancelled) fail(new Error("Connection lost. Your microphone is off.")); }
      finally { if (!cancelled) timer = setTimeout(() => void poll(), 500); }
    }
    void poll();
    const leave = () => { generation.current++; stoppedLocally.current = true; captionUpload.current?.close(); mic.current?.close(); void fetch(`${apiBase}/action?action=stop`, { method: "POST", keepalive: true }); };
    window.addEventListener("pagehide", leave);
    return () => { cancelled = true; mounted.current = false; generation.current++; clearTimeout(timer); window.removeEventListener("pagehide", leave); if (mic.current) leave(); };
    // One polling loop; command execution lives in the effect below.
  }, [apiBase]);
  useEffect(() => {
    if (!command || command.kind === "incoming" || handled.current === command.id || !mic.current) return;
    const callGeneration = generation.current, microphone = mic.current;
    const stillCurrent = () => mounted.current && !stoppedLocally.current && generation.current === callGeneration && mic.current === microphone;
    handled.current = command.id;
    if (command.kind === "listen") {
      captionUpload.current?.close(); setCaptionUnavailable(false);
      const upload = new CaptionUpload(apiBase, command.id, () => { if (stillCurrent() && current.current?.id === command.id) setCaptionUnavailable(true); });
      captionUpload.current = upload;
      microphone.listen((bytes) => { upload.close(); if (stillCurrent()) void sendAudio(command.id, bytes).catch((e) => { if (stillCurrent()) fail(e); }); }, (pcm, rate) => { if (stillCurrent()) upload.send(pcm, rate); });
      return;
    }
    captionUpload.current?.close();
    void (async () => {
      const response = await fetch(`${apiBase}/audio?step=${encodeURIComponent(command.id)}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("The audio could not be played.");
      const bytes = await response.arrayBuffer();
      if (!stillCurrent()) return;
      await microphone.play(bytes, command.kind === "speak" ? command.pace : "standard");
      if (stillCurrent()) await action("ack", command.id);
    })().catch((e) => { if (stillCurrent()) fail(e); });
  }, [command]);
  async function answer() {
    if (!command || answering) return; setAnswering(true); setError("");
    const callGeneration = generation.current;
    try { const next = new Microphone(); mic.current = next; await next.open(); if (!mounted.current || stoppedLocally.current || generation.current !== callGeneration || mic.current !== next) { next.close(); return; } await action("ack", command.id); }
    catch (e) { if (mounted.current && generation.current === callGeneration) fail(e); } finally { if (mounted.current && generation.current === callGeneration) setAnswering(false); }
  }
  async function stop() {
    generation.current++; stoppedLocally.current = true;
    captionUpload.current?.close();
    const step = current.current, audio = mic.current?.finish(); current.current = null; mic.current?.close(); mic.current = null; setCaption(null); setPhotos([]); setCommand(null); setAnswering(false); setActive(false); setMessage("Your call has ended.");
    try {
      if (audio && step?.kind === "listen") await sendAudio(step.id, audio, true);
      // Tell the server immediately, including while an already-submitted turn is transcribing.
      else await action("stop");
    } catch { await action("stop").catch(() => undefined); }
  }
  const incoming = command?.kind === "incoming";
  return <section className="recall-revisit recall-live-call" aria-label="Recall web call"><p>{demo ? "Susan’s sample call · Recall is an AI assistant" : "Recall · AI assistant"}</p>
    <div className="recall-call-content">
      {photos.length > 0 && <CallPhotographs photos={photos} />}
      <div className="recall-call-heading">{topic && !incoming && <p>{topic}</p>}<h1>{incoming ? `${caller} is calling.` : command?.kind === "listen" ? "I’m listening." : command?.kind === "playback" ? "Your own words." : command?.kind === "speak" ? command.text : message}</h1>
        {active && !incoming && (command?.kind === "listen" || caption?.text) && <section className="recall-call-caption" aria-label="Your live captions" aria-live="off">
          <p className="recall-call-caption-label">You · {caption?.final ? "Your words" : "Live captions"}</p>
          <p className="recall-call-caption-text">{caption?.text || "Your words will appear here as you speak."}</p>
          {(captionUnavailable || caption?.unavailable) && !caption?.final && <p className="recall-call-caption-note">Live captions are unavailable. Your call can continue; your words will appear after you finish speaking.</p>}
        </section>}
      </div>
    </div>
    <div className="recall-call-actions">
    {demo && !active && <button className="recall-button recall-primary" onClick={() => void startDemo()} disabled={starting}><Phone aria-hidden="true" />{starting ? "Opening a call…" : "Start demo call"}</button>}
    {incoming && <button className="recall-button recall-primary" onClick={() => void answer()} disabled={answering}><Phone aria-hidden="true" />{answering ? "Opening microphone…" : "Answer call"}</button>}
    {active && <button className="recall-button recall-secondary" onClick={() => void stop()}><PhoneOff aria-hidden="true" />End call</button>}
    {!active && <Link className="recall-button recall-secondary" href={demo ? "/" : "/revisit"}>{demo ? "Back to home" : "Back to photographs"}</Link>}
    </div>
    {!active && (demo ? <p>Your words are saved after you confirm. Choose to share them to add them to <Link href="/caregiver" target="_blank" rel="noopener">your sample family’s memories</Link>.</p> : <p>You can put your device down.</p>)}{error && <p role="alert">{error}</p>}
  </section>;
}
