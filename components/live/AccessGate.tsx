"use client";

import { useId, useState, type ReactNode, type FormEvent } from "react";
import Link from "next/link";
import { api } from "@/client/api";
import { useLive } from "./LiveProvider";
import "@/app/welcome.css";

export function accountDestination(role: "operator" | "family" | "patient") {
  return role === "patient"
    ? "/revisit"
    : role === "family"
      ? "/caregiver"
      : "/onboarding";
}

export function SessionLoading() {
  const { refreshSession, sessionError } = useLive();
  return (
    <section
      className="recall-access"
      aria-live="polite"
      aria-busy={!sessionError}
    >
      <p>
        {sessionError
          ? "Recall couldn’t open your account. Please reconnect and try loading it again."
          : "Opening Recall…"}
      </p>
      {sessionError && (
        <button className="care-action" onClick={() => void refreshSession()}>
          Reload account
        </button>
      )}
    </section>
  );
}

export function AccessGate({
  children,
  operator = false,
  setup = false,
  firstSetup = false,
  patient = false,
  anyRole = false,
}: {
  children: ReactNode;
  operator?: boolean;
  setup?: boolean;
  firstSetup?: boolean;
  patient?: boolean;
  anyRole?: boolean;
}) {
  const { session, refreshSession } = useLive();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [phone, setPhone] = useState(""),
    [key, setKey] = useState("");
  const [mode, setMode] = useState<"email" | "phone" | "key">(
    patient ? "phone" : "email",
  );
  const [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [sent, setSent] = useState(false);
  const fieldId = useId();
  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(
        mode === "key" ? "/api/session" : "/api/circle/" + (mode === "email" ? "login" : "phone-sign-in"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            mode === "key" ? { key } : mode === "email" ? { email, password } : { phone },
          ),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (mode === "phone") setSent(true);
      else {
        setPassword("");
        setKey("");
        await refreshSession();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try signing in again.");
    } finally {
      setPending(false);
    }
  }
  if (!session) return <SessionLoading />;
  const principal = session.principal;
  const allowed =
    (firstSetup && !principal) ||
    (setup && session.can_manage_setup) ||
    (principal &&
      !setup &&
      (anyRole ||
        (patient
          ? principal.role === "patient"
          : operator
            ? principal.role === "operator"
            : principal.role !== "patient")));
  if (allowed) return children;
  return (
    <section
      className="recall-access"
      style={{ margin: "8vh auto", maxWidth: 440, padding: 28 }}
    >
      <p className="circle-eyebrow">YOUR FAMILY, A LITTLE CLOSER</p>
      <h1>{patient ? "A familiar moment awaits." : "Welcome back."}</h1>
      <p>
        {patient
          ? "Open the link your family sent, or ask for a new one below."
          : "Sign in to your family’s private collection."}
      </p>
      {principal && (
        <p>
          You’re signed in to a different account.{" "}
          <Link href={accountDestination(principal.role)}>
            Open your account
          </Link>
        </p>
      )}
      <form className="recall-access-form" onSubmit={signIn}>
        {mode === "key" ? (
          <label htmlFor={fieldId}>Access key
            <input id={fieldId} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} maxLength={512} required disabled={pending} />
          </label>
        ) : mode === "email" ? (
          <>
            <label htmlFor={fieldId}>
              Email
              <input
                id={fieldId}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={pending}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                maxLength={128}
                disabled={pending}
              />
            </label>
          </>
        ) : (
          <label htmlFor={fieldId}>
            Your phone number
            <input
              id={fieldId}
              type="tel"
              autoComplete="tel"
              placeholder="+1 555 123 4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[ ()-]/g, ""))}
              pattern="\+[1-9][0-9]{6,14}"
              required
              disabled={pending}
            />
          </label>
        )}
        {error && (
          <p role="alert" className="recall-access-error">
            {error}
          </p>
        )}
        {sent && (
          <p role="status">
            If this number belongs to your family account, a fresh sign-in link
            is on its way.
          </p>
        )}
        <button className="recall-button recall-primary" disabled={pending}>
          {pending
            ? "One moment…"
            : mode !== "phone"
              ? "Sign in"
              : "Text me a sign-in link"}
        </button>
      </form>
      <button
        className="care-text-action"
        style={{ marginTop: 20 }}
        onClick={() => {
          setMode(mode === "email" ? "phone" : "email");
          setError("");
          setSent(false);
        }}
      >
        {mode === "email"
          ? "Use a link on my phone instead"
          : "Use email and password"}
      </button>
      {mode !== "key" && <button className="care-text-action" style={{ marginTop: 12 }} onClick={() => { setMode("key"); setError(""); setSent(false); }}>Use an existing access key</button>}
      <p className="recall-access-bottom">
        New here? <Link href="/onboarding">Start your family</Link>
      </p>
    </section>
  );
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
      setError(
        "We couldn’t sign you out. Please reconnect and try signing out again.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <button
        className="care-text-action"
        disabled={pending}
        onClick={() => void signOut()}
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
