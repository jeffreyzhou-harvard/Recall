"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { api } from "@/client/api";
import { RecallFrame, RecallHeader } from "@/components/recall/RecallFrame";
export default function JoinPage() {
  const [token, setToken] = useState(""), [key, setKey] = useState(""), [error, setError] = useState(""), [pending, setPending] = useState(false);
  async function accept(e: FormEvent) { e.preventDefault(); setPending(true); setError(""); try { const result = await api<{ key: string }>("/api/onboarding/invitations/accept", { method: "POST", body: JSON.stringify({ token }) }); setToken(""); setKey(result.key); } catch (e) { setError(e instanceof Error ? e.message : "The invitation could not be accepted."); } finally { setPending(false); } }
  return <RecallFrame family><div className="recall-family-shell"><RecallHeader family compact /><main className="care-main"><h1>Join your household</h1>{key ? <><p>Save your access key somewhere private. It is shown once.</p><textarea readOnly aria-label="Your access key" value={key} /><p>Your family can now approve your contributions and dashboard access in joint setup.</p><Link href="/family">Open family sign-in</Link></> : <form className="care-suggestion-form" onSubmit={accept}><label>Invitation code<input type="password" value={token} onChange={(e) => setToken(e.target.value)} required maxLength={512} autoComplete="off" /></label><button className="care-action" disabled={pending}>{pending ? "Joining…" : "Accept invitation"}</button></form>}{error && <p role="alert">{error}</p>}</main></div></RecallFrame>;
}
