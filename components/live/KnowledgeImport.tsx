"use client";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/client/api";
import { parseCalendar, parseContacts } from "@/lib/recall-preview/imports";
type Row = { selected: boolean; kind: "history" | "calendar" | "contact" | "photo"; label: string; text: string; date?: string; person_id?: string; asset_id?: string; place?: string };
type Member = { person_id: string; display_name: string };

/** Raw contact/calendar files stay in the browser. Only reviewed, selected fields are submitted. */
export function KnowledgeImport({ contributor, members, onSaved }: { contributor: Member; members: Member[]; onSaved: () => Promise<void> }) {
  const [rows, setRows] = useState<Row[]>([]), [reviewed, setReviewed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  const [requestId, setRequestId] = useState("");
  const [queue, setQueue] = useState<{ organizer: string; waiting: number; retrying: boolean } | null>(null);
  useEffect(() => { const controller = new AbortController(); void api<{ organizer: string; waiting: number; retrying: boolean }>("/api/onboarding/knowledge", { signal: controller.signal }).then(setQueue).catch(() => undefined); return () => controller.abort(); }, [status]);
  const change = (next: Row[]) => { setRows(next); setReviewed(false); setRequestId(crypto.randomUUID()); setStatus(""); };
  const edit = (index: number, value: Partial<Row>) => change(rows.map((r, i) => i === index ? { ...r, ...value } : r));
  async function read(file: File) {
    setBusy(true); setError(""); setStatus("");
    try {
      const extension = file.name.split(".").at(-1)?.toLowerCase();
      let additions: Row[];
      if (["jpg", "jpeg", "png"].includes(extension ?? "")) {
        if (file.size > 6 * 1024 * 1024) throw new Error("Choose a photo under 6 MB.");
        const response = await fetch(`/api/family/media?member=${encodeURIComponent(contributor.person_id)}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": file.type }, body: file });
        const data = await response.json(); if (!response.ok) throw new Error(data.error);
        additions = [{ kind: "photo", selected: true, label: "", text: "", asset_id: data.asset_id }];
      } else {
        if (file.size > 1_000_000) throw new Error("Choose a text export under 1 MB.");
        const text = await file.text();
        if (extension === "ics") additions = parseCalendar(text).map((e) => ({ kind: "calendar", selected: false, label: e.title, text: e.title, date: e.date.slice(0, 10) }));
        else if (extension === "vcf" || extension === "csv") additions = parseContacts(text, extension).map((c) => { const match = members.filter((m) => m.display_name.toLowerCase() === c.name.toLowerCase()); return { kind: "contact", selected: false, label: c.name, text: "", person_id: match.length === 1 ? match[0]!.person_id : "" }; });
        else if (extension === "txt") { if (text.length > 2000) throw new Error("Choose a short history of up to 2,000 characters."); additions = [{ kind: "history", selected: true, label: "", text }]; }
        else throw new Error("Choose a photo, .ics calendar, .vcf or .csv contacts, or a short .txt history.");
      }
      if (rows.length + additions.length > 200) throw new Error("Review or remove the current items before adding more than 200 previews.");
      change([...rows, ...additions]);
    } catch (e) { setError(e instanceof Error ? e.message : "The file could not be read."); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    const selected = rows.filter((r) => r.selected);
    if (!selected.length || selected.length > 20) { setError("Select between one and 20 items."); return; }
    setBusy(true); setError(""); setStatus("");
    try {
      const items = selected.map(({ selected: _selected, ...item }) => ({ ...item, ...(item.place ? {} : { place: undefined }) }));
      await api("/api/onboarding/knowledge", { method: "POST", body: JSON.stringify({ request_id: requestId, contributor_id: contributor.person_id, reviewed, items }) });
      setRows([]); setReviewed(false); setStatus("Contributions saved. Review new conversation topics in the joint choices below.");
      try { await onSaved(); } catch { setError("Saved, but the topic list could not refresh. Reload this page to review the new topics."); }
    } catch (e) { setError(e instanceof Error ? e.message : "The selection could not be saved."); }
    finally { setBusy(false); }
  }
  return <form className="care-suggestion-form" onSubmit={save}>
    <h2>Add selected memories and records</h2>
    {queue && <p className="care-caption">{queue.organizer.startsWith("muse") ? "Muse Spark helps organize contributed accounts." : "Known names are linked directly. Muse Spark is not configured."}{queue.waiting > 0 ? ` ${queue.waiting} contribution${queue.waiting === 1 ? " is" : "s are"} waiting to be organized.` : ""}{queue.retrying ? " Some updates are waiting for another attempt; the original contributions are saved." : ""}</p>}
    <p>Contributing as {contributor.display_name}. These stay your contributions. New conversation topics need joint approval.</p>
    <label>Choose a photo, contacts, calendar, or short history<input type="file" accept=".jpg,.jpeg,.png,.vcf,.csv,.ics,.txt" disabled={busy} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void read(file); }} /></label>
    <p className="care-caption">Contacts and calendar exports are read on this device. Only the selected names, dates and accounts below are saved. Contact numbers and other export fields are omitted.</p>
    {rows.length > 0 && <fieldset disabled={busy}><legend>Review your selection</legend>{rows.map((r, index) => <fieldset key={index}><legend>{r.kind === "photo" ? "Selected photo" : r.label || "Short history"}</legend>
      <label><input type="checkbox" checked={r.selected} onChange={(e) => edit(index, { selected: e.target.checked })} />Include this item</label>
      {r.selected && <>
        {r.kind === "contact" ? <label>Approved household member<select required value={r.person_id ?? ""} onChange={(e) => { const member = members.find((m) => m.person_id === e.target.value); edit(index, { person_id: e.target.value, label: member?.display_name ?? r.label }); }}><option value="">Choose the matching person</option>{members.map((m) => <option key={m.person_id} value={m.person_id}>{m.display_name}</option>)}</select></label> : <label>Short conversation topic<input required maxLength={80} value={r.label} onChange={(e) => edit(index, { label: e.target.value })} /></label>}
        {r.kind === "calendar" && <label>Date of the calendar entry<input type="date" required value={r.date ?? ""} onChange={(e) => edit(index, { date: e.target.value })} /></label>}
        <label>{r.kind === "photo" ? "What this photo shows, in your words" : "Your account or the selected entry’s wording"}<textarea required rows={3} maxLength={2000} value={r.text} onChange={(e) => edit(index, { text: e.target.value })} /></label>
        <label>Place named in your account (optional)<input maxLength={80} value={r.place ?? ""} onChange={(e) => edit(index, { place: e.target.value })} /></label>
      </>}
      <button type="button" className="care-text-action" onClick={() => change(rows.filter((_, i) => i !== index))}>Remove item</button>
    </fieldset>)}</fieldset>}
    {rows.length > 0 && <><label><input type="checkbox" required disabled={busy} checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />I reviewed the selected items and agree to contribute them with my name.</label><button className="care-action" disabled={busy || !reviewed}>{busy ? "Saving selection…" : "Save selected contributions"}</button></>}
    {error && <p role="alert" className="setup-error">{error}</p>}<p role="status">{status}</p>
  </form>;
}
