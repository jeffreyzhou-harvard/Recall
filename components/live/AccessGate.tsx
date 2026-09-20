"use client";
import { useState, type ReactNode, type FormEvent } from "react";
import { api } from "@/client/api";
import { useLive } from "./LiveProvider";
export function AccessGate({ children, operator = false }: { children: ReactNode; operator?: boolean }) {
  const { session, refreshSession, sessionError } = useLive();
  const [key, setKey] = useState(""), [error, setError] = useState(""), [pending, setPending] = useState(false);
  async function signIn(local = false) {
    setPending(true); setError("");
    try { await api("/api/session", { method: "POST", body: JSON.stringify(local ? { local: true } : { key }) }); setKey(""); await refreshSession(); }
    catch (e) { setError(e instanceof Error ? e.message : "Sign-in could not be completed."); }
    finally { setPending(false); }
  }
  if (!session) return <section className="care-overview" aria-live="polite"><p>{sessionError || "Opening Recall…"}</p>{sessionError && <button className="care-action" onClick={() => void refreshSession()}>Reload</button>}</section>;
  if (session.principal && (!operator || session.principal.role === "operator")) return children;
  return <section className="care-overview">
    <h1>{operator ? "Open joint setup" : "Open your family view"}</h1>
    <p>{operator ? "An operator access key is needed to record the choices you agree together." : "Use the access key provided for your approved family account."}</p>
    <form className="care-suggestion-form" onSubmit={(e: FormEvent) => { e.preventDefault(); void signIn(); }}>
      <label>Access key<input type="password" autoComplete="current-password" value={key} onChange={(e) => setKey(e.target.value)} maxLength={512} required /></label>
      <button className="care-action care-action-primary" disabled={pending}>{pending ? "Opening…" : "Open Recall"}</button>
    </form>
    {session.local_setup_available && <button className="care-text-action" disabled={pending} onClick={() => void signIn(true)}>Open local setup</button>}
    {error && <p role="alert" className="setup-error">{error}</p>}
  </section>;
}
export function SignOut() {
  const { refreshSession, setMember } = useLive();
  const [error, setError] = useState("");
  return <><button className="care-text-action" onClick={async () => { try { await api("/api/session", { method: "DELETE" }); setMember(""); await refreshSession(); } catch { setError("Could not sign out. Please reload."); } }}>Sign out</button>{error && <p role="alert">{error}</p>}</>;
}
