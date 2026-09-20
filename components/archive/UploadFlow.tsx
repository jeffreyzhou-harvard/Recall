"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, ImagePlus, MapPin, Plus, Upload, X } from "lucide-react";
import { api } from "@/client/api";
import { ArchiveDialog } from "./ArchiveDialog";
const PlacePicker = dynamic(() => import("./MemoryMap").then((module) => module.PlacePicker), { ssr: false });

type ChosenPhoto = { id: string; file: File; url: string; assetId?: string; error?: string };
export function UploadFlow({ member, name, onClose, onSaved }: { member: string; name: string; onClose: () => void; onSaved: (id: string) => Promise<void> }) {
  const [photos, setPhotos] = useState<ChosenPhoto[]>([]);
  const [title, setTitle] = useState("");
  const [people, setPeople] = useState("");
  const [place, setPlace] = useState("");
  const [date, setDate] = useState("");
  const [text, setText] = useState("");
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);
  const requestId = useRef(crypto.randomUUID());
  const reduced = useReducedMotion();
  useEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), []);
  function choose(files: FileList | File[]) {
    const selected = Array.from(files);
    const usable = selected.filter((file) => ["image/jpeg", "image/png"].includes(file.type) && file.size <= 6_000_000);
    if (usable.length !== selected.length) setError("Choose JPEG or PNG photos up to 6 MB each. Export HEIC photos as JPEG first.");
    else setError("");
    setPhotos((existing) => {
      const incoming = usable.filter((file) => !existing.some((photo) => photo.file.name === file.name && photo.file.size === file.size && photo.file.lastModified === file.lastModified));
      const next = incoming.slice(0, Math.max(0, 20 - existing.length)).map((file) => { const url = URL.createObjectURL(file); urls.current.push(url); return { id: crypto.randomUUID(), file, url }; });
      return [...existing, ...next];
    });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError("");
    try {
      const assetIds: string[] = [];
      for (const [index, photo] of photos.entries()) {
        setStage(`Saving photo ${index + 1} of ${photos.length}`);
        if (photo.assetId) { assetIds.push(photo.assetId); continue; }
        const response = await fetch(`/api/family/media?member=${encodeURIComponent(member)}`, { method: "POST", headers: { "Content-Type": photo.file.type }, body: photo.file });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `${photo.file.name} could not be uploaded.`);
        assetIds.push(result.asset_id);
        setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, assetId: result.asset_id } : item));
      }
      setStage("Bringing this moment together");
      const result = await api<{ moment_id: string }>("/api/family/library", { method: "POST", body: JSON.stringify({ member, action: "create", request_id: requestId.current, title: title.trim(), people: people.split(",").map((p) => p.trim()).filter(Boolean), place: place.trim() || null, date: date || null, latitude: coordinates?.latitude ?? null, longitude: coordinates?.longitude ?? null, asset_ids: assetIds, text: text.trim() }) });
      await onSaved(result.moment_id);
    } catch (e) { setError(e instanceof Error ? e.message : "This moment could not be saved. Your selections are still here."); }
    finally { setPending(false); setStage(""); }
  }
  return <ArchiveDialog title="Add a moment" onClose={onClose} busy={pending}>
    <div className="archive-dialog-body">
      <h2>Bring a moment together.</h2>
      <p>A few photographs. The details you know. Your own words.</p>
      {pending ? <div className="archive-import-state" role="status" aria-live="polite">
        <div className="archive-photo-orbit">{photos.slice(0, 7).map((photo, i) => <motion.img key={photo.id} src={photo.url} alt="" initial={reduced ? false : { opacity: 0, x: 0, y: 0, rotate: 0 }} animate={{ opacity: 1, x: Math.cos(i / Math.max(1, Math.min(photos.length, 7)) * Math.PI * 2) * 85, y: Math.sin(i / Math.max(1, Math.min(photos.length, 7)) * Math.PI * 2) * 40, rotate: reduced ? 0 : (i % 2 ? 1 : -1) * (5 + i) }} transition={{ duration: reduced ? 0 : .5, delay: reduced ? 0 : i * .04 }} />)}{!photos.length && <ImagePlus size={40} aria-hidden="true" />}</div>
        <p>{stage}</p><span className="care-caption">Your contribution keeps your name.</span>
      </div> : <form className="archive-form" onSubmit={save}>
        <p className="care-caption">Contributing as {name}</p>
        <button className={`archive-dropzone${dragging ? " is-dragging" : ""}`} type="button" onClick={() => fileInput.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files); }}><Upload size={30} aria-hidden="true" /><strong>Choose photos, or drop them here</strong><span>Up to 20 JPEG or PNG photos · 6 MB each</span></button>
        <input ref={fileInput} type="file" multiple hidden accept="image/jpeg,image/png" onChange={(event) => { if (event.target.files) choose(event.target.files); event.target.value = ""; }} />
        {photos.length > 0 && <div className="archive-upload-previews">{photos.map((photo) => <div key={photo.id}><img src={photo.url} alt={photo.file.name} /><button type="button" onClick={() => setPhotos((items) => items.filter((item) => item.id !== photo.id))} aria-label={`Remove ${photo.file.name}`}><X size={18} /></button>{photo.assetId && <Check className="archive-upload-saved" size={20} aria-label="Uploaded" />}</div>)}</div>}
        <label>A name for this moment<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="An afternoon at the beach" maxLength={80} required /><span>A short title, up to eight words.</span></label>
        <label>What do you remember?<textarea value={text} onChange={(event) => setText(event.target.value)} rows={4} maxLength={2000} required /></label>
        <div className="archive-field-pair"><label>Who was there? <span>Optional</span><input value={people} onChange={(event) => setPeople(event.target.value)} placeholder="Names, separated by commas" maxLength={300} /></label><label>When? <span>Optional</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label></div>
        <label>Where? <span>Optional</span><input value={place} onChange={(event) => { setPlace(event.target.value); setCoordinates(null); }} placeholder="A town or familiar place" maxLength={80} /></label>
        {place.trim() && <details className="archive-place-picker"><summary><MapPin size={20} aria-hidden="true" />Add a pin to the map</summary><p>Choose the place this moment happened. A town or landmark is enough.</p><PlacePicker latitude={coordinates?.latitude ?? null} longitude={coordinates?.longitude ?? null} onChange={(latitude, longitude) => setCoordinates({ latitude, longitude })} />{coordinates && <button type="button" className="care-text-action" onClick={() => setCoordinates(null)}>Remove pin</button>}</details>}
        <p className="care-caption">People and places come from what you enter. Photo location metadata is not imported.</p>
        <div className="care-form-actions"><button className="care-action care-action-primary" disabled={!title.trim() || !text.trim()}><Plus size={20} aria-hidden="true" />Save moment</button><button className="care-text-action" type="button" onClick={onClose}>Cancel</button></div>
      </form>}
      {error && <p className="archive-error" role="alert">{error}</p>}
    </div>
  </ArchiveDialog>;
}
