"use client";
import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { api } from "@/client/api";
import type { ToolOutput } from "@/lib/tools/contracts";
export function MemoryForm({ member, name, person, onSaved }: { member: string; name: string; person: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false), [who, setWho] = useState(""), [text, setText] = useState(""), [whenWhere, setWhenWhere] = useState("");
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault(); if (pending) return;
    setPending(true); setError(""); setStatus("");
    try {
      const result = await api<ToolOutput<"receive_family_contribution">>("/api/family/memory", { method: "POST", body: JSON.stringify({ member, who, what_happened: text, when_where: whenWhere }) });
      if (result.status === "refused") { setError("This contribution could not be saved. Check that your access is still approved."); return; }
      if (result.status === "rejected_question") { setError(result.line.text); return; }
      setStatus(result.line.text); setWho(""); setText(""); setWhenWhere(""); setOpen(false); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Your memory could not be saved."); }
    finally { setPending(false); }
  }
  return <aside className="care-contribute" id="suggestions"><h2>For your next conversation</h2><p>Share a memory you have with {person}.</p><button className="care-action care-action-primary" aria-expanded={open} onClick={() => setOpen(!open)}><Plus size={20} aria-hidden="true" />Share a memory</button>
    {open && <form className="care-suggestion-form" onSubmit={save}><p>Contributing as <strong>{name}</strong></p>
      <label>Who was there?<input value={who} onChange={(e) => setWho(e.target.value)} maxLength={200} required /></label>
      <label>What do you remember?<textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={5} required /></label>
      <p className="care-caption">Tell it in your own words. This stays your account.</p>
      <label>When or where? (optional)<input value={whenWhere} onChange={(e) => setWhenWhere(e.target.value)} maxLength={200} /></label>
      <div className="care-form-actions"><button className="care-action care-action-primary" disabled={pending}>{pending ? "Saving…" : "Save memory"}</button><button type="button" className="care-text-action" disabled={pending} onClick={() => setOpen(false)}>Cancel</button></div>
      <p className="care-caption">This saves your contribution. It does not schedule a call.</p>
    </form>}{error && <p role="alert" className="setup-error">{error}</p>}<p role="status" className="care-save-status">{status}</p>
    <div className="care-human-invitation"><h3>Or, make time for a call.</h3><p>If you have a question for {person}, ask them directly.</p></div>
  </aside>;
}
