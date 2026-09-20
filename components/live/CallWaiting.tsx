"use client";
import { useEffect, useRef, useState } from "react";
import { Phone, PhoneOff } from "lucide-react";
import { RecallFrame, RecallHeader } from "@/components/recall/RecallFrame";
import { api } from "@/client/api";
import { Microphone } from "@/client/microphone";
import { AccessGate } from "./AccessGate";
import type { WebCommand } from "@/server/web-call";
export function CallWaiting() { return <RecallFrame><main className="recall-phone"><RecallHeader /><AccessGate patient><WebCallView /></AccessGate></main></RecallFrame>; }
function WebCallView() {
  const [caller, setCaller] = useState("Recall");
  const [topic, setTopic] = useState<string | null>(null);
  const [command, setCommand] = useState<WebCommand | null>(null), [active, setActive] = useState(false), [message, setMessage] = useState("Checking for a call…"), [error, setError] = useState(""), [answering, setAnswering] = useState(false);
  const mic = useRef<Microphone | null>(null), handled = useRef(""), current = useRef<WebCommand | null>(null), mounted = useRef(true), sending = useRef<Promise<void> | null>(null);
  async function action(kind: string, step = "") { await api(`/api/call/action?action=${kind}&step=${encodeURIComponent(step)}`, { method: "POST" }); }
  async function sendAudio(step: string, bytes: Uint8Array, stop = false) {
    const send = async () => { const response = await fetch(`/api/call/action?action=audio&step=${encodeURIComponent(step)}${stop ? "&stop=true" : ""}`, { method: "POST", body: new Uint8Array(bytes), headers: { "Content-Type": "audio/wav" }, credentials: "same-origin" }); if (!response.ok) throw new Error("The recording could not be sent. Your call has ended."); };
    const task = send(); sending.current = task; try { await task; } finally { if (sending.current === task) sending.current = null; }
  }
  const fail = (e: unknown) => { mic.current?.close(); mic.current = null; if (mounted.current) { setError(e instanceof Error ? e.message : "The call could not continue."); setActive(false); } void action("stop").catch(() => undefined); };
  useEffect(() => {
    mounted.current = true; let cancelled = false, timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const state = await api<{ status: string; message: string; command: WebCommand | null; topic: string | null; display_name?: string }>("/api/call/status");
        if (cancelled) return;
        setCaller(state.display_name || "Recall"); setTopic(state.topic); current.current = state.command; setCommand(state.command); setMessage(state.message); setActive(state.status === "active");
        if (state.status !== "active") { mic.current?.close(); mic.current = null; handled.current = ""; }
      } catch { if (!cancelled) fail(new Error("Connection lost. Your microphone is off.")); }
      if (!cancelled) timer = setTimeout(() => void poll(), 500);
    }
    void poll();
    const leave = () => { mic.current?.close(); void fetch("/api/call/action?action=stop", { method: "POST", keepalive: true }); };
    window.addEventListener("pagehide", leave);
    return () => { cancelled = true; mounted.current = false; clearTimeout(timer); window.removeEventListener("pagehide", leave); if (mic.current) leave(); };
    // One polling loop; command execution lives in the effect below.
  }, []);
  useEffect(() => {
    if (!command || command.kind === "incoming" || handled.current === command.id || !mic.current) return;
    handled.current = command.id;
    if (command.kind === "listen") { mic.current.listen((bytes) => { void sendAudio(command.id, bytes).catch(fail); }); return; }
    void (async () => {
      const response = await fetch(`/api/call/audio?step=${encodeURIComponent(command.id)}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("The audio could not be played.");
      await mic.current!.play(await response.arrayBuffer(), command.kind === "speak" ? command.pace : "standard");
      if (mounted.current && mic.current) await action("ack", command.id);
    })().catch(fail);
  }, [command]);
  async function answer() {
    if (!command || answering) return; setAnswering(true); setError("");
    try { const next = new Microphone(); mic.current = next; await next.open(); await action("ack", command.id); }
    catch (e) { fail(e); } finally { setAnswering(false); }
  }
  async function stop() {
    const step = current.current, audio = mic.current?.finish(); mic.current?.close(); mic.current = null; setActive(false); setMessage("Your call has ended.");
    try {
      if (audio && step?.kind === "listen") await sendAudio(step.id, audio, true);
      else { if (sending.current) await sending.current.catch(() => undefined); await action("stop"); }
    } catch { await action("stop").catch(() => undefined); }
  }
  const incoming = command?.kind === "incoming";
  return <section className="recall-revisit" aria-label="Recall web call"><p>Recall · AI assistant</p>{topic && !incoming && <p>{topic}</p>}<h1>{incoming ? `${caller} is calling.` : command?.kind === "listen" ? "I’m listening." : command?.kind === "playback" ? "Your own words." : command?.kind === "speak" ? command.text : message}</h1>
    {incoming && <button className="recall-button recall-primary" onClick={() => void answer()} disabled={answering}><Phone aria-hidden="true" />{answering ? "Opening microphone…" : "Answer call"}</button>}
    {active && <button className="recall-button recall-secondary" onClick={() => void stop()}><PhoneOff aria-hidden="true" />End call</button>}
    {!active && <p>You can put your device down.</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
