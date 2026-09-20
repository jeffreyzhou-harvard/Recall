"use client";
import { useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import type { WebCallPhoto } from "@/server/web-call";

export function CallPhotographs({ photos }: { photos: WebCallPhoto[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const index = Math.max(0, photos.findIndex((photo) => photo.id === selected));
  const photo = photos[index];
  if (!photo) return null;
  return <figure className="recall-call-photo" aria-label="Photographs for this conversation">
    <CallPhotograph key={photo.url} photo={photo} />
    <figcaption>
      <span>{photos.length > 1 ? `Photograph ${index + 1} of ${photos.length}` : "A photograph to talk about"}</span>
      {photos.length > 1 && <div className="recall-photo-navigation">
        <button type="button" aria-label="Previous photograph" disabled={index === 0} onClick={() => setSelected(photos[index - 1]!.id)}><ChevronLeft aria-hidden="true" /></button>
        <button type="button" aria-label="Next photograph" disabled={index === photos.length - 1} onClick={() => setSelected(photos[index + 1]!.id)}><ChevronRight aria-hidden="true" /></button>
      </div>}
    </figcaption>
  </figure>;
}

function CallPhotograph({ photo }: { photo: WebCallPhoto }) {
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  return <div className="recall-call-photo-frame" aria-busy={state === "loading"}>
    {state !== "unavailable" && <img src={photo.url} alt="Photograph connected to this conversation" onLoad={() => setState("ready")} onError={() => setState("unavailable")} />}
    {state !== "ready" && <div className="recall-call-photo-placeholder" role="status">
      {state === "unavailable" && <ImageOff aria-hidden="true" />}
      <p>{state === "loading" ? "Opening photograph…" : "This photograph isn’t available. We can keep talking."}</p>
    </div>}
  </div>;
}
