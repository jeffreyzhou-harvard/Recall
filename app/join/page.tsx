"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { api } from "@/client/api";
import { RecallFrame, RecallHeader } from "@/components/recall/RecallFrame";
import "@/app/onboarding-live.css";

export default function JoinPage() {
  const [token, setToken] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function accept(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true); setError("");
    try {
      const result = await api<{ key: string }>("/api/onboarding/invitations/accept", { method: "POST", body: JSON.stringify({ token: token.trim() }) });
      setToken(""); setKey(result.key);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The invitation could not be accepted.");
    } finally { setPending(false); }
  }
  return <RecallFrame family><div className="recall-family-shell"><RecallHeader family compact />
    <main className="recall-onboarding live-setup live-join">
      <Link className="setup-back" href="/"><ArrowLeft size={18} aria-hidden="true" />Home</Link>
      <h1>{key ? "You’ve joined your family." : "Join your family."}</h1>
      {key ? <>
        <p className="setup-intro">Save your personal sign-in key somewhere private. You’ll use it to open Recall.</p>
        <section className="live-secret live-setup-fields">
          <label>Your sign-in key<textarea readOnly value={key} rows={3} autoComplete="off" spellCheck={false} aria-describedby="join-key-help" /></label>
          <p className="live-setup-hint" id="join-key-help">This key is shown only here. It gives access to your account.</p>
        </section>
        <p className="live-setup-hint">Your caregiver still needs to approve what you can contribute and see.</p>
        <Link className="recall-button recall-primary" href="/sign-in">Continue to sign in<ArrowRight aria-hidden="true" /></Link>
      </> : <>
        <p className="setup-intro">Enter the invitation code shared by the person setting up Recall.</p>
        <form className="live-setup-fields" onSubmit={accept} aria-busy={pending}>
          <label>Invitation code<input type="password" value={token} onChange={(e) => setToken(e.target.value)} required maxLength={512} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby={error ? "join-error" : undefined} /></label>
          {error && <p role="alert" className="setup-error" id="join-error">{error}</p>}
          <button className="recall-button recall-primary" disabled={pending}>{pending ? "Joining…" : "Accept invitation"}<ArrowRight aria-hidden="true" /></button>
        </form>
        <Link className="setup-text-button" href="/sign-in">Already have a sign-in key?</Link>
      </>}
    </main>
  </div></RecallFrame>;
}
