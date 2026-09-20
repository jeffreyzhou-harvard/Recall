"use client";
import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { Story } from "@/lib/archive/types";
import { post } from "./types";

export function DeleteStory({ story, onDeleted }: { story: Story; onDeleted: (warning: string | null) => Promise<void> }) {
  const [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  function cancel() { setConfirming(false); setError(""); trigger.current?.focus(); }
  async function remove() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await post<{ warning: string | null }>("delete-story", { id: story.id });
      await onDeleted(result.warning);
    } catch (e) { setError(e instanceof Error ? e.message : "The story could not be deleted."); }
    finally { setBusy(false); }
  }
  return <div className="circle-story-delete">
    <button ref={trigger} type="button" className="circle-text-button" aria-label={`Delete story by ${story.author}`} aria-expanded={confirming} disabled={busy} onClick={() => { setError(""); setConfirming(true); }}><Trash2 size={16} aria-hidden="true" />Delete story</button>
    {confirming && <div className="circle-story-delete-confirm" role="group" aria-label="Confirm story deletion" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); if (!busy) cancel(); } }}>
      <p>Delete this story from your family collection?</p>
      <p>{story.callEvidence ? "This removes the shared copy. The original call record remains private." : story.audioUrl ? "Its recording will also be removed if no other story uses it." : "You can’t undo this in Recall."}</p>
      <div><button type="button" autoFocus className="circle-button secondary" disabled={busy} onClick={cancel}>Keep story</button><button type="button" className="circle-button circle-danger-button" disabled={busy} onClick={() => void remove()}>{busy ? "Deleting…" : "Delete story"}</button></div>
    </div>}
    {error && <p className="circle-error" role="alert">{error}</p>}
  </div>;
}
