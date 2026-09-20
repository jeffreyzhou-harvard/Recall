import { ImageIcon } from "lucide-react";
import type { SampleSetupPhoto } from "@/lib/recall-preview/imports";

/** A selected fictional photo, shared by onboarding and the local patient preview. */
export function SetupPhoto({ photo, className, eager = false }: { photo: SampleSetupPhoto; className?: string; eager?: boolean }) {
  return photo.src
    ? <img className={className} src={photo.src} alt={photo.alt} loading={eager ? "eager" : "lazy"} decoding="async" />
    : <div className={`setup-photo-placeholder ${className ?? ""}`} role="img" aria-label={photo.alt}>
      <ImageIcon size={32} strokeWidth={1.5} aria-hidden="true" />
      <span>{photo.name}</span>
      <small>Sample photo placeholder</small>
    </div>;
}
