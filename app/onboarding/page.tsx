"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, ImagePlus, Upload, X } from "lucide-react";
import { RecallFrame, RecallHeader } from "@/components/recall/RecallFrame";
import { PreviewNav } from "@/components/recall/PreviewNav";
import { LocalPhoto } from "@/components/recall/LocalPhoto";
import { SetupPhoto } from "@/components/recall/SetupPhoto";
import { SampleSessionLauncher } from "@/components/recall/SampleSessionLauncher";
import { usePreview } from "@/components/recall/PreviewProvider";
import { samplePhotos, sampleContacts, sampleEvents } from "@/fixtures/preview/family-library";
import { parseCalendar, parseContacts, reviseSetup, setupValidationError, type SetupSelections } from "@/lib/recall-preview/imports";
import "../onboarding-library.css";

const steps = ["Photos", "People", "Calendar", "Review"];
const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const permissionNames = { faces: "Group recurring faces", places: "Use places in photos", dates: "Use photo dates", themes: "Find recurring activities" };
const sampleDate = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
const hasSampleSelections = (value: SetupSelections) => Boolean(value.samplePhotos?.length || value.contacts.some((contact) => sampleContacts.some((sample) => sample.id === contact.id)) || value.events.some((event) => sampleEvents.some((sample) => sample.id === event.id)));
const withSampleCandidates = (value: SetupSelections): SetupSelections => ({
  ...value,
  contacts: [...value.contacts, ...sampleContacts.filter((sample) => !value.contacts.some((contact) => contact.id === sample.id)).map((sample) => ({ ...sample, selected: false }))],
  events: [...value.events, ...sampleEvents.filter((sample) => !value.events.some((event) => event.id === sample.id)).map((sample) => ({ ...sample, selected: false }))],
});

export default function OnboardingPage() {
  const { setup, setSetup } = usePreview();
  const [draft, setDraft] = useState<SetupSelections>(() => hasSampleSelections(setup) ? withSampleCandidates(setup) : setup);
  const [sampleLoaded, setSampleLoaded] = useState(hasSampleSelections(setup));
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
  const update = (changes: Partial<Omit<SetupSelections, "agreed">>) => setDraft((current) => reviseSetup(current, changes));
  const selectedSamples = draft.samplePhotos ?? [];
  const photoCount = draft.photos.length + selectedSamples.length;
  const photoAlbums = [...new Set(samplePhotos.map((photo) => photo.metadata.album))];
  const hasSampleContacts = draft.contacts.some((contact) => sampleContacts.some((sample) => sample.id === contact.id));
  const hasSampleEvents = draft.events.some((event) => sampleEvents.some((sample) => sample.id === event.id));

  const loadSamples = () => {
    setDraft((current) => reviseSetup(withSampleCandidates(current), {}));
    setSampleLoaded(true); setError("");
  };
  const toggleSample = (id: string, selected: boolean) => {
    const photo = samplePhotos.find((sample) => sample.id === id);
    if (!photo) return;
    if (selected && photoCount >= 12) { setError("Start with up to 12 photos. Remove a photo to choose another."); return; }
    update({ samplePhotos: selected ? [...selectedSamples, photo] : selectedSamples.filter((sample) => sample.id !== id) });
    setError("");
  };
  const photos = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
      setError("Choose JPG, PNG, or WebP photos. Export other formats as JPG first."); return;
    }
    if (files.some((file) => file.size > 10_000_000)) { setError("Choose photos smaller than 10 MB each."); return; }
    const unique = [...new Map([...draft.photos, ...files].map((file) => [file.name + file.size + file.lastModified, file])).values()];
    if (unique.length + selectedSamples.length > 12) { setError("Start with up to 12 photos. Remove a photo to choose another."); return; }
    update({ photos: unique }); setError("");
  };
  const importFile = async (event: ChangeEvent<HTMLInputElement>, kind: "contacts" | "calendar") => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    if (file.size > 1_000_000) { setError("Choose a file smaller than 1 MB."); return; }
    setLoading(true); setError("");
    try {
      const text = await file.text();
      if (kind === "contacts") update({ contacts: parseContacts(text, file.name.toLowerCase().endsWith(".vcf") ? "vcf" : "csv") });
      else update({ events: parseCalendar(text) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "This file could not be read. Choose another file.");
    } finally { setLoading(false); }
  };
  const addContact = () => {
    if (!name.trim()) { setError("Enter a name to add this person."); return; }
    update({ contacts: [...draft.contacts, { id: "manual-" + Date.now(), name: name.trim(), phone: phone.trim(), relationship: relationship.trim(), selected: false }] });
    setName(""); setPhone(""); setRelationship(""); setError("");
  };
  const finish = () => {
    const validation = setupValidationError(draft);
    if (validation) { setError(validation); return; }
    setSetup({ ...draft, contacts: draft.contacts.filter((contact) => contact.selected), events: draft.events.filter((event) => event.selected) });
    setFinished(true); setError("");
  };
  const selectedContacts = draft.contacts.filter((contact) => contact.selected);
  const selectedEvents = draft.events.filter((event) => event.selected);
  return <RecallFrame family>
    <div className="recall-preview-label">Local setup <span>· Selections stay in this browser tab</span></div>
    <div className="recall-family-shell">
      <RecallHeader family compact />
      <main className="recall-onboarding">
        <Link className="setup-back" href="/caregiver"><ArrowLeft size={18} aria-hidden="true" />Caregiver view</Link>
        {!finished && <ol className="setup-steps" aria-label="Setup steps">{steps.map((label, index) => <li key={label}><button aria-current={step === index ? "step" : undefined} onClick={() => move(index)}><span>{index + 1}</span>{label}</button></li>)}</ol>}
        <h1 ref={titleRef} tabIndex={-1}>{finished ? "Ready to explore together." : ["Start with familiar photos.", "Bring her people closer.", "Make room for familiar moments.", "Set this up together."][step]}</h1>

        {!finished && step === 0 && <>
          <p className="setup-intro">Choose a few photos Susan would enjoy talking about. You’ll decide what Recall can use.</p>
          {!sampleLoaded ? <section className="setup-sample-entry" aria-label="Explore the sample family">
            <p>See how setup works with Susan’s fictional family: photos, people, and a few familiar occasions.</p>
            <button className="setup-small-button" onClick={loadSamples}>Explore with sample data<ArrowRight size={20} aria-hidden="true" /></button>
            <span>No contacts or events are selected for you.</span>
          </section> : <p className="setup-sample-notice" role="status">Sample library open. The people, images, and photo metadata are fictional. Choose what to include.</p>}
          {sampleLoaded && <>
            <div className="setup-library-heading"><h2>From Maya’s sample library</h2><span>{selectedSamples.length} selected</span></div>
            <div className="setup-library-albums">{photoAlbums.map((album, albumIndex) => <details className="setup-library-album" key={album} open={albumIndex === 0}>
              <summary><span>{album}</span><small>{selectedSamples.filter((photo) => photo.metadata.album === album).length} of {samplePhotos.filter((photo) => photo.metadata.album === album).length} selected</small></summary>
              <div className="setup-library-grid">{samplePhotos.filter((photo) => photo.metadata.album === album).map((photo) => <article className="setup-library-photo" key={photo.id} data-selected={selectedSamples.some((sample) => sample.id === photo.id)}>
              <label className="setup-library-choice">
                <SetupPhoto photo={photo} />
                <span className="setup-library-title"><input type="checkbox" aria-label={photo.name} checked={selectedSamples.some((sample) => sample.id === photo.id)} onChange={(event) => toggleSample(photo.id, event.target.checked)} /><strong>{photo.name}</strong></span>
                <span className="setup-library-caption">{photo.metadata.placeLabel} · {photo.metadata.approximateYear ? `Around ${photo.metadata.approximateYear}` : sampleDate(photo.metadata.capturedAt)}</span>
              </label>
              <details className="setup-photo-details"><summary>Photo details</summary><dl>
                <div><dt>Contributed by</dt><dd>{photo.metadata.contributor}</dd></div>
                <div><dt>Album</dt><dd>{photo.metadata.album}</dd></div>
                {photo.metadata.fileName && <div><dt>File name</dt><dd>{photo.metadata.fileName}</dd></div>}
                <div><dt>{photo.metadata.acquisition === "photographed_print" ? "Print digitized" : "Photo date"}</dt><dd>{sampleDate(photo.metadata.capturedAt)}</dd></div>
                <div><dt>Camera</dt><dd>{photo.metadata.device}</dd></div>
                <div><dt>Dimensions</dt><dd>{photo.metadata.dimensions.width} × {photo.metadata.dimensions.height}</dd></div>
                {(photo.metadata.mimeType || photo.metadata.bytes) && <div><dt>File</dt><dd>{[photo.metadata.mimeType?.replace("image/", "").toUpperCase(), photo.metadata.bytes ? `${(photo.metadata.bytes / 1_000_000).toFixed(1)} MB` : ""].filter(Boolean).join(" · ")}</dd></div>}
                {photo.metadata.lens && <div><dt>Lens</dt><dd>{photo.metadata.lens}{photo.metadata.focalLengthMm ? ` · ${photo.metadata.focalLengthMm} mm` : ""}{photo.metadata.iso ? ` · ISO ${photo.metadata.iso}` : ""}</dd></div>}
                {!!photo.metadata.people?.length && <div><dt>People named by {photo.metadata.contributor}</dt><dd>{photo.metadata.people.join(", ")}</dd></div>}
                <div><dt>Family caption</dt><dd>{photo.metadata.caption}</dd></div>
              </dl><p>{photo.metadata.source || "Simulated metadata, not extracted from a real iPhone."} Places and names are supplied by the contributor, never inferred.</p></details>
            </article>)}</div></details>)}</div>
          </>}
          <div className="setup-own-photos">
            {sampleLoaded && <h2>Or choose your own photos</h2>}
            <label className="setup-upload"><ImagePlus size={36} strokeWidth={1.5} aria-hidden="true" /><strong>Choose photos</strong><span>JPG, PNG, or WebP · Up to 12 photos total</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={photos} /></label>
            <p className="setup-hint">Local photos stay on this device. This preview does not read their location, faces, or camera metadata.</p>
          </div>
          {draft.photos.length > 0 && <div className="setup-photo-grid">{draft.photos.map((file, index) => <figure key={file.name + index}><LocalPhoto file={file} /><figcaption>{file.name}</figcaption><button aria-label={"Remove " + file.name} onClick={() => update({ photos: draft.photos.filter((_, i) => i !== index) })}><X size={20} aria-hidden="true" /></button></figure>)}</div>}
          <fieldset className="setup-permissions"><legend>What may Recall look for?</legend><p>Choose each permission together. You name the people. Recall won’t guess who a face belongs to.</p>{Object.entries(permissionNames).map(([key, label]) => <label key={key}><input type="checkbox" checked={draft.permissions[key as keyof typeof permissionNames]} onChange={(event) => update({ permissions: { ...draft.permissions, [key]: event.target.checked } })} />{label}</label>)}<p className="setup-hint">These choices describe what may be used. Photo analysis is not connected in this preview.</p></fieldset>
        </>}

        {!finished && step === 1 && <>
          <p className="setup-intro">Select the people Susan wants included. A name in a contacts file is not permission to add them.</p>
          {hasSampleContacts && <p className="setup-sample-notice">Sample contacts are fictional. Relationships were supplied by Maya for this example; Recall did not infer them.</p>}
          {!!draft.contacts.length && <p className="setup-selection-count" role="status">{selectedContacts.length} of {draft.contacts.length} people selected</p>}
          <div className="setup-selection-list">{draft.contacts.map((contact) => <label key={contact.id}><input type="checkbox" checked={contact.selected} onChange={(event) => update({ contacts: draft.contacts.map((item) => item.id === contact.id ? { ...item, selected: event.target.checked } : item) })} /><span><strong>{contact.name}</strong><small>{[contact.relationship, contact.phone].filter(Boolean).join(" · ") || "Select to approve this person"}</small>{contact.detail && <small>{contact.detail}</small>}{contact.source && <small>{contact.source}</small>}</span></label>)}</div>
          <div className="setup-other-source"><label className="setup-import-button"><Upload size={20} aria-hidden="true" />Choose contacts file<input type="file" accept=".vcf,.csv" disabled={loading} onChange={(event) => void importFile(event, "contacts")} /></label><p className="setup-hint">vCard (.vcf), or CSV with Name, Phone and Relationship columns. Importing a file replaces the list above. Choose only contacts you want to review.</p></div>
          <details className="setup-manual-entry"><summary>Or add one person by name</summary><fieldset className="setup-person-form"><legend>Add a person</legend><label>Name<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" placeholder="For example, Maya" /></label><label>Relationship<input value={relationship} onChange={(event) => setRelationship(event.target.value)} autoComplete="off" placeholder="For example, daughter" /></label><label>Phone (optional)<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="off" /></label><button className="setup-small-button" onClick={addContact}>Add to the review list</button></fieldset></details>
          {!draft.contacts.length && <button className="setup-text-button" onClick={loadSamples}>Explore with sample people and events</button>}
        </>}

        {!finished && step === 2 && <>
          <p className="setup-intro">Choose the occasions Susan wants to talk about: a family visit, a birthday, or time together.</p>
          {hasSampleEvents && <p className="setup-sample-notice">The sample occasions come from a fictional family calendar. Select only the ones Susan wants included.</p>}
          {!!draft.events.length && <p className="setup-selection-count" role="status">{selectedEvents.length} of {draft.events.length} occasions selected</p>}
          <div className="setup-selection-list">{draft.events.map((event) => <label key={event.id}><input type="checkbox" checked={event.selected} onChange={(change) => update({ events: draft.events.map((item) => item.id === event.id ? { ...item, selected: change.target.checked } : item) })} /><span><strong>{event.title}</strong><small>{event.date}</small>{event.detail && <small>{event.detail}</small>}{event.source && <small>{event.source}</small>}</span></label>)}</div>
          <div className="setup-other-source"><label className="setup-upload"><CalendarDays size={36} strokeWidth={1.5} aria-hidden="true" /><strong>Choose calendar file</strong><span>Exported calendar (.ics) · Up to 1 MB</span><input type="file" accept=".ics,text/calendar" disabled={loading} onChange={(event) => void importFile(event, "calendar")} /></label><p className="setup-hint">Only selected events are included. Dates and times are shown as listed in the file. A new file replaces this list.</p></div>
          <p className="setup-optional">No calendar to add? You can continue without one.</p>
        </>}

        {!finished && step === 3 && <>
          <p className="setup-intro">Look over these choices with Susan. Save only what you both agree to include.</p>
          <dl className="setup-review-list"><div><dt>Photos</dt><dd>{photoCount} chosen{selectedSamples.length > 0 && <span className="setup-review-photo-names">{selectedSamples.map((photo) => photo.name).join(", ")}</span>}<button onClick={() => move(0)}>Edit photos</button></dd></div><div><dt>Approved people</dt><dd>{selectedContacts.map((contact) => contact.name).join(", ") || "None chosen yet"} <button onClick={() => move(1)}>Edit people</button></dd></div><div><dt>Calendar events</dt><dd>{selectedEvents.length ? selectedEvents.map((event) => event.title).join(", ") : "None chosen"} <button onClick={() => move(2)}>Edit events</button></dd></div><div><dt>Photo permissions</dt><dd>{Object.entries(permissionNames).filter(([key]) => draft.permissions[key as keyof typeof permissionNames]).map(([, label]) => label).join(", ") || "No photo analysis selected"}<button onClick={() => move(0)}>Edit permissions</button></dd></div></dl>
          <fieldset className="setup-call-window"><legend>When would Susan like a call?</legend><p>Choose a familiar time that suits her. Mornings are a starting point.</p><div className="setup-days">{weekdays.map((day) => <label key={day}><input type="checkbox" checked={draft.days.includes(day)} onChange={(event) => update({ days: event.target.checked ? [...draft.days, day] : draft.days.filter((item) => item !== day) })} />{day}</label>)}</div><div className="setup-time-row"><label>From<input type="time" value={draft.start} onChange={(event) => update({ start: event.target.value })} required /></label><label>Until<input type="time" value={draft.end} onChange={(event) => update({ end: event.target.value })} required /></label></div><p className="setup-hint">Local time on Susan’s phone. No calls are placed or scheduled from this setup.</p></fieldset>
          <label className="setup-agreement"><input type="checkbox" checked={draft.agreed} onChange={(event) => setDraft({ ...draft, agreed: event.target.checked })} /><span>Susan and I have reviewed and agreed to these selections and calling times.</span></label>
          <p className="setup-hint">Changing any selection clears this agreement so you can review it together again.</p>
        </>}
        {loading && <p role="status" className="setup-hint">Reading your file…</p>}
        {error && <p className="setup-error" role="alert">{error}</p>}
        {!finished && <footer className="setup-actions">{step > 0 && <button className="recall-button recall-secondary" onClick={() => move(step - 1)}><ArrowLeft aria-hidden="true" />Back</button>}<button className="recall-button recall-primary" disabled={loading} onClick={() => step === 3 ? finish() : move(step + 1)}>{step === 3 ? "Save these selections" : "Continue"}<ArrowRight aria-hidden="true" /></button></footer>}
        {finished && <div className="setup-complete"><p>{photoCount} {photoCount === 1 ? "photo" : "photos"}, {selectedContacts.length} {selectedContacts.length === 1 ? "person" : "people"}, and {selectedEvents.length} {selectedEvents.length === 1 ? "occasion" : "occasions"} are ready in this browser tab.</p><p>Explore a sample conversation with a selected photo, then open the caregiver view. Nothing has been uploaded, and no real call will start.</p><SampleSessionLauncher compact /><Link href="/caregiver" className="recall-button recall-secondary">Open caregiver view<ArrowRight aria-hidden="true" /></Link><p className="setup-hint">Selections are cleared when you refresh this page. Real setup and calling are not connected yet.</p><button className="setup-text-button" onClick={() => { setFinished(false); setStep(3); }}>Review selections again</button></div>}
      </main>
      <div className="setup-preview-nav"><PreviewNav /></div>
    </div>
  </RecallFrame>;
}
