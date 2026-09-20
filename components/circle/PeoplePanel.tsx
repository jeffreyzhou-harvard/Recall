"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ScanFace, UsersRound, X } from "lucide-react";
import type { FaceDetection, PeopleGroup, PeopleView } from "@/lib/people/types";
import { post, type CircleView } from "./types";
import "./people.css";

export function PeoplePanel({ data, onOpenPhoto }: { data: CircleView; onOpenPhoto: (photoId: string) => void }) {
  const [view, setView] = useState<PeopleView | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string | null>(null), [scanning, setScanning] = useState(false), [busy, setBusy] = useState(false), [confirmClear, setConfirmClear] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, stage: "" });
  const scan = useRef<AbortController | null>(null), mounted = useRef(true);
  const load = useCallback(async () => {
    const response = await fetch("/api/circle/people", { cache: "no-store" });
    const next = await response.json();
    if (!response.ok) throw new Error(next.error || "People could not be opened.");
    if (mounted.current) setView(next);
    return next as PeopleView;
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load().catch(e => { if (mounted.current) setError(e.message); });
    return () => { mounted.current = false; scan.current?.abort(); };
  }, [load]);
  const pending = data.photos.filter(p => !view?.scannedPhotoIds.includes(p.id));
  async function findPeople() {
    if (scan.current || busy) return;
    const controller = new AbortController(); scan.current = controller;
    setScanning(true); setError(""); setNotice(""); setConfirmClear(false);
    const failed: string[] = [];
    try {
      const current = await load(); controller.signal.throwIfAborted();
      const photos = data.photos.filter(p => !current.scannedPhotoIds.includes(p.id));
      setProgress({ done: 0, total: photos.length, stage: "Preparing face detection on this device…" });
      const { prepareFaceDetection, detectPhotoFaces, FACE_MODEL } = await import("@/client/face-detection");
      await prepareFaceDetection(); controller.signal.throwIfAborted();
      let batch: { photoId: string; faces: FaceDetection[] }[] = [];
      for (const [i, photo] of photos.entries()) {
        controller.signal.throwIfAborted();
        setProgress({ done: i, total: photos.length, stage: `Looking for faces · ${i + 1} of ${photos.length} photos` });
        try { batch.push({ photoId: photo.id, faces: await detectPhotoFaces(photo.url, controller.signal) }); }
        catch (e) { if (controller.signal.aborted) throw e; failed.push(photo.name); }
        controller.signal.throwIfAborted();
        if (batch.length >= 8 || (i === photos.length - 1 && batch.length)) {
          const response = await fetch("/api/circle/face-scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: FACE_MODEL, generation: current.generation, photos: batch }), signal: controller.signal });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Face groups could not be saved.");
          if (mounted.current) setView(result);
          batch = [];
        }
        if (mounted.current) setProgress({ done: i + 1, total: photos.length, stage: "Finding people in your photos…" });
      }
      if (mounted.current) setNotice(failed.length ? `${failed.length} ${failed.length === 1 ? "photo couldn’t" : "photos couldn’t"} be checked. Choose Find people to retry them.` : "Photos checked. You can name the groups and correct any matches.");
    } catch (e) {
      if (mounted.current) {
        if (controller.signal.aborted) setNotice("Stopped. Saved groups are here; you can continue later.");
        else setError(e instanceof Error ? e.message : "Face detection could not start. Please try again.");
      }
    } finally {
      scan.current = null;
      if (mounted.current) { setScanning(false); void load().catch(() => {}); }
    }
  }
  async function edit(action: Record<string, unknown>) {
    if (!view || busy || scanning) return;
    setBusy(true); setError("");
    try {
      const next = await post<PeopleView>("people", { ...action, revision: view.revision });
      setView(next); setConfirmClear(false);
      if (action.action === "merge") setSelected(String(action.targetId));
    } catch (e) { setError(e instanceof Error ? e.message : "This change could not be saved."); await load().catch(() => {}); }
    finally { setBusy(false); }
  }
  const group = view?.groups.find(g => g.id === selected);
  return <section className="circle-people" aria-label="People in your photos">
    <div className="circle-people-toolbar">
      <p>Suggested groups of familiar faces. Names come from you.</p>
      {scanning ? <button className="circle-button secondary" onClick={() => scan.current?.abort()}><X size={17} />Stop scanning</button> :
        <button className="circle-button primary" disabled={!view || !pending.length || busy} onClick={() => void findPeople()}><ScanFace size={19} />{view?.scannedPhotoIds.length ? pending.length ? `Find in ${pending.length} new ${pending.length === 1 ? "photo" : "photos"}` : "All photos checked" : "Find people"}</button>}
    </div>
    {scanning && <div className="circle-people-progress" role="status"><p>{progress.stage}</p><progress aria-label="Photos checked" max={Math.max(1, progress.total)} value={progress.done} /></div>}
    {error && <p className="circle-error" role="alert">{error} <button className="circle-text-button" onClick={() => void load().then(() => setError("")).catch(e => setError(e.message))}>Refresh People</button></p>}
    {notice && <p className="circle-people-notice" role="status">{notice}</p>}
    {!view && !error ? <p role="status">Opening People…</p> : group && view ?
      <PersonDetail key={group.id} group={group} groups={view.groups} data={data} busy={busy || scanning} onBack={() => setSelected(null)} onEdit={edit} onOpenPhoto={onOpenPhoto} /> :
      view?.groups.length ? <div className="circle-people-grid">{view.groups.map((person, i) => <button key={person.id} className="circle-person" onClick={() => setSelected(person.id)}>
        <img src={`/api/circle/face/${person.faces[0]!.id}`} alt="" loading="lazy" />
        <strong>{person.name || `Person ${i + 1}`}</strong><span>{person.photoIds.length} {person.photoIds.length === 1 ? "photo" : "photos"}</span>
        <small>{person.name ? "Named by family" : "Add a name"}<ArrowRight size={14} aria-hidden="true" /></small>
      </button>)}</div> : <div className="circle-people-empty"><UsersRound size={42} aria-hidden="true" /><h2>{data.photos.length ? view?.scannedPhotoIds.length ? "No clear faces found yet." : "Find the faces in your collection." : "People starts with your photographs."}</h2><p>{data.photos.length ? pending.length ? "Choose Find people to group similar faces. Clear, front-facing photographs work best." : "Add more photographs to find people. Clear, front-facing photographs work best." : "Add photos, then come here to bring photographs of the same people together."}</p></div>}
    <footer className="circle-people-footer"><p>Face detection runs on this device. Groups are suggestions; review them before adding a name.</p>
      {!!view?.scannedPhotoIds.length && data.canManage && (confirmClear ? <div className="circle-people-clear"><span>Clear names and face groups? Your photos and stories stay.</span><button className="circle-text-button" disabled={busy || scanning} onClick={() => void edit({ action: "clear" })}>Clear groups</button><button className="circle-text-button" onClick={() => setConfirmClear(false)}>Cancel</button></div> : <button className="circle-text-button" disabled={busy || scanning} onClick={() => setConfirmClear(true)}>Clear face groups</button>)}
    </footer>
  </section>;
}

function PersonDetail({ group, groups, data, busy, onBack, onEdit, onOpenPhoto }: { group: PeopleGroup; groups: PeopleGroup[]; data: CircleView; busy: boolean; onBack: () => void; onEdit: (action: Record<string, unknown>) => Promise<void>; onOpenPhoto: (id: string) => void }) {
  const [name, setName] = useState(group.name), [target, setTarget] = useState("");
  return <div className="circle-person-detail">
    <button className="circle-text-button" onClick={onBack}><ArrowLeft size={18} />All people</button>
    <div className="circle-person-heading"><img src={`/api/circle/face/${group.faces[0]!.id}`} alt="" /><div><h2>{group.name || "Who is this?"}</h2><p>{group.photoIds.length} {group.photoIds.length === 1 ? "photo" : "photos"} in this group</p></div></div>
    <form className="circle-person-name" onSubmit={event => { event.preventDefault(); void onEdit({ action: "name", id: group.id, name }); }}><label>A name you know<input value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="Add a name" disabled={busy} autoComplete="off" /></label><button className="circle-button secondary" disabled={busy || name.trim() === group.name}>Save name</button></form>
    {groups.length > 1 && <details className="circle-person-merge"><summary>Same person in another group?</summary><div><label>Combine with<select value={target} onChange={e => setTarget(e.target.value)} disabled={busy}><option value="">Choose a group</option>{groups.map((g, i) => g.id !== group.id && <option key={g.id} value={g.id}>{g.name || `Person ${i + 1}`} · {g.photoIds.length} photos</option>)}</select></label><button className="circle-button secondary" disabled={busy || !target} onClick={() => void onEdit({ action: "merge", id: group.id, targetId: target })}>Combine groups</button></div></details>}
    <div className="circle-person-photos">{group.faces.map(face => {
      const photo = data.photos.find(p => p.id === face.photoId);
      if (!photo) return null;
      return <article key={face.id}><button className="circle-person-photo" onClick={() => onOpenPhoto(photo.id)} aria-label={`Open ${photo.caption || photo.name}`}><img src={photo.url} alt={photo.caption || photo.name} loading="lazy" /><span>Open photo<ArrowRight size={17} /></span></button><div className="circle-face-match"><img src={`/api/circle/face/${face.id}`} alt="Matched face" loading="lazy" /><span>Match in this photo</span></div><div className="circle-face-corrections">{group.faces.length > 1 && <button disabled={busy} onClick={() => void onEdit({ action: "separate", faceId: face.id })}>Different person</button>}<button disabled={busy} onClick={() => void onEdit({ action: "dismiss", faceId: face.id })}>Not a face</button></div></article>;
    })}</div>
  </div>;
}
