/** Authored People-tab groups for the fictional photo kit; never graph identities or face recognition. */
import { createHash } from "node:crypto";
import type { FaceBox, PeopleView } from "@/lib/people/types";
import { sampleKitPhoto } from "./sample-kit";
import type { CircleState } from "./store";

const cast = [
  { key: "grandmother", name: "Grandmother" },
  { key: "mother", name: "Mother" },
  { key: "daughter-one", name: "Daughter 1" },
  { key: "daughter-two", name: "Daughter 2" },
] as const;
type Person = typeof cast[number]["key"];
type Crop = readonly [Person, number, number, number, number];

// Normalized face bounds in the original kit files. The two daughters are the birthday
// photographs' girl in green and the beach/hiking photographs' younger girl in blue.
// Only this requested cast is indexed; background people and objects are excluded.
export const SAMPLE_FACE_CROPS: Record<string, readonly Crop[]> = {
  "acadia-01.jpg": [["grandmother", .415, .21, .137, .12], ["mother", .63, .197, .151, .147]],
  "acadia-02.jpg": [["grandmother", .09, .314, .158, .155], ["mother", .44, .315, .14, .17], ["daughter-two", .80, .39, .175, .148]],
  "acadia-03.jpg": [["grandmother", .324, .302, .16, .14], ["mother", .516, .256, .148, .143]],
  "beach-01.jpg": [["grandmother", .267, .13, .123, .194], ["mother", .697, .21, .119, .19]],
  "beach-02.jpg": [["grandmother", .406, .315, .15, .23], ["mother", .68, .247, .14, .27], ["daughter-two", .555, .42, .116, .20]],
  "beach-03.jpg": [["grandmother", .34, .115, .27, .305], ["mother", .697, .09, .26, .32]],
  "birthday-01.jpg": [["grandmother", .278, .23, .17, .17], ["mother", .62, .061, .15, .17]],
  "birthday-02.jpg": [["grandmother", .19, .08, .242, .246], ["daughter-one", .62, .25, .218, .238]],
  "birthday-03.jpg": [["grandmother", .522, .275, .15, .14], ["mother", .694, .103, .15, .14], ["daughter-one", .20, .22, .15, .15]],
  "holiday-01.jpg": [["grandmother", .29, .12, .185, .165], ["mother", .855, .122, .139, .186]],
  "holiday-02.jpg": [["grandmother", .29, .22, .18, .18], ["mother", .66, .056, .112, .123]],
  "holiday-03.jpg": [["grandmother", .055, .245, .12, .126], ["mother", .75, .207, .146, .155], ["daughter-two", .84, .738, .16, .155]],
};

const sampleId = (key: string) => {
  const hex = createHash("sha256").update(`recall-sample-people:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

export function samplePeopleView(state: CircleState): PeopleView {
  const photos = state.photos.map(photo => ({ photo, kit: sampleKitPhoto(photo.hash) }))
    .filter(item => item.kit).sort((a, b) => a.kit!.file.localeCompare(b.kit!.file) || a.photo.id.localeCompare(b.photo.id));
  return {
    generation: "sample-people-v1", revision: 0, scannedPhotoIds: state.photos.map(photo => photo.id),
    groups: cast.map(person => {
      const faces = photos.flatMap(({ photo, kit }) => (SAMPLE_FACE_CROPS[kit!.file] ?? [])
        .filter(([key]) => key === person.key).map(([, x, y, width, height]) => ({
          id: sampleId(`${person.key}:${photo.id}`), photoId: photo.id, box: { x, y, width, height } satisfies FaceBox,
        })));
      return { id: sampleId(person.key), name: person.name, faces, photoIds: faces.map(face => face.photoId) };
    }).filter(group => group.faces.length),
  };
}
