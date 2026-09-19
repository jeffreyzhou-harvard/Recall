"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, ImagePlus, Upload, X } from "lucide-react";
import { RecallFrame, RecallHeader } from "@/components/recall/RecallFrame";
import { PreviewNav } from "@/components/recall/PreviewNav";
import { LocalPhoto } from "@/components/recall/LocalPhoto";
import { usePreview } from "@/components/recall/PreviewProvider";
import { parseCalendar, parseContacts, type SetupSelections } from "@/lib/recall-preview/imports";

const steps = ["Photos", "People", "Calendar", "Review"];
const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const permissionNames = { faces: "Group recurring faces", places: "Use places in photos", dates: "Use photo dates", themes: "Find recurring activities" };

export default function OnboardingPage() {
  const { setup, setSetup } = usePreview();
  const [draft, setDraft] = useState<SetupSelections>(setup);
  const [step, setStep] = useState(0);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState("");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) titleRef.current?.focus();
    mounted.current = true;
  }, [step, finished]);
  const move = (next: number) => { setError(""); setStep(next); };

  const photos = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
      setError("Choose JPG, PNG, or WebP photos. Export other formats as JPG first."); return;
    }
    if (files.some((file) => file.size > 10_000_000)) { setError("Choose photos smaller than 10 MB each."); return; }
    const unique = [...new Map([...draft.photos, ...files].map((file) => [file.name + file.size + file.lastModified, file])).values()];
    if (unique.length > 12) { setError("Start with up to 12 photos. You can remove a photo to choose another."); return; }
    setDraft({ ...draft, photos: unique }); setError("");
  };
  const importFile = async (event: ChangeEvent<HTMLInputElement>, kind: "contacts" | "calendar") => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    if (file.size > 1_000_000) { setError("Choose a file smaller than 1 MB."); return; }
    setLoading(true); setError("");
    try {
      const text = await file.text();
      if (kind === "contacts") {
        const format = file.name.toLowerCase().endsWith(".vcf") ? "vcf" : "csv";
        const contacts = parseContacts(text, format);
        setDraft((value) => ({ ...value, contacts }));
      } else {
        const events = parseCalendar(text);
        setDraft((value) => ({ ...value, events }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "This file could not be read. Choose another file.");
    } finally { setLoading(false); }
  };
  const addContact = () => {
    if (!name.trim()) { setError("Enter a name to add this person."); return; }
    setDraft({ ...draft, contacts: [...draft.contacts, { id: "manual-" + Date.now(), name: name.trim(), phone: phone.trim(), relationship: relationship.trim(), selected: true }] });
    setName(""); setPhone(""); setRelationship(""); setError("");
  };
  const finish = () => {
    if (!draft.contacts.some((contact) => contact.selected)) { setError("Choose at least one approved person in the People step."); return; }
    if (!draft.days.length || draft.start >= draft.end) { setError("Choose at least one calling day and an end time after the start time."); return; }
    if (!draft.agreed) { setError("Review these choices together and confirm your agreement below."); return; }
    setSetup({ ...draft, contacts: draft.contacts.filter((contact) => contact.selected), events: draft.events.filter((event) => event.selected) });
    setFinished(true); setError("");
  };
  const selectedContacts = draft.contacts.filter((contact) => contact.selected);
  const selectedEvents = draft.events.filter((event) => event.selected);
  return <RecallFrame family>
    <div className="recall-preview-label">Setup preview <span>· Files stay in this browser tab</span></div>
    <div className="recall-family-shell">
      <RecallHeader family compact />
      <main className="recall-onboarding">
        <Link className="setup-back" href="/caregiver"><ArrowLeft size={18} aria-hidden="true" />Caregiver view</Link>
        {!finished && <ol className="setup-steps" aria-label="Setup steps">{steps.map((label, index) => <li key={label}><button aria-current={step === index ? "step" : undefined} onClick={() => move(index)}><span>{index + 1}</span>{label}</button></li>)}</ol>}
        <h1 ref={titleRef} tabIndex={-1}>{finished ? "Your selections are ready." : ["Start with familiar photos.", "Bring her people closer.", "Make room for familiar moments.", "Set this up together."][step]}</h1>

        {!finished && step === 0 && <>
          <p className="setup-intro">Choose a few photos Susan would enjoy talking about. You’ll decide what Recall can use.</p>
          <label className="setup-upload"><ImagePlus size={36} strokeWidth={1.5} aria-hidden="true" /><strong>Choose photos</strong><span>JPG, PNG, or WebP · Up to 12 photos</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={photos} /></label>
          {draft.photos.length > 0 && <div className="setup-photo-grid">{draft.photos.map((file, index) => <figure key={file.name + index}><LocalPhoto file={file} /><figcaption>{file.name}</figcaption><button aria-label={"Remove " + file.name} onClick={() => setDraft({ ...draft, photos: draft.photos.filter((_, i) => i !== index) })}><X size={20} /></button></figure>)}</div>}
          <fieldset className="setup-permissions"><legend>What may Recall look for?</legend><p>You name the people. Recall won’t guess who a face belongs to.</p>{Object.entries(permissionNames).map(([key, label]) => <label key={key}><input type="checkbox" checked={draft.permissions[key as keyof typeof permissionNames]} onChange={(event) => setDraft({ ...draft, permissions: { ...draft.permissions, [key]: event.target.checked } })} />{label}</label>)}</fieldset>
        </>}

        {!finished && step === 1 && <>
          <p className="setup-intro">Add the people Susan knows. Select who is approved to be part of Recall.</p>
          <label className="setup-import-button"><Upload size={20} aria-hidden="true" />Choose contacts file<input type="file" accept=".vcf,.csv" disabled={loading} onChange={(event) => void importFile(event, "contacts")} /></label>
          <p className="setup-hint">vCard (.vcf), or CSV with Name, Phone and Relationship columns. Importing a file replaces the list below.</p>
          <fieldset className="setup-person-form"><legend>Or add one person</legend><label>Name<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" placeholder="For example, Maya" /></label><label>Relationship<input value={relationship} onChange={(event) => setRelationship(event.target.value)} autoComplete="off" placeholder="For example, daughter" /></label><label>Phone (optional)<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="off" /></label><button className="setup-small-button" onClick={addContact}>Add person</button></fieldset>
          <div className="setup-selection-list">{draft.contacts.map((contact) => <label key={contact.id}><input type="checkbox" checked={contact.selected} onChange={(event) => setDraft({ ...draft, contacts: draft.contacts.map((item) => item.id === contact.id ? { ...item, selected: event.target.checked } : item) })} /><span><strong>{contact.name}</strong><small>{[contact.relationship, contact.phone].filter(Boolean).join(" · ") || "Select to approve this person"}</small></span></label>)}</div>
          {!draft.contacts.length && <button className="setup-text-button" onClick={() => setDraft({ ...draft, contacts: [{ id: "sample-maya", name: "Maya", relationship: "Daughter", phone: "", selected: false }, { id: "sample-anika", name: "Anika", relationship: "Granddaughter", phone: "", selected: false }] })}>Use sample contacts for this preview</button>}
        </>}

        {!finished && step === 2 && <>
          <p className="setup-intro">Choose the occasions Susan wants to talk about: a family visit, a birthday, or time together.</p>
          <label className="setup-upload"><CalendarDays size={36} strokeWidth={1.5} aria-hidden="true" /><strong>Choose calendar file</strong><span>Exported calendar (.ics) · Up to 1 MB</span><input type="file" accept=".ics,text/calendar" disabled={loading} onChange={(event) => void importFile(event, "calendar")} /></label>
          <p className="setup-hint">Only the events you select will be added. Dates and times are shown as listed in the file. A new file replaces this list.</p>
          <div className="setup-selection-list">{draft.events.map((event) => <label key={event.id}><input type="checkbox" checked={event.selected} onChange={(change) => setDraft({ ...draft, events: draft.events.map((item) => item.id === event.id ? { ...item, selected: change.target.checked } : item) })} /><span><strong>{event.title}</strong><small>{event.date}</small></span></label>)}</div>
          <p className="setup-optional">No calendar to add? You can continue without one.</p>
        </>}

        {!finished && step === 3 && <>
          <p className="setup-intro">Look over these choices with Susan. Nothing is added until you both agree.</p>
          <dl className="setup-review-list"><div><dt>Photos</dt><dd>{draft.photos.length} chosen <button onClick={() => move(0)}>Edit photos</button></dd></div><div><dt>Approved people</dt><dd>{selectedContacts.map((contact) => contact.name).join(", ") || "None chosen yet"} <button onClick={() => move(1)}>Edit people</button></dd></div><div><dt>Calendar events</dt><dd>{selectedEvents.length} chosen <button onClick={() => move(2)}>Edit events</button></dd></div><div><dt>Photo permissions</dt><dd>{Object.entries(permissionNames).filter(([key]) => draft.permissions[key as keyof typeof permissionNames]).map(([, label]) => label).join(", ") || "No photo analysis selected"}</dd></div></dl>
          <fieldset className="setup-call-window"><legend>When would Susan like a call?</legend><p>Choose a familiar time that suits her.</p><div className="setup-days">{weekdays.map((day) => <label key={day}><input type="checkbox" checked={draft.days.includes(day)} onChange={(event) => setDraft({ ...draft, days: event.target.checked ? [...draft.days, day] : draft.days.filter((item) => item !== day) })} />{day}</label>)}</div><div className="setup-time-row"><label>From<input type="time" value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} required /></label><label>Until<input type="time" value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} required /></label></div><p className="setup-hint">Local time on Susan’s phone. Calling is not connected in this preview.</p></fieldset>
          <label className="setup-agreement"><input type="checkbox" checked={draft.agreed} onChange={(event) => setDraft({ ...draft, agreed: event.target.checked })} /><span>Susan and I have agreed to these selections and calling times.</span></label>
        </>}
        {loading && <p role="status" className="setup-hint">Reading your file…</p>}
        {error && <p className="setup-error" role="alert">{error}</p>}
        {!finished && <footer className="setup-actions">{step > 0 && <button className="recall-button recall-secondary" onClick={() => move(step - 1)}><ArrowLeft aria-hidden="true" />Back</button>}<button className="recall-button recall-primary" disabled={loading} onClick={() => step === 3 ? finish() : move(step + 1)}>{step === 3 ? "Save setup preview" : "Continue"}<ArrowRight aria-hidden="true" /></button></footer>}
        {finished && <div className="setup-complete"><p>Your selected photos, people, events, and calling times are saved in this preview until you refresh.</p><p>No files have been uploaded and no calls have been scheduled.</p><Link href="/caregiver" className="recall-button recall-primary">Open caregiver view<ArrowRight aria-hidden="true" /></Link><button className="setup-text-button" onClick={() => { setFinished(false); setStep(3); }}>Review selections again</button></div>}
      </main>
      <div className="setup-preview-nav"><PreviewNav /></div>
    </div>
  </RecallFrame>;
}
