"use client";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Pencil,
  Info,
  Users,
  Trash2,
  X,
} from "lucide-react";
import { ArchiveDialog } from "@/components/archive/ArchiveDialog";
import { StoryRecorder } from "./StoryRecorder";
import { dateLabel, post, type CircleView } from "./types";
export function MomentPanel({
  id,
  initialPhotoId,
  data,
  onClose,
  onChanged,
  onFamily,
}: {
  id: string;
  initialPhotoId?: string;
  data: CircleView;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onFamily: () => void;
}) {
  const m = data.moments.find((m) => m.id === id)!,
    photos = m.photoIds
      .map((id) => data.photos.find((p) => p.id === id))
      .filter((p) => !!p),
    stories = data.stories.filter((s) => s.eventId === id);
  const [index, setIndex] = useState(() => Math.max(0, photos.findIndex(p => p.id === initialPhotoId))),
    [lightbox, setLightbox] = useState(false),
    [editing, setEditing] = useState(false),
    [title, setTitle] = useState(m.title),
    [people, setPeople] = useState(m.participantIds),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [writing, setWriting] = useState(false),
    [link, setLink] = useState(""),
    [recipient, setRecipient] = useState(""),
    [delivery, setDelivery] = useState("");
  const [deleting, setDeleting] = useState<"photo" | "moment" | null>(null);
  const selectedPhoto = photos[Math.min(index, Math.max(0, photos.length - 1))];
  const affectedGroups = deleting === "moment" ? [m.id] : data.moments.filter((moment) => moment.photoIds.length === 1 && moment.photoIds[0] === selectedPhoto?.id).map((moment) => moment.id);
  const deletedStoryCount = data.stories.filter((story) => affectedGroups.includes(story.eventId)).length;
  async function remove() {
    if (!deleting || busy) return;
    setBusy(true); setError("");
    try {
      const result = await post<{ removedMomentIds: string[]; warning: string | null }>("delete", { kind: deleting, id: deleting === "moment" ? m.id : selectedPhoto?.id, momentId: m.id, revision: m.revision, storyCount: deletedStoryCount });
      setDeleting(null); setLightbox(false); setIndex(Math.max(0, index - 1));
      if (result.removedMomentIds.includes(m.id)) onClose();
      await onChanged();
      if (result.warning) setError(result.warning);
    } catch (e) { setError(e instanceof Error ? e.message : "The photograph could not be deleted."); }
    finally { setBusy(false); }
  }
  const deleteControls = data.canManage && <div className="circle-delete-actions">
    <button className="circle-text-button" onClick={() => { setError(""); setDeleting("photo"); }} disabled={busy || !selectedPhoto}><Trash2 size={16} aria-hidden="true" />Delete this photo</button>
    <button className="circle-text-button" onClick={() => { setError(""); setDeleting("moment"); }} disabled={busy}>Delete photo group</button>
  </div>;
  async function save() {
    setBusy(true);
    setError("");
    try {
      await post("moment", {
        id: m.id,
        title,
        people: data.people
          .filter((p) => people.includes(p.id))
          .map((p) => p.name),
        participantIds: people,
        revision: m.revision,
      });
      await onChanged();
      setEditing(false);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The change could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <ArchiveDialog
      title={deleting ? deleting === "moment" ? "Delete photo group" : "Delete photograph" : m.title}
      drawer={!lightbox}
      onClose={() => (deleting ? setDeleting(null) : lightbox ? setLightbox(false) : onClose())}
      busy={busy}
      focusKey={deleting ? `delete-${deleting}` : lightbox ? "photo" : editing ? "edit" : "moment"}
    >
      {deleting ? <section className="circle-delete-confirm">
        <Trash2 size={28} aria-hidden="true" />
        <h2>{deleting === "moment" ? `Delete “${m.title}”?` : "Delete this photograph?"}</h2>
        <p>{deleting === "moment" ? `This removes the photo group and its ${photos.length} ${photos.length === 1 ? "photograph" : "photographs"} from your family collection. Photos also kept in another group will stay there.` : "This removes the selected photograph from your family collection and People."}</p>
        {deleting === "photo" && affectedGroups.length > 0 && <p>This is the last photograph in its group, so the empty group will also be removed.</p>}
        {deletedStoryCount > 0 && <p>The {deletedStoryCount} {deletedStoryCount === 1 ? "story" : "stories"} in {affectedGroups.length === 1 ? "this group" : "these groups"}, including any recordings, will also be deleted.</p>}
        <p>You can’t undo this in Recall.</p>
        {error && <p className="circle-error" role="alert">{error}</p>}
        <div><button className="circle-button secondary" disabled={busy} onClick={() => setDeleting(null)}>Keep {deleting === "moment" ? "photo group" : "photograph"}</button><button className="circle-button circle-danger-button" disabled={busy} onClick={() => void remove()}>{busy ? "Deleting…" : deleting === "moment" ? "Delete group" : "Delete photo"}</button></div>
      </section> : lightbox ? (
        <div className="circle-lightbox">
          <img
            src={photos[index]?.url}
            alt={photos[index]?.caption || m.title}
          />
          <div>
            <button
              className="circle-icon-button"
              aria-label="Previous photograph"
              disabled={index === 0}
              onClick={() => setIndex((i) => i - 1)}
            >
              <ChevronLeft />
            </button>
            <span>
              {index + 1} / {photos.length}
            </span>
            <button
              className="circle-icon-button"
              aria-label="Next photograph"
              disabled={index === photos.length - 1}
              onClick={() => setIndex((i) => i + 1)}
            >
              <ChevronRight />
            </button>
          </div>
          <p>{photos[index]?.caption || m.title}</p>
          {deleteControls}
        </div>
      ) : (
        <>
          <button
            className="circle-detail-cover"
            onClick={() => setLightbox(true)}
          >
            <img
              src={photos[index]?.url}
              alt={photos[index]?.caption || m.title}
            />
            <span>
              Take a closer look
              <ArrowRight size={17} />
            </span>
          </button>
          <div className="circle-panel">
            <div className="circle-detail-meta">
              <span>{dateLabel(m.startAt)}</span>
              <button
                className="circle-icon-button"
                onClick={() => setEditing(!editing)}
                aria-label="Edit this moment"
              >
                <Pencil size={16} />
              </button>
            </div>
            {editing ? (
              <section className="circle-edit">
                <h3>The details you know.</h3>
                <label>
                  A name for this moment
                  <input
                    value={title}
                    maxLength={100}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <p>Who was there?</p>
                <div className="circle-person-choices">
                  {data.people.map((p) => (
                    <button
                      key={p.id}
                      aria-pressed={people.includes(p.id)}
                      onClick={() =>
                        setPeople((v) =>
                          v.includes(p.id)
                            ? v.filter((id) => id !== p.id)
                            : [...v, p.id],
                        )
                      }
                    >
                      <span>{p.name[0]}</span>
                      {p.name}
                      {people.includes(p.id) && <Check size={14} />}
                    </button>
                  ))}
                </div>
                <p className="circle-fine">
                  Names come from your family. We never guess a name from a
                  face.
                </p>
                <div className="circle-row">
                  <button
                    className="circle-button primary"
                    disabled={busy || !title.trim()}
                    onClick={() => void save()}
                  >
                    Save details
                  </button>
                  <button
                    className="circle-text-button"
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </button>
                </div>
              </section>
            ) : (
              <>
                <h2>{m.title}</h2>
                {m.place && (
                  <p className="circle-location">
                    <MapPin size={15} />
                    {m.place}
                  </p>
                )}
                {m.description && (
                  <p className="circle-description">{m.description}</p>
                )}
                <div className="circle-person-line">
                  {m.people.length ? (
                    m.people.map((n) => (
                      <span key={n}>
                        <i>{n[0]}</i>
                        {n}
                      </span>
                    ))
                  ) : (
                    <button
                      className="circle-text-button"
                      onClick={() => setEditing(true)}
                    >
                      <Users size={16} />
                      {m.peopleCount
                        ? `${m.peopleCount} ${m.peopleCount === 1 ? "person" : "people"} in the photographs · Add names`
                        : "Add the people who were there"}
                    </button>
                  )}
                </div>
              </>
            )}
            {photos.length > 1 && (
              <div className="circle-photo-strip">
                {photos.map((p, i) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setIndex(i);
                      setLightbox(true);
                    }}
                    aria-label={`Open photograph ${i + 1}`}
                  >
                    <img src={p.url} alt={p.caption || ""} />
                  </button>
                ))}
              </div>
            )}
            {deleteControls}
            <section className="circle-story-invitation">
              <h3>
                {m.question ||
                  "What comes to mind when you see this photograph?"}
              </h3>
              {!writing ? (
                <button
                  className="circle-button primary"
                  onClick={() => setWriting(true)}
                >
                  Add your part of the story
                  <ArrowRight size={18} />
                </button>
              ) : (
                <StoryRecorder
                  momentId={m.id}
                  name={data.name}
                  onSaved={onChanged}
                />
              )}
            </section>
            {stories.length > 0 && (
              <section className="circle-stories">
                <h3>The story, in their words.</h3>
                {stories.map((s) => (
                  <article key={s.id}>
                    <span className="circle-story-quote">“</span>
                    <p>{s.text}</p>
                    {s.audioUrl && (
                      <audio controls preload="none" src={s.audioUrl} />
                    )}
                    <footer>
                      <span className="circle-avatar">{s.author[0]}</span>
                      <div>
                        <strong>{s.author}</strong>
                        <span>
                          {dateLabel(s.createdAt)} ·{" "}
                          {s.source === "voice"
                            ? "Original voice"
                            : "Their own words"}
                        </span>
                      </div>
                    </footer>
                  </article>
                ))}
              </section>
            )}
            {data.canManage && (
              <section className="circle-ask-story">
                <h3>Someone else remembers it differently.</h3>
                <p>Invite their side of this moment.</p>
                <label>
                  Ask someone in your family
                  <select
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                  >
                    <option value="">Choose a person</option>
                    {data.people
                      .filter((p) => p.id !== data.member)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="circle-row">
                  <button
                    className="circle-button secondary"
                    disabled={!recipient || busy}
                    onClick={() => {
                      setBusy(true);
                      setError("");
                      void post<{ url: string; deliveryError: string }>(
                        "story-link",
                        { member: recipient, momentId: m.id },
                      )
                        .then((r) => {
                          setLink(r.url);
                          setDelivery(r.deliveryError);
                        })
                        .catch((e) => setError(e.message))
                        .finally(() => setBusy(false));
                    }}
                  >
                    Create a story link
                    <ArrowRight size={16} />
                  </button>
                  <button
                    className="circle-text-button"
                    disabled={!recipient || busy}
                    onClick={() => {
                      setBusy(true);
                      setError("");
                      void post<{
                        url: string;
                        deliveryError: string;
                        sent: boolean;
                      }>("story-link", {
                        member: recipient,
                        momentId: m.id,
                        send: true,
                      })
                        .then((r) => {
                          setLink(r.url);
                          setDelivery(
                            r.sent ? "Invitation sent." : r.deliveryError,
                          );
                        })
                        .catch((e) => setError(e.message))
                        .finally(() => setBusy(false));
                    }}
                  >
                    Send by text
                  </button>
                </div>
                {link && (
                  <div className="circle-link-result">
                    <p>
                      Share this private link. It opens this photograph and
                      question.
                    </p>
                    <input
                      aria-label="Private story invitation"
                      value={link}
                      readOnly
                      onFocus={(e) => e.target.select()}
                    />
                    <a className="circle-text-button" href={link}>
                      Preview invitation
                      <ArrowRight size={16} />
                    </a>
                    {delivery && <p role="status">{delivery}</p>}
                  </div>
                )}
              </section>
            )}
            <details className="circle-provenance">
              <summary>
                <Info size={16} aria-hidden="true" />
                {m.titleSource === "ai"
                  ? "Organized with a little help from AI"
                  : "How this moment came together"}
              </summary>
              <p>{m.evidence.join(" · ") || "Your original photographs"}</p>
              <p>
                Titles and descriptions are suggestions. Family stories are
                their own words, with attribution.
              </p>
              {m.analysis === "unavailable" && (
                <button
                  className="circle-text-button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void post("analyze", { momentId: m.id })
                      .then(onChanged)
                      .catch((e) => setError(e.message))
                      .finally(() => setBusy(false));
                  }}
                >
                  Analyze these photos again
                </button>
              )}
            </details>
            <div className="circle-another-voice">
              <div>
                <h3>Every photograph has another side.</h3>
                <p>Make room for someone else’s memory.</p>
              </div>
              <button className="circle-text-button" onClick={onFamily}>
                Invite family
                <ArrowRight size={16} />
              </button>
            </div>
            {error && (
              <p className="circle-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </>
      )}
    </ArchiveDialog>
  );
}
