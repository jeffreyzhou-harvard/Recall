"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ImagePlus, Plus, X } from "lucide-react";
import { usePreview } from "./PreviewProvider";
import { LocalPhoto } from "./LocalPhoto";
import { suggestionError, type SuggestionDraft } from "@/lib/recall-preview/contributions";
import familyCopy from "@/fixtures/family-copy.json";

const emptyDraft: SuggestionDraft = { kind: "memory", topicId: null, who: "", text: "", whenWhere: "", photo: null };

export function MemorySuggestionForm() {
  const { data, suggestions, setSuggestions } = usePreview();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SuggestionDraft>(emptyDraft);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const kindInput = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const errorBox = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (open) kindInput.current?.focus(); }, [open]);
  useEffect(() => { if (error) errorBox.current?.focus(); }, [error]);

  function close() {
    setOpen(false);
    setError("");
    opener.current?.focus({ preventScroll: true });
  }
  function save(event: FormEvent) {
    event.preventDefault();
    const issue = suggestionError(draft, familyCopy.question_openers);
    if (issue) { setError(issue); return; }
    if (suggestions.length >= 8) { setError("This preview holds eight suggestions. Remove one before adding another."); return; }
    setSuggestions((current) => [...current, {
      ...draft, id: crypto.randomUUID(), contributor: data.familyMember,
      patientConfirmed: false, createdAt: new Date().toISOString(),
    }]);
    setDraft(emptyDraft);
    setStatus("Suggestion saved in this preview. No call has been scheduled.");
    close();
  }

  return <aside className="care-contribute" id="suggestions" aria-labelledby="suggestions-title">
    <h2 id="suggestions-title">For your next conversation</h2>
    <p>Suggest a memory or a question for Susan’s next agreed Recall call.</p>
    <button ref={opener} className="care-action care-action-primary" aria-expanded={open} aria-controls="memory-suggestion-form" onClick={() => { setOpen(!open); setStatus(""); }}>
      <Plus size={20} aria-hidden="true" />Suggest a conversation
    </button>
    <p className="care-caption">Susan chooses whether to discuss it, and whether to share her answer with you.</p>
    {open && <form id="memory-suggestion-form" className="care-suggestion-form" onSubmit={save} noValidate>
      <p>Contributing as <strong>{data.familyMember}</strong></p>
      <fieldset className="care-request-kind"><legend>What would you like to bring?</legend><label><input ref={kindInput} type="radio" name="suggestion-kind" checked={draft.kind === "memory"} onChange={() => { setDraft({ ...draft, kind: "memory" }); setError(""); }} />Share a memory</label><label><input type="radio" name="suggestion-kind" checked={draft.kind === "question"} onChange={() => { setDraft({ ...draft, kind: "question" }); setError(""); }} />Suggest a question</label></fieldset>
      <label htmlFor="memory-who">{draft.kind === "memory" ? "Who was there?" : "Who is it about? (optional)"}<input id="memory-who" value={draft.who} maxLength={200} onChange={(event) => setDraft({ ...draft, who: event.target.value })} required={draft.kind === "memory"} autoComplete="off" /></label>
      <label htmlFor="memory-topic">Related topic<select id="memory-topic" value={draft.topicId ?? ""} onChange={(event) => setDraft({ ...draft, topicId: event.target.value || null })}><option value="">Another memory</option>{data.topics.map((topic) => <option value={topic.id} key={topic.id}>{topic.name}</option>)}</select></label>
      <label htmlFor="memory-text">{draft.kind === "memory" ? "What do you remember?" : "What would you like to ask Susan?"}<textarea id="memory-text" value={draft.text} maxLength={draft.kind === "memory" ? 2000 : 280} rows={5} onChange={(event) => setDraft({ ...draft, text: event.target.value })} required aria-describedby="memory-text-hint" /></label>
      <p id="memory-text-hint" className="care-caption">{draft.kind === "memory" ? "Tell it in your own words. It stays your account until Susan offers her own." : "One short, open question. Recall invites Susan to talk; it never answers from her private memories."}</p>
      <label htmlFor="memory-when">When or where? <span>(optional)</span><input id="memory-when" value={draft.whenWhere} maxLength={200} onChange={(event) => setDraft({ ...draft, whenWhere: event.target.value })} /></label>
      <label className="care-photo-input"><ImagePlus size={20} aria-hidden="true" />{draft.photo ? "Change photo" : "Add a photo (optional)"}<input aria-label="Choose a photo for this memory" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
        const photo = event.target.files?.[0];
        if (!photo) return;
        if (!["image/jpeg", "image/png", "image/webp"].includes(photo.type) || photo.size > 10 * 1024 * 1024) { setError("Choose a JPG, PNG or WebP photo smaller than 10 MB."); event.target.value = ""; return; }
        setDraft({ ...draft, photo }); setError("");
      }} /></label>
      {draft.photo && <figure className="care-suggestion-photo"><LocalPhoto file={draft.photo} /><figcaption>{draft.photo.name}</figcaption><button type="button" className="care-text-action" onClick={() => setDraft({ ...draft, photo: null })}>Remove photo</button></figure>}
      {error && <p className="care-form-error" role="alert" ref={errorBox} tabIndex={-1}>{error}</p>}
      <div className="care-form-actions"><button className="care-action care-action-primary" type="submit">Save suggestion</button><button className="care-text-action" type="button" onClick={close}>Cancel</button></div>
      <p className="care-caption">Preview only. This does not start a call. Text and photos clear on refresh.</p>
    </form>}
    <p className="care-save-status" role="status">{status}</p>
    {suggestions.length > 0 && <section className="care-saved-suggestions" aria-labelledby="saved-suggestions-title">
      <h3 id="saved-suggestions-title">Your suggestions</h3>
      <ul>{suggestions.map((suggestion) => <li key={suggestion.id}>
        <div className="care-suggestion-heading"><h4>{data.topics.find((topic) => topic.id === suggestion.topicId)?.name ?? "Another memory"}</h4><button className="care-remove" aria-label={"Remove suggestion: " + suggestion.text.slice(0, 60)} onClick={() => { setSuggestions((items) => items.filter((item) => item.id !== suggestion.id)); setStatus("Suggestion removed from this preview."); }}><X size={20} aria-hidden="true" /></button></div>
        <p>{suggestion.text}</p><p className="care-caption">{suggestion.kind === "question" ? `Question from ${suggestion.contributor} · No answer shared` : `${suggestion.contributor}’s account · Not confirmed by Susan`}</p>
        <p className="care-caption">Suggested for a future call · Preview only</p>
        {suggestion.photo && <p className="care-caption">Photo: {suggestion.photo.name}</p>}
      </li>)}</ul>
    </section>}
    <div className="care-human-invitation"><h3>Or, make time for a call.</h3><p>Ask Susan what’s on her mind. A conversation with you doesn’t need a prompt from Recall.</p></div>
  </aside>;
}
