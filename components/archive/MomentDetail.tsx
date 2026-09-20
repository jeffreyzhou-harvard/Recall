"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, MapPin, Mic, Pencil, ShieldCheck, Users } from "lucide-react";
import type { ArchiveView, Moment } from "@/lib/archive/types";
import { api } from "@/client/api";
import { Microphone } from "@/client/microphone";
import { ArchiveDialog } from "./ArchiveDialog";
const PlacePicker = dynamic(() => import("./MemoryMap").then((module) => module.PlacePicker), { ssr: false });
const readableDate = (value: string | null) => value && !Number.isNaN(Date.parse(value)) ? new Date(value.length === 10 ? `${value}T12:00:00Z` : value).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "Date not added";

export function MomentDetail({ moment, archive, member, name, canManage, onClose, onRefresh }: { moment: Moment; archive: ArchiveView; member: string; name: string; canManage: boolean; onClose: () => void; onRefresh: () => Promise<ArchiveView> }) {
  const [mode, setMode] = useState<"detail" | "edit" | "photo">("detail");
  const [photoIndex, setPhotoIndex] = useState(0);
  const [title, setTitle] = useState(moment.title);
  const [people, setPeople] = useState(moment.people.join(", "));
  const [place, setPlace] = useState(moment.place ?? "");
  const [date, setDate] = useState(moment.startAt?.slice(0, 10) ?? "");
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number } | null>(moment.latitude !== null && moment.longitude !== null ? { latitude: moment.latitude, longitude: moment.longitude } : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [writing, setWriting] = useState(false);
  const [story, setStory] = useState("");
  const [audio, setAudio] = useState<{ id: string; url: string } | null>(null);
  const [played, setPlayed] = useState(false);
  const [recording, setRecording] = useState(false);
  const mic = useRef<Microphone | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const photos = moment.photoIds.map((id) => archive.photos.find((photo) => photo.id === id)).filter((photo) => !!photo);
  const cover = photos.find((photo) => photo.id === moment.coverId) ?? photos[0];
  const stories = archive.stories.filter((item) => item.eventId === moment.id);
  useEffect(() => () => { mic.current?.close(); mic.current = null; }, []);
  async function uploadAudio(bytes: Blob | Uint8Array) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/family/media?member=${encodeURIComponent(member)}`, { method: "POST", headers: { "Content-Type": "audio/wav" }, body: bytes instanceof Uint8Array ? new Uint8Array(bytes) : bytes });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Your voice note could not be uploaded.");
      setAudio({ id: result.asset_id, url: `/api/family/media?member=${encodeURIComponent(member)}&asset=${encodeURIComponent(result.asset_id)}` });
      setStory(result.transcript ?? ""); setPlayed(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Your recording could not be saved. You can write your memory instead."); }
    finally { setBusy(false); }
  }
  async function record() {
    if (recording) {
      const bytes = mic.current?.finish(); mic.current?.close(); setRecording(false); if (bytes) await uploadAudio(bytes); return;
    }
    const microphone = new Microphone(); mic.current = microphone; setRecording(true); setError("");
    try { await microphone.open(); if (mic.current !== microphone) return; microphone.listen((bytes) => { microphone.close(); setRecording(false); void uploadAudio(bytes); }); }
    catch { microphone.close(); setRecording(false); setError("Microphone access is unavailable. You can write your memory instead."); }
  }
  async function saveDetails(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await api("/api/family/library", { method: "POST", body: JSON.stringify({ member, action: "edit", request_id: requestId.current, moment_id: moment.id, expected_revision: moment.revision, title: title.trim(), people: people.split(",").map((person) => person.trim()).filter(Boolean), place: place.trim() || null, date: date || null, latitude: coordinates?.latitude ?? null, longitude: coordinates?.longitude ?? null, coverId: moment.coverId }) });
      await onRefresh(); requestId.current = crypto.randomUUID(); setMode("detail"); setStatus("Your details were saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "The details could not be saved."); }
    finally { setBusy(false); }
  }
  async function saveStory(event: FormEvent) {
    event.preventDefault(); if (audio && !played) return;
    setBusy(true); setError("");
    try {
      await api("/api/family/library", { method: "POST", body: JSON.stringify({ member, action: "story", request_id: requestId.current, moment_id: moment.id, text: story.trim(), asset_id: audio?.id }) });
      await onRefresh(); requestId.current = crypto.randomUUID(); setWriting(false); setStory(""); setAudio(null); setStatus("Your memory was saved in your own words.");
    } catch (e) { setError(e instanceof Error ? e.message : "Your memory could not be saved."); }
    finally { setBusy(false); }
  }
  return <ArchiveDialog focusKey={mode} title={mode === "photo" ? "Photograph" : moment.title} drawer={mode !== "photo"} busy={busy || recording} onClose={() => mode === "photo" ? setMode("detail") : onClose()}>
    {mode === "photo" ? <div className="archive-lightbox">
      <h2>{moment.title}</h2>
      <img src={photos[photoIndex]?.url} alt={photos[photoIndex]?.caption || `Photo ${photoIndex + 1} from ${moment.title}`} />
      <div className="archive-photo-navigation"><button className="care-action" disabled={photoIndex === 0} onClick={() => setPhotoIndex((index) => index - 1)} aria-label="Previous photograph"><ChevronLeft size={22} /></button><span>{photoIndex + 1} of {photos.length}</span><button className="care-action" disabled={photoIndex >= photos.length - 1} onClick={() => setPhotoIndex((index) => index + 1)} aria-label="Next photograph"><ChevronRight size={22} /></button></div>
      <p className="care-caption">Contributed by {name}</p>
    </div> : mode === "edit" ? <div className="archive-dialog-body">
      <button className="care-text-action" onClick={() => setMode("detail")}><ArrowLeft size={20} />Back to the moment</button>
      <h2>The details you know.</h2>
      <form className="archive-form" onSubmit={saveDetails}><fieldset disabled={busy}>
        <label>Moment name<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} required /></label>
        <label>People<input value={people} onChange={(event) => setPeople(event.target.value)} maxLength={300} /><span>Names, separated by commas. Only name people you know were there.</span></label>
        <label>Date <span>Optional</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>Place <span>Optional</span><input value={place} onChange={(event) => { setPlace(event.target.value); setCoordinates(null); }} maxLength={80} /></label>
        {place.trim() && <details className="archive-place-picker"><summary><MapPin size={20} />{coordinates ? "Change the map pin" : "Add a map pin"}</summary><p>A town or landmark is enough.</p><PlacePicker latitude={coordinates?.latitude ?? null} longitude={coordinates?.longitude ?? null} onChange={(latitude, longitude) => setCoordinates({ latitude, longitude })} />{coordinates && <button type="button" className="care-text-action" onClick={() => setCoordinates(null)}>Remove pin</button>}</details>}
        <p className="care-caption">These details organize your collection. Original accounts used in calls stay unchanged.</p>
        <button className="care-action care-action-primary" disabled={!title.trim() || busy}>{busy ? "Saving…" : "Save details"}</button>
      </fieldset></form>
    </div> : <>
      {cover && <button className="archive-detail-cover" onClick={() => { setPhotoIndex(Math.max(0, photos.findIndex((photo) => photo.id === cover.id))); setMode("photo"); }}><img src={cover.url} alt={cover.caption || moment.title} /><span>View photograph<ArrowRight size={20} aria-hidden="true" /></span></button>}
      <div className="archive-dialog-body">
        <div className="archive-detail-date"><p>{readableDate(moment.startAt)}</p><button className="care-text-action" onClick={() => { setTitle(moment.title); setPeople(moment.people.join(", ")); setPlace(moment.place ?? ""); setDate(moment.startAt?.slice(0, 10) ?? ""); setCoordinates(moment.latitude !== null && moment.longitude !== null ? { latitude: moment.latitude, longitude: moment.longitude } : null); setMode("edit"); }}><Pencil size={18} />Edit collection details</button></div>
        <h2>{moment.title}</h2>
        {moment.place && <p className="archive-location"><MapPin size={20} aria-hidden="true" />{moment.place}</p>}
        {moment.people.length > 0 && <ul className="archive-people" aria-label="People named in this moment">{moment.people.map((person) => <li key={person}><span aria-hidden="true">{person[0]}</span>{person}</li>)}</ul>}
        {photos.length > 1 && <div className="archive-photo-grid">{photos.map((photo, index) => <button key={photo.id} onClick={() => { setPhotoIndex(index); setMode("photo"); }} aria-label={`Open photograph ${index + 1}`}><img src={photo.url} alt={photo.caption || `Photograph ${index + 1}`} loading="lazy" /></button>)}</div>}
        <section className="archive-story-prompt"><h3>What’s outside the frame?</h3><p>The sounds. The inside joke. The detail you remember.</p><button className="care-action care-action-primary" aria-expanded={writing} disabled={busy || recording} onClick={() => setWriting(!writing)}>Add your memory<ArrowRight size={20} /></button></section>
        {writing && <form className="archive-form archive-story-form" onSubmit={saveStory}>
          <label>Your own words<textarea value={story} onChange={(event) => setStory(event.target.value)} rows={5} maxLength={2000} required disabled={busy || recording} /></label>
          <div className="care-form-actions"><button type="button" className="care-action" disabled={busy} onClick={() => void record()}><Mic size={20} />{recording ? "Finish recording" : "Record a voice note"}</button><label className="archive-voice-file">Or choose a WAV file<input type="file" accept="audio/wav,.wav" disabled={busy || recording} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAudio(file); event.target.value = ""; }} /></label></div>
          {recording && <p role="status">Recording your voice. Choose Finish recording when you’re ready.</p>}
          {audio && <div className="archive-audio-review"><p>Listen to your original recording before saving.</p><audio controls src={audio.url} onEnded={() => setPlayed(true)} aria-label="Your original recording" /><button type="button" className="care-text-action" disabled={busy} onClick={() => { setAudio(null); setPlayed(false); }}>Remove recording</button></div>}
          <p className="care-caption">This stays {name}’s account. Nothing is written in someone else’s name.</p>
          <button className="care-action care-action-primary" disabled={busy || recording || !story.trim() || Boolean(audio && !played)}><Check size={20} />{busy ? "Saving…" : "Save my memory"}</button>
        </form>}
        {stories.length > 0 && <section className="archive-detail-stories"><h3>In your own words</h3>{stories.map((item) => <article key={item.id}><p className="archive-literal-story">{item.text}</p><p className="care-caption">{item.author} · {readableDate(item.createdAt)}</p>{item.audioUrl && <audio controls preload="none" src={item.audioUrl} aria-label={`Original recording by ${item.author}`} />}</article>)}</section>}
        <section className="archive-source"><h3>How this moment came together</h3><p><ShieldCheck size={20} aria-hidden="true" /><span>Contributed by {name}. Your original words keep their attribution.</span></p><p><MapPin size={20} aria-hidden="true" /><span>{moment.place ? "Place named by you. Map pins mark a place you selected." : "No place has been added. You can add the details you know."}</span></p><p><Users size={20} aria-hidden="true" /><span>People are named by family, never identified from a face.</span></p></section>
        <section className="archive-family-invite"><h3>Make room for another voice.</h3><p>Call your relative to hear their side of the story.</p>{canManage && <Link className="care-text-action" href="/onboarding/manage">Invite a family contributor<ArrowRight size={20} /></Link>}</section>
      </div>
    </>}
    {error && <p className="archive-error" role="alert">{error}</p>}
    {status && <p className="archive-status" role="status">{status}</p>}
  </ArchiveDialog>;
}
