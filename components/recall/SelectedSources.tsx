"use client";

import { usePreview } from "./PreviewProvider";
import { SetupPhoto } from "./SetupPhoto";
import { LocalPhoto } from "./LocalPhoto";

export function SelectedSources() {
  const { setup } = usePreview();
  if (!setup.agreed) return null;
  return <details className="sample-source-library">
    <summary>Review selected sources</summary>
    {!!setup.samplePhotos?.length && <p className="care-caption">Fictional sample library. Capture details simulate an iPhone import. Family descriptions remain separate from Susan’s confirmed words.</p>}
    <div className="sample-source-photos">
      {setup.samplePhotos?.map((photo) => <figure key={photo.id}>
        <SetupPhoto photo={photo} />
        <figcaption><strong>{photo.metadata.album}</strong><p>{photo.metadata.caption}</p><p>From {photo.metadata.contributor} · Family description</p></figcaption>
        <details><summary>Photo details</summary><ul>
          <li>{photo.metadata.fileName ?? photo.name}{photo.metadata.bytes ? ` · ${(photo.metadata.bytes / 1_000_000).toFixed(1)} MB` : ""}</li>
          <li>{photo.metadata.device} · {photo.metadata.dimensions.width} × {photo.metadata.dimensions.height}</li>
          <li>{photo.metadata.acquisition === "photographed_print" ? "Print photographed" : "Sample capture date"}: {photo.metadata.capturedAt}</li>
          {photo.metadata.approximateYear && <li>Approximate year in the photo: {photo.metadata.approximateYear} · family-provided</li>}
          <li>Family place label: {photo.metadata.placeLabel}</li>
          {!!photo.metadata.people?.length && <li>People named by family: {photo.metadata.people.join(", ")}</li>}
          {photo.metadata.lens && <li>{photo.metadata.lens}{photo.metadata.focalLengthMm ? ` · ${photo.metadata.focalLengthMm} mm` : ""}{photo.metadata.iso ? ` · ISO ${photo.metadata.iso}` : ""}</li>}
          <li>Generated illustration; these details are simulated, not extracted EXIF.</li>
        </ul></details>
      </figure>)}
      {setup.photos.map((file, index) => <figure key={file.name + index}><LocalPhoto file={file} /><figcaption><strong>{file.name}</strong><p>Local selection. No metadata has been extracted or topic assigned.</p></figcaption></figure>)}
    </div>
    <div className="sample-source-lists">
      <section aria-label="Approved people"><h3>Approved people</h3><ul>{setup.contacts.map((contact) => <li key={contact.id}>{contact.name}<small>{contact.relationship || "Relationship not added"}{contact.source ? ` · ${contact.source}` : ""}</small></li>)}</ul></section>
      <section aria-label="Selected occasions"><h3>Selected occasions</h3>{setup.events.length ? <ul>{setup.events.map((event) => <li key={event.id}>{event.title}<small>{event.date}{event.detail ? ` · ${event.detail}` : ""}</small></li>)}</ul> : <p className="care-caption">No calendar events selected.</p>}</section>
    </div>
    <p className="care-caption">Agreed calling window: {setup.days.join(", ")} · {setup.start}–{setup.end}. These selections stay in this browser tab; no call has been scheduled.</p>
  </details>;
}
