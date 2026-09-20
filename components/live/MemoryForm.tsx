"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Microphone } from "@/client/microphone";
import { KnowledgeReview } from "./KnowledgeReview";
import { Plus } from "lucide-react";
import { api } from "@/client/api";
import type { ToolOutput } from "@/lib/tools/contracts";
export function MemoryForm({ member, name, person, onSaved, openRequest = 0, active = true }: { member: string; name: string; person: string; onSaved: () => void; openRequest?: number; active?: boolean }) {
  const [open, setOpen] = useState(false), [who, setWho] = useState(""), [text, setText] = useState(""), [whenWhere, setWhenWhere] = useState("");
  const whoInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!openRequest) return;
    setOpen(true);
    const frame = requestAnimationFrame(() => {
      whoInput.current?.focus({ preventScroll: true });
      whoInput.current?.closest("aside")?.scrollIntoView({ block: "nearest", behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [openRequest]);
  const [topics, setTopics] = useState<Array<{ id: string; label: string }>>([]), [topic, setTopic] = useState("");
  useEffect(() => { const controller = new AbortController(); void api<Array<{ id: string; label: string }>>(`/api/family/topics?member=${encodeURIComponent(member)}`, { signal: controller.signal }).then(setTopics).catch(() => undefined); return () => controller.abort(); }, [member]);
  const [attachment, setAttachment] = useState<{ asset_id: string; medium: string } | null>(null), [recording, setRecording] = useState(false);
  const microphone = useRef<Microphone | null>(null);
  useEffect(() => () => { microphone.current?.close(); microphone.current = null; }, []);
  useEffect(() => {
    if (active) return;
    microphone.current?.close();
    microphone.current = null;
    setRecording(false);
  }, [active]);
  async function upload(bytes: Blob | Uint8Array, type: string) {
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/family/media?member=${encodeURIComponent(member)}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": type }, body: bytes instanceof Uint8Array ? new Uint8Array(bytes) : bytes });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setAttachment(result); if (result.transcript) setText(result.transcript);
    } catch (e) { setError(e instanceof Error ? e.message : "The upload could not be saved."); } finally { setPending(false); }
  }
  async function record() {
    setRecording(true);
    const mic = new Microphone();
    microphone.current = mic;
    try {
      await mic.open();
      if (microphone.current !== mic) { mic.close(); return; }
      setRecording(true);
      mic.listen((bytes) => {
        if (microphone.current !== mic) return;
        mic.close(); setRecording(false); void upload(bytes, "audio/wav");
      });
    } catch {
      if (microphone.current !== mic) return;
      mic.close(); setRecording(false); setError("Microphone access is unavailable. You can type your memory.");
    }
  }
  function finishRecording() { const bytes = microphone.current?.finish(); microphone.current?.close(); setRecording(false); if (bytes) void upload(bytes, "audio/wav"); }
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault(); if (pending) return;
    setPending(true); setError(""); setStatus("");
    try {
      const result = await api<ToolOutput<"receive_family_contribution">>("/api/family/memory", { method: "POST", body: JSON.stringify({ member, who, what_happened: text, when_where: whenWhere, asset_id: attachment?.asset_id, about_topic_id: topic || null }) });
      if (result.status === "refused") { setError("This contribution could not be saved. Check that your access is still approved."); return; }
      if (result.status === "rejected_question") { setError(result.line.text); return; }
      setAttachment(null); setStatus(result.line.text); setWho(""); setText(""); setWhenWhere(""); setOpen(false); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Your memory could not be saved."); }
    finally { setPending(false); }
  }
  return <aside className="care-contribute" id="suggestions"><h2>For your next conversation</h2><p>Share a memory you have with {person}.</p><button className="care-action care-action-primary" aria-expanded={open} disabled={pending || recording} onClick={() => setOpen(!open)}><Plus size={20} aria-hidden="true" />Share a memory</button>
    {open && <form className="care-suggestion-form" onSubmit={save}><p>Contributing as <strong>{name}</strong></p>
      {topics.length > 0 && <label>Conversation topic (optional)<select value={topic} onChange={(e) => setTopic(e.target.value)}><option value="">No topic selected</option>{topics.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>}
      <label>Who was there?<input ref={whoInput} value={who} onChange={(e) => setWho(e.target.value)} maxLength={200} required /></label>
      <label>What do you remember?<textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={5} required /></label>
      <p className="care-caption">Tell it in your own words. This stays your account.</p>
      <label>Add a photo or WAV voice note (optional)<input type="file" accept="image/jpeg,image/png,audio/wav" disabled={pending || recording} onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file, /\.wav$/i.test(file.name) ? "audio/wav" : file.type); e.target.value = ""; }} /></label>
      <button type="button" className="care-text-action" disabled={pending} onClick={() => recording ? finishRecording() : void record()}>{recording ? "Finish voice note" : "Record a voice note"}</button>
      {attachment && <p role="status">{attachment.medium === "photo" ? "Photo attached." : "Voice note attached. Review your transcribed words before saving."}<button type="button" className="care-text-action" onClick={() => setAttachment(null)}>Remove attachment</button></p>}
      <label>When or where? (optional)<input value={whenWhere} onChange={(e) => setWhenWhere(e.target.value)} maxLength={200} /></label>
      <div className="care-form-actions"><button className="care-action care-action-primary" disabled={pending || recording}>{pending ? "Saving…" : "Save memory"}</button><button type="button" className="care-text-action" disabled={pending || recording} onClick={() => setOpen(false)}>Cancel</button></div>
      <p className="care-caption">This saves your contribution. It does not schedule a call.</p>
    </form>}{error && <p role="alert" className="setup-error">{error}</p>}<p role="status" className="care-save-status">{status}</p>
    <KnowledgeReview member={member} refreshKey={status} />
    <div className="care-human-invitation"><h3>Or, make time for a call.</h3><p>If you have a question for {person}, ask them directly.</p></div>
  </aside>;
}
