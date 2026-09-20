/** Exact-file recognition for a repeatable, explicitly labelled sample-family upload demo. */
import kit from "@/fixtures/sample-family.json";
import type { CirclePhoto } from "./store";
import type { PhotoGroup } from "./ai";

const byHash = new Map(kit.map((photo) => [photo.sha256, photo]));
export const sampleKitPhoto = (hash: string) => byHash.get(hash);
const places: Record<string, string> = { "Our Cape May summer": "Cape May", "A birthday around the table": "Princeton", "The kitchen before Diwali": "Princeton", "A long weekend in Acadia": "Acadia" };

export function sampleKitGroups(photos: CirclePhoto[]): PhotoGroup[] {
  const grouped = new Map<string, CirclePhoto[]>();
  for (const photo of photos) {
    const entry = sampleKitPhoto(photo.hash);
    if (entry) grouped.set(entry.event, [...(grouped.get(entry.event) ?? []), photo]);
  }
  return [...grouped].map(([title, photos]) => {
    photos.sort((a, b) => sampleKitPhoto(a.hash)!.file.localeCompare(sampleKitPhoto(b.hash)!.file));
    return {
      title, photoIds: photos.map((photo) => photo.id), coverPhotoId: photos[0]!.id,
      description: "Fictional family photographs for exploring Recall.", place: places[title] ?? "",
      question: "What comes to mind when you see these photographs?",
      peopleCount: new Set(photos.flatMap((photo) => sampleKitPhoto(photo.hash)!.people)).size,
      captions: photos.map((photo) => ({ photoId: photo.id, caption: `Illustrative sample photograph · ${title}` })),
    };
  });
}
