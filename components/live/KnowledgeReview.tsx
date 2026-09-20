"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/client/api";
type Item = { id: string; kind: "entity" | "connection"; label: string; interpretation: string; original: string };
export function KnowledgeReview({ member, refreshKey }: { member: string; refreshKey?: string }) {
  const [items, setItems] = useState<Item[]>([]), [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  const load = useCallback(async () => { const next = await api<Item[]>(`/api/family/knowledge?member=${encodeURIComponent(member)}`); setItems(next); setSelected([]); }, [member]);
  useEffect(() => { void load().catch(() => setError("Your contribution interpretations could not be loaded.")); }, [load, refreshKey]);
  useEffect(() => {
    if (busy || selected.length) return;
    const timer = setInterval(() => { void load().catch(() => undefined); }, 15000);
    return () => clearInterval(timer);
  }, [load, busy, selected.length]);
  if (!items.length && !error && !status) return null;
  return <section className="care-suggestion-form">
    <h3>Review your contributions</h3><p>Recall found possible people, places and connections in your accounts. Confirm only the interpretations you intended. They remain your account.</p>
    <fieldset disabled={busy}><legend>Interpretations to confirm</legend>{items.map((item) => <div key={item.id}>
      <label><input type="checkbox" checked={selected.includes(item.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))} />{item.kind === "entity" ? `${item.label} · ${item.interpretation}` : item.interpretation}</label>
      <details><summary>Your original account</summary><blockquote>{item.original}</blockquote></details>
    </div>)}</fieldset>
    {items.length > 0 && <button className="care-action" disabled={busy || !selected.length || selected.length > 24} onClick={() => { setBusy(true); setError(""); setStatus(""); void api("/api/family/knowledge", { method: "POST", body: JSON.stringify({ member, ids: selected }) }).then(async () => { setStatus("Your interpretations were saved with your account."); await load(); }).catch((e) => setError(e instanceof Error ? e.message : "The interpretations could not be saved.")).finally(() => setBusy(false)); }}>{busy ? "Saving…" : "Confirm selected interpretations"}</button>}
    {error && <p role="alert" className="setup-error">{error}</p>}<p role="status">{status}</p>
  </section>;
}
