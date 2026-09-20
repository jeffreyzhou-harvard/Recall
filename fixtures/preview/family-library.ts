import type { SampleSetupPhoto, SetupContact, SetupEvent } from "@/lib/recall-preview/imports";

/**
 * Fictional frontend intake only: no real personal information, extracted EXIF,
 * verified relationships or consent. UI composition may import these fixtures;
 * production /lib code must not import them.
 */
export type MockTopicId = "cape-may" | "lincoln" | "princeton";
export type MockFamilyPersonId = "susan" | "maya" | "priya" | "anika" | "ravi" | "leela" | "helen" | "david" | "nisha";
export type MockPhoto = {
  id: string; topicId: MockTopicId; title: string;
  preview: { src: string; alt: string; kind: "generated_illustration" | "shared_album_illustration" } | null;
  file: {
    name: string; type: "image/heic" | "image/jpeg"; bytes: number;
    width: number; height: number; capturedAt: string; device: string; album: string;
    lens: string; focalLengthMm: number; iso: number;
    acquisition: "original_capture" | "photographed_print";
    importedAt: string; source: "fictional_iphone_export";
  };
  familyContext: {
    contributorId: MockFamilyPersonId; caption: string; approximateYear: number;
    placeLabel: string; peopleIds: MockFamilyPersonId[]; attributedAt: string;
    source: "fictional_family_entry"; patientConfirmed: false;
  };
  selected: boolean;
  permissionTags: ("family_selected" | "joint_review_required" | "no_face_identification")[];
};
export type MockContact = {
  id: MockFamilyPersonId; name: string; relationship: string;
  relationshipStatedBy: MockFamilyPersonId; initials: string; group: string;
  source: "fictional_selected_contact"; selected: boolean;
  approval: "pending_joint_review"; proposedRole: "caregiver" | "contributor";
};
export type MockOccasion = {
  id: string; title: string; date: string; allDay: true; calendar: string;
  contributorId: MockFamilyPersonId; peopleIds: MockFamilyPersonId[]; topicId: MockTopicId;
  source: "fictional_selected_occasion"; selected: boolean; use: "family_context_only";
  patientConfirmed: false; note: string;
};
export type MockTopicConnection = {
  topicId: MockTopicId; title: string; photoIds: string[];
  contactIds: MockFamilyPersonId[]; occasionIds: string[]; attribution: string;
};
export type MockFamilyLibrary = {
  kind: "synthetic_frontend_fixture"; id: string; label: string; disclosure: string;
  participant: { id: "susan"; name: "Susan" }; caregiverId: "maya"; importedAt: string;
  photos: MockPhoto[]; contacts: MockContact[]; occasions: MockOccasion[]; topics: MockTopicConnection[];
};

const importedAt = "2026-09-19T14:00:00-04:00";
const contacts: MockContact[] = [
  { id: "maya", name: "Maya", relationship: "Daughter", group: "Close family", proposedRole: "caregiver" },
  { id: "priya", name: "Priya", relationship: "Sister", group: "Close family", proposedRole: "contributor" },
  { id: "anika", name: "Anika", relationship: "Granddaughter", group: "Close family", proposedRole: "contributor" },
  { id: "ravi", name: "Ravi", relationship: "Nephew", group: "Extended family", proposedRole: "contributor" },
  { id: "leela", name: "Leela", relationship: "Cousin", group: "Extended family", proposedRole: "contributor" },
  { id: "helen", name: "Helen", relationship: "Former colleague", group: "School friends", proposedRole: "contributor" },
  { id: "david", name: "David", relationship: "Family friend", group: "Family friends", proposedRole: "contributor" },
  { id: "nisha", name: "Nisha", relationship: "Friend", group: "Family friends", proposedRole: "contributor" },
].map((contact) => ({
  ...contact, id: contact.id as MockFamilyPersonId,
  proposedRole: contact.proposedRole as "caregiver" | "contributor",
  relationshipStatedBy: "maya", initials: contact.name[0]!,
  source: "fictional_selected_contact", selected: false, approval: "pending_joint_review",
}));

type PhotoSeed = {
  id: string; topicId: MockTopicId; title: string; image: string; alt: string; reused?: boolean;
  filename: string; capturedAt: string; device: "iPhone 14" | "iPhone 11" | "iPhone 6";
  bytes: number; iso: number; acquisition: "original_capture" | "photographed_print";
  contributorId: MockFamilyPersonId; caption: string; year: number; peopleIds: MockFamilyPersonId[];
};
const albumDetails = {
  "cape-may": { album: "Cape May summers", placeLabel: "Cape May" },
  lincoln: { album: "Lincoln Elementary", placeLabel: "Lincoln Elementary" },
  princeton: { album: "Life in Princeton", placeLabel: "Princeton" },
} satisfies Record<MockTopicId, { album: string; placeLabel: string }>;

const photoSeeds: PhotoSeed[] = [
  {
    id: "sample-photo-cape-may", topicId: "cape-may", title: "Summers at Cape May",
    image: "family-beach.png", alt: "A mother and daughter sitting together on a beach.",
    filename: "IMG_2048.HEIC", capturedAt: "2024-07-14T10:18:00-04:00", device: "iPhone 14", bytes: 3248000, iso: 100,
    acquisition: "photographed_print", contributorId: "maya", year: 1998, peopleIds: ["susan", "maya"],
    caption: "A photograph of an old family print from Cape May, added by Maya.",
  },
  {
    id: "sample-photo-cape-pier", topicId: "cape-may", title: "An afternoon by the pier",
    image: "cape-may-pier.png", alt: "A quiet seaside pier in warm afternoon light.",
    filename: "IMG_2050.HEIC", capturedAt: "2024-07-14T10:21:00-04:00", device: "iPhone 14", bytes: 3016000, iso: 80,
    acquisition: "photographed_print", contributorId: "maya", year: 1999, peopleIds: ["susan", "maya", "priya"],
    caption: "A seaside print from the same album. Maya supplied the approximate year and place.",
  },
  {
    id: "sample-photo-cape-picnic", topicId: "cape-may", title: "The picnic basket",
    image: "cape-may-picnic.png", alt: "A family picnic set out near the beach.",
    filename: "IMG_0934.JPG", capturedAt: "2016-08-07T12:15:00-04:00", device: "iPhone 6", bytes: 2456000, iso: 32,
    acquisition: "original_capture", contributorId: "priya", year: 2016, peopleIds: ["susan", "priya", "anika", "ravi"],
    caption: "A picnic photograph Priya chose from a summer visit. The people listed are family context, not face matches.",
  },
  {
    id: "sample-photo-cape-album", topicId: "cape-may", title: "The Cape May album",
    image: "family-beach.png", alt: "A mother and daughter on the beach, reused as an album illustration.", reused: true,
    filename: "IMG_2053.HEIC", capturedAt: "2024-07-14T10:30:00-04:00", device: "iPhone 14", bytes: 2872000, iso: 125,
    acquisition: "photographed_print", contributorId: "maya", year: 2001, peopleIds: ["susan", "maya", "david"],
    caption: "An additional album-page record from Maya. The thumbnail is a shared illustration for this sample album.",
  },
  {
    id: "sample-photo-lincoln", topicId: "lincoln", title: "The classroom",
    image: "lincoln-school.png", alt: "An empty classroom with wooden desks, books and plants by the windows.",
    filename: "IMG_2051.HEIC", capturedAt: "2024-07-14T10:24:00-04:00", device: "iPhone 14", bytes: 2896000, iso: 125,
    acquisition: "photographed_print", contributorId: "maya", year: 1986, peopleIds: ["susan", "helen"],
    caption: "A photograph of a school keepsake from the family album, linked to Lincoln Elementary by Maya.",
  },
  {
    id: "sample-photo-lincoln-library", topicId: "lincoln", title: "The school library",
    image: "lincoln-library.png", alt: "A quiet school library with bookshelves and a reading table.",
    filename: "IMG_2056.HEIC", capturedAt: "2024-07-14T10:34:00-04:00", device: "iPhone 14", bytes: 3472000, iso: 100,
    acquisition: "photographed_print", contributorId: "helen", year: 1991, peopleIds: ["susan", "helen"],
    caption: "A library photograph offered by Helen. Her school connection is still waiting for joint review.",
  },
  {
    id: "sample-photo-lincoln-window", topicId: "lincoln", title: "Plants by the classroom window",
    image: "lincoln-classroom-window.png", alt: "Plants and classroom objects beside a sunny school window.",
    filename: "IMG_4472.HEIC", capturedAt: "2021-04-12T11:05:00-04:00", device: "iPhone 11", bytes: 2614000, iso: 64,
    acquisition: "original_capture", contributorId: "helen", year: 2021, peopleIds: ["susan", "helen"],
    caption: "A school-window photograph offered as a conversation cue by Helen; it does not establish a memory of Susan's.",
  },
  {
    id: "sample-photo-lincoln-album", topicId: "lincoln", title: "School-day keepsakes",
    image: "lincoln-school.png", alt: "An empty classroom, reused as an album illustration.", reused: true,
    filename: "IMG_2058.HEIC", capturedAt: "2024-07-14T10:37:00-04:00", device: "iPhone 14", bytes: 3138000, iso: 160,
    acquisition: "photographed_print", contributorId: "maya", year: 1994, peopleIds: ["susan", "maya", "helen"],
    caption: "Another school-album entry from Maya. The thumbnail is a shared illustration for this sample album.",
  },
  {
    id: "sample-photo-princeton", topicId: "princeton", title: "The garden in Princeton",
    image: "princeton-garden.png", alt: "A backyard garden with tomatoes, yellow flowers and two chairs.",
    filename: "IMG_0612.JPG", capturedAt: "2016-05-22T15:42:00-04:00", device: "iPhone 6", bytes: 1974000, iso: 32,
    acquisition: "original_capture", contributorId: "priya", year: 2016, peopleIds: ["susan", "priya", "anika"],
    caption: "A garden photograph linked to Princeton by Priya. The place label is her entry, not GPS.",
  },
  {
    id: "sample-photo-princeton-front", topicId: "princeton", title: "Flowers at the front of the house",
    image: "princeton-front-garden.png", alt: "A front garden with flowers beside a house.",
    filename: "IMG_1783.HEIC", capturedAt: "2023-06-03T09:35:00-04:00", device: "iPhone 14", bytes: 3672000, iso: 50,
    acquisition: "original_capture", contributorId: "leela", year: 2023, peopleIds: ["susan", "leela", "nisha"],
    caption: "A flower-garden photograph Leela offered for the Princeton album. No street address is included.",
  },
  {
    id: "sample-photo-princeton-kitchen", topicId: "princeton", title: "An afternoon in the kitchen",
    image: "princeton-kitchen.png", alt: "A sunlit home kitchen with a table.",
    filename: "IMG_4806.HEIC", capturedAt: "2021-11-07T14:20:00-05:00", device: "iPhone 11", bytes: 3024000, iso: 200,
    acquisition: "original_capture", contributorId: "maya", year: 2021, peopleIds: ["susan", "maya", "anika", "ravi"],
    caption: "A kitchen photograph Maya grouped with time spent in Princeton. It remains Maya's contribution.",
  },
  {
    id: "sample-photo-princeton-album", topicId: "princeton", title: "The garden album",
    image: "princeton-garden.png", alt: "A backyard garden, reused as an album illustration.", reused: true,
    filename: "IMG_2063.HEIC", capturedAt: "2024-07-14T10:43:00-04:00", device: "iPhone 14", bytes: 2288000, iso: 100,
    acquisition: "photographed_print", contributorId: "priya", year: 1995, peopleIds: ["susan", "priya", "david", "nisha"],
    caption: "A separate garden-album entry from Priya. The thumbnail is a shared illustration for this sample album.",
  },
];

const photos: MockPhoto[] = photoSeeds.map((seed) => ({
  id: seed.id, topicId: seed.topicId, title: seed.title,
  preview: {
    src: "/preview/" + seed.image,
    alt: (seed.reused ? "Fictional album illustration: " : "Fictional sample photograph: ") + seed.alt,
    kind: seed.reused ? "shared_album_illustration" : "generated_illustration",
  },
  file: {
    name: seed.filename, type: seed.filename.endsWith(".HEIC") ? "image/heic" : "image/jpeg",
    bytes: seed.bytes, width: seed.device === "iPhone 6" ? 3264 : 4032,
    height: seed.device === "iPhone 6" ? 2448 : 3024, capturedAt: seed.capturedAt,
    device: seed.device, album: albumDetails[seed.topicId].album,
    lens: seed.device + " back wide camera", focalLengthMm: seed.device === "iPhone 6" ? 4.15 : seed.device === "iPhone 11" ? 4.25 : 5.7,
    iso: seed.iso, acquisition: seed.acquisition, importedAt, source: "fictional_iphone_export",
  },
  familyContext: {
    contributorId: seed.contributorId, caption: seed.caption, approximateYear: seed.year,
    placeLabel: albumDetails[seed.topicId].placeLabel, peopleIds: seed.peopleIds,
    attributedAt: importedAt, source: "fictional_family_entry", patientConfirmed: false,
  },
  selected: false, permissionTags: ["family_selected", "joint_review_required", "no_face_identification"],
}));

type OccasionSeed = {
  id: string; title: string; date: string; contributorId: MockFamilyPersonId;
  peopleIds: MockFamilyPersonId[]; topicId: MockTopicId; note: string;
};
const occasionSeeds: OccasionSeed[] = [
  { id: "sample-occasion-cape-may", title: "Looking through the Cape May album", date: "2026-09-20", contributorId: "maya", peopleIds: ["susan", "maya", "anika"], topicId: "cape-may", note: "An afternoon Maya added to the family calendar." },
  { id: "sample-occasion-lincoln", title: "Lincoln Elementary reunion", date: "2026-09-26", contributorId: "maya", peopleIds: ["susan", "helen"], topicId: "lincoln", note: "A calendar occasion, not a confirmed plan for Susan." },
  { id: "sample-occasion-princeton", title: "Priya’s birthday", date: "2026-10-03", contributorId: "priya", peopleIds: ["susan", "priya", "maya", "anika"], topicId: "princeton", note: "A birthday offered by Priya as family context." },
  { id: "sample-occasion-cape-picnic", title: "Family picnic", date: "2026-09-27", contributorId: "priya", peopleIds: ["susan", "priya", "ravi"], topicId: "cape-may", note: "A picnic listed in Priya's selected family occasions." },
  { id: "sample-occasion-school-tea", title: "Tea with Helen", date: "2026-10-04", contributorId: "helen", peopleIds: ["susan", "helen"], topicId: "lincoln", note: "Helen's calendar entry; attendance is not assumed." },
  { id: "sample-occasion-garden-flowers", title: "Autumn flowers with Leela", date: "2026-10-10", contributorId: "leela", peopleIds: ["susan", "leela", "nisha"], topicId: "princeton", note: "A family-selected occasion associated with the garden album." },
  { id: "sample-occasion-cape-postcards", title: "Sorting the seaside postcards", date: "2026-10-11", contributorId: "maya", peopleIds: ["susan", "maya", "anika"], topicId: "cape-may", note: "An album afternoon entered by Maya." },
  { id: "sample-occasion-school-album", title: "School album afternoon", date: "2026-10-17", contributorId: "maya", peopleIds: ["susan", "maya", "helen"], topicId: "lincoln", note: "A selected personal occasion, not a school-calendar subscription." },
  { id: "sample-occasion-princeton-lunch", title: "Lunch with Nisha", date: "2026-10-18", contributorId: "nisha", peopleIds: ["susan", "nisha"], topicId: "princeton", note: "Nisha supplied the title and date." },
  { id: "sample-occasion-cape-ravi", title: "Ravi’s birthday lunch", date: "2026-10-24", contributorId: "priya", peopleIds: ["susan", "priya", "ravi", "maya"], topicId: "cape-may", note: "Priya grouped this family occasion with the summer album." },
  { id: "sample-occasion-school-books", title: "Choosing books with Helen", date: "2026-10-25", contributorId: "helen", peopleIds: ["susan", "helen", "anika"], topicId: "lincoln", note: "A book afternoon entered by Helen." },
  { id: "sample-occasion-princeton-baking", title: "Family baking afternoon", date: "2026-11-01", contributorId: "maya", peopleIds: ["susan", "maya", "anika"], topicId: "princeton", note: "A family occasion associated with the kitchen photograph." },
  { id: "sample-occasion-cape-david", title: "Tea with David", date: "2026-11-07", contributorId: "david", peopleIds: ["susan", "david", "priya"], topicId: "cape-may", note: "David's selected calendar entry; no invitation is sent by Recall." },
  { id: "sample-occasion-school-keepsakes", title: "An afternoon with school keepsakes", date: "2026-11-14", contributorId: "maya", peopleIds: ["susan", "maya"], topicId: "lincoln", note: "A family album occasion chosen by Maya." },
  { id: "sample-occasion-princeton-potluck", title: "Family potluck", date: "2026-11-21", contributorId: "leela", peopleIds: ["susan", "maya", "priya", "leela", "nisha"], topicId: "princeton", note: "A selected family occasion with no address or guest contact details." },
  { id: "sample-occasion-cape-winter-album", title: "Summer photographs together", date: "2026-12-05", contributorId: "anika", peopleIds: ["susan", "anika", "maya"], topicId: "cape-may", note: "Anika's occasion for looking through an album together." },
  { id: "sample-occasion-school-helen-birthday", title: "Helen’s birthday", date: "2026-12-12", contributorId: "helen", peopleIds: ["susan", "helen"], topicId: "lincoln", note: "A birthday supplied by Helen for this fictional walkthrough." },
  { id: "sample-occasion-princeton-family", title: "Family afternoon at home", date: "2026-12-20", contributorId: "maya", peopleIds: ["susan", "maya", "priya", "anika", "ravi"], topicId: "princeton", note: "Family context only; this entry does not schedule a Recall call." },
];
const occasions: MockOccasion[] = occasionSeeds.map((occasion) => ({
  ...occasion, allDay: true, calendar: "Family occasions", source: "fictional_selected_occasion",
  selected: false, use: "family_context_only", patientConfirmed: false,
}));

export const mockFamilyLibrary: MockFamilyLibrary = {
  kind: "synthetic_frontend_fixture", id: "sample-susan-family", label: "Susan’s sample family",
  disclosure: "Fictional sample data. Photo details, contacts and occasions are examples for this walkthrough.",
  participant: { id: "susan", name: "Susan" }, caregiverId: "maya", importedAt,
  photos, contacts, occasions,
  topics: [
    {
      topicId: "cape-may", title: "Cape May summers",
      photoIds: photos.filter((photo) => photo.topicId === "cape-may").map((photo) => photo.id),
      contactIds: ["maya", "priya", "anika", "ravi", "david"],
      occasionIds: occasions.filter((occasion) => occasion.topicId === "cape-may").map((occasion) => occasion.id),
      attribution: "Photos and context offered by family. Susan has not confirmed these contributions.",
    },
    {
      topicId: "lincoln", title: "Lincoln Elementary",
      photoIds: photos.filter((photo) => photo.topicId === "lincoln").map((photo) => photo.id),
      contactIds: ["maya", "helen"],
      occasionIds: occasions.filter((occasion) => occasion.topicId === "lincoln").map((occasion) => occasion.id),
      attribution: "Photos and context offered by Maya and Helen. Susan has not confirmed these contributions.",
    },
    {
      topicId: "princeton", title: "Princeton",
      photoIds: photos.filter((photo) => photo.topicId === "princeton").map((photo) => photo.id),
      contactIds: ["maya", "priya", "anika", "leela", "nisha", "david"],
      occasionIds: occasions.filter((occasion) => occasion.topicId === "princeton").map((occasion) => occasion.id),
      attribution: "Photos and context offered by family and friends. Susan has not confirmed these contributions.",
    },
  ],
};

/** Import candidates stay unselected. Nothing here is a live consent record. */
export const samplePhotos: SampleSetupPhoto[] = mockFamilyLibrary.photos.map((photo) => ({
  id: photo.id, name: photo.title, src: photo.preview?.src,
  alt: photo.preview?.alt ?? "Fictional sample photo: " + photo.title, topicId: photo.topicId,
  metadata: {
    fileName: photo.file.name, mimeType: photo.file.type, bytes: photo.file.bytes,
    capturedAt: photo.file.capturedAt, device: photo.file.device,
    dimensions: { width: photo.file.width, height: photo.file.height },
    album: photo.file.album, lens: photo.file.lens, focalLengthMm: photo.file.focalLengthMm,
    iso: photo.file.iso, acquisition: photo.file.acquisition,
    placeLabel: photo.familyContext.placeLabel, caption: photo.familyContext.caption,
    contributor: contacts.find((contact) => contact.id === photo.familyContext.contributorId)?.name ?? "Family",
    people: photo.familyContext.peopleIds.map((id) => id === "susan" ? "Susan" : contacts.find((contact) => contact.id === id)?.name ?? "Family"),
    attributedAt: photo.familyContext.attributedAt, approximateYear: photo.familyContext.approximateYear,
    source: photo.preview?.kind === "shared_album_illustration"
      ? "Shared fictional album illustration. File details are sample metadata, not extracted EXIF."
      : "Fictional sample details; not extracted image metadata.",
  },
}));
export const sampleContacts: SetupContact[] = mockFamilyLibrary.contacts.map((contact) => ({
  id: contact.id, name: contact.name, phone: "", relationship: contact.relationship, selected: false,
  source: "Sample iPhone contact · Relationship supplied by Maya",
  detail: contact.group + " · Awaiting joint approval",
}));
export const sampleEvents: SetupEvent[] = mockFamilyLibrary.occasions.map((occasion) => ({
  id: occasion.id, title: occasion.title, date: occasion.date, selected: false,
  source: (contacts.find((contact) => contact.id === occasion.contributorId)?.name ?? "Family") + "’s sample calendar",
  detail: occasion.note,
}));
