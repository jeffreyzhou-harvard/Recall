import { describe, expect, it } from "vitest";
import { emptySetup, type SampleSetupPhoto } from "../lib/recall-preview/imports";
import { photoForSession } from "../lib/recall-preview/source-view";

const photo: SampleSetupPhoto = {
  id: "sample", name: "Fictional beach photo", topicId: "cape-may", src: "/preview/family-beach.png", alt: "Fictional photograph",
  metadata: { capturedAt: "", device: "", dimensions: { width: 1448, height: 1086 }, album: "Sample", placeLabel: "", caption: "", contributor: "Maya" },
};
describe("patient sample photo boundary", () => {
  it("uses the standalone illustration only before agreed setup and for its own topic", () => {
    expect(photoForSession(emptySetup, "cape-may", photo)).toBe(photo);
    expect(photoForSession(emptySetup, "lincoln", photo)).toBeUndefined();
  });
  it("respects removal after setup instead of restoring a fallback", () => {
    expect(photoForSession({ ...emptySetup, agreed: true, samplePhotos: [] }, "cape-may", photo)).toBeUndefined();
  });
  it("shows only the committed sample with a matching topic and available image", () => {
    const setup = { ...emptySetup, agreed: true, samplePhotos: [photo] };
    expect(photoForSession(setup, "cape-may")).toBe(photo);
    expect(photoForSession(setup, "lincoln")).toBeUndefined();
    expect(photoForSession({ ...setup, samplePhotos: [{ ...photo, src: undefined }] }, "cape-may")).toBeUndefined();
  });
  it("does not turn an uploaded file into a fixed-script association", () => {
    const setup = { ...emptySetup, agreed: true, photos: [new File(["local"], "cape-may.jpg")] };
    expect(photoForSession(setup, "cape-may", photo)).toBeUndefined();
  });
});
