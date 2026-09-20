"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, AudioLines, Images, MapPin, Plus, Search, Users } from "lucide-react";
import type { ArchiveView, Moment } from "@/lib/archive/types";
import { api } from "@/client/api";
import { MemoryGraph } from "./MemoryGraph";
import { MomentDetail } from "./MomentDetail";
import { UploadFlow } from "./UploadFlow";
import { KnowledgeReview } from "@/components/live/KnowledgeReview";
import "@/app/family-archive.css";
const MemoryMap = dynamic(() => import("./MemoryMap").then((module) => module.MemoryMap), { ssr: false, loading: () => <p role="status">Opening your places…</p> });
export type ArchiveSection = "moments" | "places" | "connections" | "stories";
const readableDate = (date: string | null) => date && !Number.isNaN(Date.parse(date)) ? new Date(date.length === 10 ? `${date}T12:00:00Z` : date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "Date to be added";

export function FamilyArchive({ member, name, view, version, uploadRequest, onChanged, canManage, contribution }: { member: string; name: string; view: ArchiveSection; version: number; uploadRequest: number; onChanged: () => void; canManage: boolean; contribution: ReactNode }) {
  const [loaded, setLoaded] = useState<{ member: string; data: ArchiveView } | null>(null);
  const data = loaded?.member === member ? loaded.data : null;
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [withStory, setWithStory] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [upload, setUpload] = useState(false);
  const [toast, setToast] = useState("");
  const reduced = useReducedMotion();
  const refresh = useCallback(async () => {
    const next = await api<ArchiveView>(`/api/family/library?member=${encodeURIComponent(member)}`);
    setLoaded({ member, data: next }); setError("");
    return next;
  }, [member]);
  useEffect(() => {
    const controller = new AbortController();
    api<ArchiveView>(`/api/family/library?member=${encodeURIComponent(member)}`, { signal: controller.signal })
      .then((next) => { if (!controller.signal.aborted) { setLoaded({ member, data: next }); setError(""); } })
      .catch((e) => { if (!controller.signal.aborted) { setLoaded(null); setError(e instanceof Error ? e.message : "Your collection could not be loaded. Please reload."); } });
    return () => controller.abort();
  }, [member, version]);
  useEffect(() => { if (uploadRequest) setUpload(true); }, [uploadRequest]);
  const active = data?.moments.find((moment) => moment.id === activeId);
  const selected = (moment: Moment) => setActiveId(moment.id);
  const moments = data?.moments.filter((moment) => [moment.title, moment.place, ...moment.people].join(" ").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) && (!withStory || data.stories.some((story) => story.eventId === moment.id))) ?? [];
  async function saved(id: string) {
    await refresh(); onChanged(); setUpload(false); setActiveId(id); setToast("Your moment was saved.");
  }
  return <div className="family-archive">
    {error && <div className="archive-error" role="alert"><p>{error}</p><button className="care-text-action" onClick={() => void refresh().catch((e) => setError(e.message))}>Reload collection</button></div>}
    {!data && !error && <p role="status">Opening your collection…</p>}
    {data && <>
      <div hidden={view !== "moments"} className="archive-moments-view">
        <div className="archive-collection-toolbar"><div className="archive-collection-tabs" role="group" aria-label="Filter moments"><button aria-pressed={!withStory} onClick={() => setWithStory(false)}>All moments<span>{data.moments.length}</span></button><button aria-pressed={withStory} onClick={() => setWithStory(true)}>With a story<span>{new Set(data.stories.map((story) => story.eventId)).size}</span></button></div>{data.moments.length > 0 && <label className="archive-search"><Search size={20} aria-hidden="true" /><input aria-label="Find in your contributions" placeholder="Find a person or place" value={search} onChange={(event) => setSearch(event.target.value)} /></label>}</div>
        <div className="care-memories-view">
          <div>{data.moments.length ? <div className="archive-moment-grid">{moments.map((moment, index) => {
            const photo = data.photos.find((item) => item.id === moment.coverId);
            const story = data.stories.some((item) => item.eventId === moment.id);
            return <motion.button className="archive-moment-card" key={moment.id} onClick={() => selected(moment)} initial={reduced ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .32, delay: Math.min(index, 6) * .035, ease: [.16, 1, .3, 1] }}>
              {photo ? <div className="archive-moment-photo"><img src={photo.url} alt={photo.caption || moment.title} loading="lazy" /><span className="archive-photo-count"><Images size={18} aria-hidden="true" />{moment.photoIds.length} {moment.photoIds.length === 1 ? "photo" : "photos"}</span></div> : <div className="archive-written-cover"><AudioLines size={28} aria-hidden="true" /><span>A moment in your words</span></div>}
              <div className="archive-moment-info"><p className="archive-moment-date">{readableDate(moment.startAt)}</p><h2>{moment.title}</h2>{moment.place && <p className="archive-location"><MapPin size={18} aria-hidden="true" />{moment.place}</p>}<div className="archive-moment-footer"><span className="archive-avatar-stack" aria-hidden="true">{moment.people.slice(0, 3).map((person) => <span key={person}>{person[0]}</span>)}</span><span>{moment.people.length ? moment.people.slice(0, 2).join(" & ") : "Add the people who were there"}</span></div><p className="archive-story-status">{story ? <AudioLines size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}{story ? "Your story saved" : "A story to add"}<ArrowRight size={20} aria-hidden="true" /></p></div>
            </motion.button>;
          })}{moments.length === 0 && <p className="archive-no-results">No moments match your search. <button className="care-text-action" onClick={() => { setSearch(""); setWithStory(false); }}>Show all moments</button></p>}<button className="archive-add-card" onClick={() => setUpload(true)}><Plus size={28} aria-hidden="true" /><strong>There’s more to the story.</strong><span>Add a few photos. Keep the details together.</span></button></div> : <section className="archive-empty"><Images size={40} aria-hidden="true" /><h2>Start with a handful of photographs.</h2><p>Add a moment you shared. Then give it the names, places, and words only you can add.</p><button className="care-action care-action-primary" onClick={() => setUpload(true)}><Plus size={20} />Add your first moment</button></section>}</div>
          <div className="archive-collection-aside">{contribution}<div className="archive-collection-note"><Users size={24} aria-hidden="true" /><h3>A little closer, together.</h3><p>A photo can be the beginning of a conversation. Make time to hear their story, too.</p></div></div>
        </div>
      </div>
      {view === "places" && <MemoryMap moments={data.moments} photos={data.photos} onSelect={selected} />}
      {view === "connections" && <><MemoryGraph moments={data.moments} photos={data.photos} stories={data.stories} onSelect={selected} /><KnowledgeReview member={member} refreshKey={String(version)} /></>}
      {view === "stories" && <section className="archive-stories">{data.stories.length ? data.stories.map((story) => {
        const moment = data.moments.find((item) => item.id === story.eventId);
        const photo = data.photos.find((item) => item.id === moment?.coverId);
        return <article key={story.id}>{photo && <img src={photo.url} alt={moment?.title ?? "Contributed photograph"} loading="lazy" />}<div><h2>{moment?.title ?? "A family memory"}</h2><p className="archive-literal-story">{story.text}</p><p className="care-caption">{story.author} · {readableDate(story.createdAt)}</p>{story.audioUrl && <audio controls preload="none" src={story.audioUrl} aria-label={`Original recording by ${story.author}`} />}{moment && <button className="care-text-action" onClick={() => selected(moment)}>Open the moment<ArrowRight size={20} /></button>}</div></article>;
      }) : <div className="archive-empty"><AudioLines size={36} aria-hidden="true" /><h2>A photograph is just the beginning.</h2><p>Add a memory in your own words. Your voice and attribution stay with it.</p><button className="care-action care-action-primary" onClick={() => setUpload(true)}>Add a moment<Plus size={20} /></button></div>}</section>}
    </>}
    {toast && <p className="archive-inline-status" role="status">{toast}<button onClick={() => setToast("")} className="care-text-action">Dismiss</button></p>}
    <AnimatePresence mode="wait">{upload ? <UploadFlow key="upload" member={member} name={name} onClose={() => setUpload(false)} onSaved={saved} /> : active && data ? <MomentDetail key={active.id} moment={active} archive={data} member={member} name={name} canManage={canManage} onClose={() => setActiveId(null)} onRefresh={async () => { const next = await refresh(); onChanged(); return next; }} /> : null}</AnimatePresence>
  </div>;
}
