"use client";

import { useId, useState, type ReactNode, type FormEvent } from "react";
import Link from "next/link";
import { api } from "@/client/api";
import { useLive } from "./LiveProvider";
import "@/app/welcome.css";

export function accountDestination(role: "operator" | "family" | "patient") {
  return role === "patient" ? "/revisit" : role === "family" ? "/caregiver" : "/onboarding";
}

export function SessionLoading() {
  const { refreshSession, sessionError } = useLive();
  return <section className="recall-access" aria-live="polite" aria-busy={!sessionError}>
    <p>{sessionError ? "Recall couldn’t open your account. Please reconnect and try loading it again." : "Opening Recall…"}</p>
    {sessionError && <button className="care-action" onClick={() => void refreshSession()}>Reload account</button>}
  </section>;
}

export function AccessGate({ children, operator = false, setup = false, firstSetup = false, patient = false, anyRole = false }: {
  children: ReactNode;
  operator?: boolean;
  setup?: boolean;
  firstSetup?: boolean;
  patient?: boolean;
  anyRole?: boolean;
}) {
  const { session, refreshSession } = useLive();
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;

  async function signIn() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await api("/api/session", { method: "POST", body: JSON.stringify({ key: key.trim() }) });
      setKey("");
      await refreshSession();
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn’t sign you in. Check your access key and try signing in again.");
    } finally {
      setPending(false);
    }
  }

  if (!session) return <SessionLoading />;
  const principal = session.principal;
  const allowed = (firstSetup && session.first_setup_available) || (setup && session.can_manage_setup) || (principal && !setup && (anyRole || (patient ? principal.role === "patient" : operator ? principal.role === "operator" : principal.role !== "patient")));
  if (allowed) return children;

  return <section className="recall-access">
    <h1>{setup ? "Continue your family’s setup" : operator ? "Set up Recall together" : patient ? "Sign in for your calls" : "Sign in to Recall"}</h1>
    <p>{setup ? "Recall already has private access. Sign in with your caregiver access key to review your family’s choices."
      : operator
      ? "You and the person receiving calls will choose what feels comfortable, together."
      : patient ? "Use the access key your caregiver saved with you."
      : "Use your private access key to open your account."}</p>
    {principal && <p className="recall-access-notice">You’re signed in to {principal.role === "patient" ? "a call account" : principal.role === "family" ? "a family account" : "a setup account"}. This page needs a different key. <Link href={accountDestination(principal.role)}>Return to your account</Link></p>}
    <form className="recall-access-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void signIn(); }}>
      <label htmlFor={fieldId}>{operator ? "Setup key" : "Access key"}</label>
      <input id={fieldId} name="access-key" type="password" autoComplete="current-password" autoCapitalize="none" spellCheck={false} value={key} onChange={(event) => { setKey(event.target.value); setError(""); }} maxLength={512} required disabled={pending} aria-invalid={Boolean(error)} aria-describedby={`${hintId}${error ? ` ${errorId}` : ""}`} />
      <p className="recall-access-hint" id={hintId}>{operator ? "Use the setup key provided by the person helping your family get started." : "Your family provides this key. Keep it somewhere private."}</p>
      {error && <p className="recall-access-error" id={errorId} role="alert">{error}</p>}
      <button className="recall-button recall-primary" disabled={pending || !key.trim()}>{pending ? "Signing in…" : operator ? "Continue to setup" : "Sign in"}</button>
    </form>
    {!operator && !setup && !patient && <p className="recall-access-bottom">New to Recall? <Link href="/get-started">Get started</Link></p>}
  </section>;
}

export function SignOut() {
  const { refreshSession, setMember } = useLive();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function signOut() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await api("/api/session", { method: "DELETE" });
      setMember("");
      await refreshSession();
    } catch {
      setError("We couldn’t sign you out. Please reconnect and try signing out again.");
    } finally {
      setPending(false);
    }
  }
  return <><button className="care-text-action" disabled={pending} onClick={() => void signOut()}>{pending ? "Signing out…" : "Sign out"}</button>{error && <p role="alert">{error}</p>}</>;
}
