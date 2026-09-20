/** Reproducible, explicitly fictional demo media. Never touches the patient-call graph. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { CircleError, readCircle, updateCircle, type CirclePhoto, type CircleMoment, type CircleState } from "./store";
import { mediaFolder } from "./photos";
import { removeCollectionFiles, removeCollectionItems } from "./delete";
import type { FamilyConnections, Moment } from "@/lib/archive/types";
import demoFixture from "@/fixtures/sample-family-demo.json";

/** Illustrative connections only: no accounts, invitations, or patient-call evidence are created. */
export function sampleFamilyConnections(moments: Moment[]): FamilyConnections {
  const peopleByMoment: Record<string, string[]> = {
    "Home Garden Morning": ["Susan", "Maya", "Priya"],
    "Quiet Library Rooms": ["Susan", "Maya", "Anika"],
    "Our Cape May summer": ["Susan", "Maya", "Anika"],
    "A birthday around the table": ["Susan", "Maya", "Anika"],
    "The kitchen before Diwali": ["Susan", "Maya", "Priya", "Anika"],
    "A long weekend in Acadia": ["Susan", "Maya", "Priya"],
  };
  return {
    source: "Fictional sample family connections",
    people: ["Susan", "Maya", "Anika", "Priya"].map(name => ({ name, momentIds: moments.filter(moment => peopleByMoment[moment.title]?.includes(name)).map(moment => moment.id) })),
    relationships: [
      { from: "Susan", to: "Maya", label: "Maya is Susan’s daughter.", relation: "daughter" },
      { from: "Susan", to: "Priya", label: "Priya is Susan’s sister.", relation: "sister" },
      { from: "Maya", to: "Anika", label: "Anika is Maya’s daughter.", relation: "daughter" },
      { from: "Susan", to: "Anika", label: "Anika is Susan’s granddaughter.", relation: "granddaughter" },
    ],
  };
}

/** The sample kit's own photo groups, the only ones the fictional demo material is written for. */
export const sampleDemoMoments = (state: CircleState): CircleMoment[] =>
  state.moments.filter((moment) => demoFixture.moments.some((entry) => entry.title === moment.title));

/**
 * Fictional family stories for the sample collection, so the Stories page has something in it
 * without a second upload. Every one is written as a named family member's own account, like any
 * other family contribution: none is attributed to the person Recall calls (AGENTS.md rules 1, 13).
 */
export function ensureSampleStories(household: string, owner: string) {
  const state = readCircle(household);
  if (!state.demo) return;
  const written = new Set(state.sampleStories ?? []);
  if (sampleDemoMoments(state).every((moment) => written.has(moment.id))) return;
  updateCircle(household, (current) => {
    if (!current.demo) return;
    const done = new Set(current.sampleStories ?? []);
    for (const moment of current.moments) {
      if (done.has(moment.id)) continue;
      const entry = demoFixture.moments.find((item) => item.title === moment.title);
      if (!entry) continue;
      // A few days after the photographs, so the collection reads in the order it happened.
      const at = new Date(Date.parse(moment.endAt ?? moment.startAt ?? new Date().toISOString()) + 3 * 86400000).toISOString();
      entry.stories.forEach((story, index) => {
        const id = `sample-story:${moment.id}:${index}`;
        if (current.stories.some((saved) => saved.id === id)) return;
        current.stories.push({ id, eventId: moment.id, author: story.author, owner, requestId: id, text: story.text, source: "written", createdAt: at });
        moment.revision++;
      });
      done.add(moment.id);
    }
    current.sampleStories = [...done];
  });
}

const version = "sample-family-upload-demo-v3";
const preserved = new Set(["Home Garden Morning", "Quiet Library Rooms"]);
const retained = [
  { event: "Home Garden Morning", files: ["princeton-kitchen.png", "princeton-garden.png", "princeton-front-garden.png"], date: "2025-06-22T16:00:00.000Z", lat: 40.3573, lon: -74.6672 },
  { event: "Quiet Library Rooms", files: ["lincoln-library.png", "lincoln-classroom-window.png", "lincoln-school.png"], date: "2025-05-04T14:00:00.000Z", lat: 42.4259, lon: -71.3039 },
];
const locations: Record<string, string> = {
  "Home Garden Morning": "At a home garden", "Quiet Library Rooms": "At the library",
};

export async function loadSampleFamily(household: string, owner: string, name: string, replaceExisting = false) {
  const before = readCircle(household);
  if (!before.demo) throw new CircleError("Sample photos belong in a sample family.", 403);
  const prior = before.imports.find((receipt) => receipt.id === version);
  if (prior && before.photos.length && !replaceExisting) return prior;
  const keepMoments = before.moments.filter((moment) => preserved.has(moment.title));
  const keepTitles = new Set(keepMoments.map((moment) => moment.title));
  const keepPhotos = new Set(keepMoments.flatMap((moment) => moment.photoIds));
  const replacePhotos = new Set(replaceExisting ? before.photos.filter((photo) => !keepPhotos.has(photo.id)).map((photo) => photo.id) : []);
  const replaceMoments = new Set(replaceExisting ? before.moments.filter((moment) => !preserved.has(moment.title)).map((moment) => moment.id) : []);
  const files = [
    ...retained.filter((group) => !keepTitles.has(group.event)).flatMap((group) => group.files.map((file) => ({ ...group, file, people: [] as string[], folder: "preview" }))),
  ];
  const folder = mediaFolder(household), prepared: { photo: CirclePhoto; event: string }[] = [];
  await mkdir(folder, { recursive: true, mode: 0o700 });
  try {
    for (const item of files) {
      const raw = await readFile(path.join(process.cwd(), "public", item.folder, item.file));
      const { data: bytes, info } = await sharp(raw).rotate().resize(1800, 1800, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true });
      const id = randomUUID();
      prepared.push({ event: item.event, photo: { id, name: item.file, url: `/api/circle/media/${id}`, hash: createHash("sha256").update(raw).digest("hex"), owner, contributor: name, capturedAt: item.date, addedAt: new Date().toISOString(), latitude: item.lat, longitude: item.lon, width: info.width, height: info.height, demo: true, namedPeople: item.people, caption: `Illustrative sample photograph · ${item.event}` } });
      await writeFile(path.join(folder, id + ".jpg"), bytes, { mode: 0o600 });
      await writeFile(path.join(folder, id + ".original"), raw, { mode: 0o600 });
    }
    const result = updateCircle(household, (state) => {
      if (!state.demo) throw new CircleError("Sample photos belong in a sample family.", 403);
      const replay = state.imports.find((receipt) => receipt.id === version);
      if (replay && state.photos.length && !replaceExisting) return { receipt: replay, removed: null };
      if (replaceExisting && JSON.stringify(state) !== JSON.stringify(before)) throw new CircleError("The collection changed while preparing the sample photos. Please reload.", 409);
      const removed = removeCollectionItems(state, replacePhotos, replaceMoments);
      const hashes = new Set(state.photos.map((photo) => photo.hash));
      const fresh = prepared.filter(({ photo }) => !hashes.has(photo.hash));
      state.photos.push(...fresh.map(({ photo }) => photo));
      const momentIds: string[] = [];
      for (const event of new Set(fresh.map((item) => item.event))) {
        const photos = fresh.filter((item) => item.event === event).map((item) => item.photo);
        const dates = photos.map((photo) => photo.capturedAt!).sort();
        const moment: CircleMoment = { id: `moment:${randomUUID()}`, title: event, place: locations[event] ?? "", photoIds: photos.map((photo) => photo.id), coverId: photos[0]!.id, startAt: dates[0]!, endAt: dates.at(-1)!, latitude: photos[0]!.latitude, longitude: photos[0]!.longitude, people: [], description: "Fictional family photographs for exploring Recall.", revision: 1, question: "What comes to mind when you see these photographs?", titleSource: "metadata", peopleCount: 0, analysis: "complete", participantIds: [], evidence: ["Illustrative sample photos", "Declared sample dates and places"] };
        state.moments.push(moment); momentIds.push(moment.id);
      }
      state.moments.sort((a, b) => (b.startAt ?? "").localeCompare(a.startAt ?? ""));
      const receipt = { id: version, at: new Date().toISOString(), owner, added: fresh.length, duplicates: prepared.length - fresh.length, moments: momentIds.length, momentIds, rejected: [], warning: null };
      state.imports = state.imports.filter((item) => item.id !== version); state.imports.push(receipt);
      return { receipt, removed };
    });
    if (result.removed) await removeCollectionFiles(household, result.removed);
    return result.receipt;
  } finally {
    const used = new Set(readCircle(household).photos.map((photo) => photo.id));
    await Promise.all(prepared.filter(({ photo }) => !used.has(photo.id)).flatMap(({ photo }) => [".jpg", ".original"].map((ext) => rm(path.join(folder, photo.id + ext), { force: true }))));
  }
}
