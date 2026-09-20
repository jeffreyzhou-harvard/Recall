import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import exifr from "exifr";
import { getOnboarding } from "../onboarding";
import {
  CircleError,
  circleRoot,
  readCircle,
  updateCircle,
  type CirclePhoto,
  type CircleMoment,
} from "./store";
import { analyzePhotos, type PhotoGroup } from "./ai";
import { sampleKitGroups, sampleKitPhoto } from "./sample-kit";
const replayReceipt = (receipt: ReturnType<typeof readCircle>["imports"][number]) => ({
  ...receipt, rejected: receipt.rejected ?? [], momentIds: receipt.momentIds ?? [], warning: receipt.warning ?? null,
});
export const mediaFolder = (household: string) =>
  path.join(
    circleRoot(),
    createHash("sha256").update(household).digest("hex").slice(0, 24),
  );
export const distanceKm = (
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) => {
  const r = Math.PI / 180,
    dlat = (b.latitude - a.latitude) * r,
    dlon = (b.longitude - a.longitude) * r;
  const q =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a.latitude * r) *
      Math.cos(b.latitude * r) *
      Math.sin(dlon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(Math.max(0, 1 - q)));
};
export function fallbackGroups(photos: CirclePhoto[]): PhotoGroup[] {
  const groups: CirclePhoto[][] = [];
  for (const photo of photos) {
    const group = photo.capturedAt
      ? groups.find(
          (g) =>
            g[0]!.capturedAt &&
            Math.abs(
              Date.parse(g[0]!.capturedAt!) - Date.parse(photo.capturedAt!),
            ) <
              18 * 3600_000 &&
            (photo.latitude === null ||
              g[0]!.latitude === null ||
              distanceKm(
                { latitude: photo.latitude, longitude: photo.longitude! },
                { latitude: g[0]!.latitude, longitude: g[0]!.longitude! },
              ) < 30),
        )
      : undefined;
    if (group) group.push(photo);
    else groups.push([photo]);
  }
  return groups.map((g) => ({
    photoIds: g.map((p) => p.id),
    title: g[0]!.capturedAt
      ? new Date(g[0]!.capturedAt!).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        })
      : "A moment to rediscover",
    description: "Photographs kept together by their original capture details.",
    place: "",
    question: "What comes to mind when you see these photographs?",
    peopleCount: 0,
    captions: [],
  }));
}
export function mergeGroups(
  state: ReturnType<typeof readCircle>,
  groups: PhotoGroup[],
  photos: CirclePhoto[],
  ai: boolean,
  sample = false,
): string[] {
  const momentIds: string[] = [];
  for (const group of groups) {
    const items = group.photoIds
      .map((id) => photos.find((p) => p.id === id))
      .filter((p): p is CirclePhoto => !!p);
    if (!items.length) continue;
    const dates = items
      .flatMap((p) => (p.capturedAt ? [p.capturedAt] : []))
      .sort();
    const gps = items.find((p) => p.latitude !== null && p.longitude !== null);
    const names = [...new Set(items.flatMap((p) => p.namedPeople))];
    // Never fuse unrelated undated uploads merely because they have similar names.
    const previous = sample ? state.moments.find((moment) => moment.photoIds.some((id) => {
      const photo = state.photos.find((photo) => photo.id === id);
      return photo && sampleKitPhoto(photo.hash)?.event === group.title;
    })) : dates.length
      ? state.moments.find(
          (m) =>
            m.startAt &&
            Math.abs(Date.parse(m.startAt) - Date.parse(dates[0]!)) <
              18 * 3600_000 &&
            (gps && m.latitude !== null
              ? distanceKm(
                  { latitude: gps.latitude!, longitude: gps.longitude! },
                  { latitude: m.latitude, longitude: m.longitude! },
                ) < 15
              : m.title.toLowerCase() === group.title.toLowerCase()),
        )
      : undefined;
    const moment: CircleMoment = previous || {
      id: "moment:" + randomUUID(),
      title: group.title,
      place: group.place,
      photoIds: [],
      coverId: items.some((p) => p.id === group.coverPhotoId) ? group.coverPhotoId! : items[0]!.id,
      startAt: dates[0] || null,
      endAt: dates.at(-1) || null,
      latitude: gps?.latitude ?? null,
      longitude: gps?.longitude ?? null,
      people: [],
      description: group.description,
      revision: 0,
      question: group.question,
      titleSource: ai ? "ai" : "metadata",
      peopleCount: group.peopleCount,
      analysis: ai || sample ? "complete" : "unavailable",
      participantIds: [],
      evidence: [],
    };
    if (group.peopleCount > moment.peopleCount && items.some((p) => p.id === group.coverPhotoId))
      moment.coverId = group.coverPhotoId!;
    moment.peopleCount = Math.max(moment.peopleCount, group.peopleCount);
    moment.photoIds = [
      ...new Set([...moment.photoIds, ...items.map((p) => p.id)]),
    ];
    moment.people = [...new Set([...moment.people, ...names])];
    moment.revision++;
    if (dates.length) {
      moment.startAt = [moment.startAt, ...dates].filter(Boolean).sort()[0]!;
      moment.endAt = [moment.endAt, ...dates].filter(Boolean).sort().at(-1)!;
    }
    if (gps && moment.latitude === null) {
      moment.latitude = gps.latitude;
      moment.longitude = gps.longitude;
    }
    moment.evidence = [
      ...new Set([
        ...moment.evidence,
        ...(dates.length ? ["Capture dates"] : []),
        ...(gps ? ["Photo locations"] : []),
        ...(ai ? ["Visible setting & activities"] : []),
        ...(sample ? ["Sample photo kit"] : []),
      ]),
    ];
    if (!previous) state.moments.push(moment);
    momentIds.push(moment.id);
    for (const caption of group.captions) {
      const p = state.photos.find((p) => p.id === caption.photoId);
      if (p) p.caption = caption.caption;
    }
  }
  state.moments.sort((a, b) =>
    (b.startAt || "").localeCompare(a.startAt || ""),
  );
  return momentIds;
}
export async function uploadPhotos(
  household: string,
  owner: string,
  name: string,
  files: File[],
  requestId: string,
  fixtureMetadata?: Record<
    string,
    { date: string; latitude: number; longitude: number }
  >,
) {
  if (!requestId.trim() || requestId.length > 200)
    throw new CircleError("This upload needs a valid request identifier.");
  if (!files.length || files.length > 80)
    throw new CircleError("Choose 1–80 photos at a time.");
  if (files.reduce((n, f) => n + f.size, 0) > 240_000_000)
    throw new CircleError("Choose a smaller batch, up to 240 MB total.");
  const family = await getOnboarding().people(household);
  const snapshot = readCircle(household),
    prior = snapshot.imports.find((x) => x.id === requestId && (!x.owner || x.owner === owner));
  if (prior) return replayReceipt(prior);
  const folder = mediaFolder(household);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const prepared: { photo: CirclePhoto; bytes: Buffer }[] = [],
    rejected: { name: string; reason: string }[] = [];
  let duplicates = 0;
  const hashes = new Set(snapshot.photos.map((p) => p.hash));
  for (const file of files) {
    try {
      if (file.size > 25_000_000) throw new Error("Larger than 25 MB.");
      const raw = Buffer.from(await file.arrayBuffer()),
        hash = createHash("sha256").update(raw).digest("hex");
      if (hashes.has(hash)) {
        duplicates++;
        continue;
      }
      hashes.add(hash);
      let imageBytes = raw;
      // Browser uploads from iPhones may retain HEIC. Decode HEVC before the normal image pipeline.
      if (
        /^(heic|heix|hevc|hevx|mif1|msf1)$/.test(raw.toString("ascii", 8, 12))
      ) {
        const { default: convert } = await import("heic-convert");
        imageBytes = Buffer.from(
          await convert({ buffer: raw, format: "JPEG", quality: 0.94 }),
        );
      }
      const meta = await sharp(imageBytes, {
        limitInputPixels: 60_000_000,
      }).metadata();
      if (
        !["jpeg", "png", "webp", "heif", "avif", "tiff"].includes(meta.format)
      )
        throw new Error(
          "Choose a photograph in JPEG, PNG, WebP or HEIC format.",
        );
      const exif = await exifr
        .parse(raw, {
          gps: true,
          xmp: true,
          pick: [
            "DateTimeOriginal",
            "CreateDate",
            "GPSLatitude",
            "GPSLongitude",
            "GPSLatitudeRef",
            "GPSLongitudeRef",
            "XPKeywords",
            "Subject",
            "PersonInImage",
            "RegionPersonDisplayName",
          ],
        })
        .catch(() => null);
      const date = exif?.DateTimeOriginal || exif?.CreateDate;
      const fixture = fixtureMetadata?.[file.name];
      const sample = snapshot.demo ? sampleKitPhoto(hash) : undefined;
      const capturedAt =
        sample?.date ||
        fixture?.date ||
        (date instanceof Date && Number.isFinite(date.getTime())
          ? date.toISOString()
          : null);
      const latitude =
          sample?.lat ?? fixture?.latitude ??
          (typeof exif?.latitude === "number" && Math.abs(exif.latitude) <= 90
            ? exif.latitude
            : null),
        longitude =
          sample?.lon ?? fixture?.longitude ??
          (typeof exif?.longitude === "number" &&
          Math.abs(exif.longitude) <= 180
            ? exif.longitude
            : null);
      const id = randomUUID(),
        bytes = await sharp(imageBytes)
          .rotate()
          .resize(1800, 1800, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 88 })
          .toBuffer();
      await writeFile(path.join(folder, id + ".jpg"), bytes, { mode: 0o600 });
      await writeFile(path.join(folder, id + ".original"), raw, {
        mode: 0o600,
      });
      prepared.push({
        bytes,
        photo: {
          id,
          hash,
          name: file.name.slice(0, 160),
          url: "/api/circle/media/" + id,
          owner,
          contributor: name,
          capturedAt,
          addedAt: new Date().toISOString(),
          ...(sample ? { demo: true } : {}),
          width: meta.width,
          height: meta.height,
          latitude,
          longitude,
          namedPeople: [
            ...new Set(
              [exif?.PersonInImage, exif?.RegionPersonDisplayName]
                .flat(2)
                .filter(
                  (v): v is string =>
                    typeof v === "string" && v.trim().length > 0,
                )
                .map((v) => v.trim().slice(0, 80)),
            ),
          ],
        },
      });
    } catch (e) {
      rejected.push({
        name: file.name,
        reason:
          e instanceof Error ? e.message : "This photo could not be opened.",
      });
    }
  }
  if (!prepared.length)
    return {
      added: 0,
      duplicates,
      rejected,
      momentIds: [],
      moments: 0,
      warning: null,
    };
  const sampleGroups = snapshot.demo ? sampleKitGroups(prepared.map(({ photo }) => photo)) : [];
  const sampleIds = new Set(sampleGroups.flatMap((group) => group.photoIds));
  const groups: PhotoGroup[] = [...sampleGroups];
  let warning: string | null = null;
  const fallbackIds = new Set<string>();
  // Up to four independent batches run together, within the HTTP upload timeout.
  const batches = [];
  const ordinary = prepared.filter(({ photo }) => !sampleIds.has(photo.id));
  for (let i = 0; i < ordinary.length; i += 20) batches.push(ordinary.slice(i, i + 20));
  const analyzed = await Promise.all(batches.map(async (chunk) => {
    try {
      return await analyzePhotos(
          chunk.map(({ photo, bytes }) => ({ ...photo, bytes })),
      );
    } catch (error) {
      console.warn(
        "[circle organization]",
        error instanceof Error ? error.message : "Analysis failed",
      );
      warning =
        "Your photos are safe. AI organization is temporarily unavailable for some photos; capture dates were used instead.";
      chunk.forEach((p) => fallbackIds.add(p.photo.id));
      return fallbackGroups(chunk.map((p) => p.photo));
    }
  }));
  groups.push(...analyzed.flat());
  const result = updateCircle(household, (state) => {
    const prior = state.imports.find((x) => x.id === requestId && (!x.owner || x.owner === owner));
    if (prior) return replayReceipt(prior);
    const existing = new Set(state.photos.map((p) => p.hash));
    const fresh = prepared.filter((p) => !existing.has(p.photo.hash));
    const ids = new Set(fresh.map((p) => p.photo.id));
    state.photos.push(...fresh.map((p) => p.photo));
    const momentIds: string[] = [];
    for (const g of groups) {
      const limited = {
        ...g,
        photoIds: g.photoIds.filter((id) => ids.has(id)),
        coverPhotoId: g.coverPhotoId && ids.has(g.coverPhotoId) ? g.coverPhotoId : undefined,
        captions: g.captions.filter((c) => ids.has(c.photoId)),
      };
      if (limited.photoIds.length)
        momentIds.push(
          ...mergeGroups(
            state,
            [limited],
            fresh.map((p) => p.photo),
            !limited.photoIds.some((id) => fallbackIds.has(id) || sampleIds.has(id)),
            limited.photoIds.every((id) => sampleIds.has(id)),
          ),
        );
    }
    for (const moment of state.moments) {
      for (const name of moment.people) {
        const matches = family.filter(
          (p) => p.display_name.toLowerCase() === name.toLowerCase(),
        );
        if (
          matches.length === 1 &&
          !moment.participantIds.includes(matches[0]!.person_id)
        )
          moment.participantIds.push(matches[0]!.person_id);
      }
    }
    const receipt = {
      id: requestId,
      owner,
      at: new Date().toISOString(),
      added: fresh.length,
      duplicates: duplicates + prepared.length - fresh.length,
      moments: new Set(momentIds).size,
      momentIds: [...new Set(momentIds)],
      rejected,
      warning,
    };
    state.imports.push(receipt);
    return receipt;
  });
  const retained = new Set(readCircle(household).photos.map((p) => p.id));
  await Promise.all(
    prepared
      .filter((p) => !retained.has(p.photo.id))
      .flatMap((p) =>
        [".jpg", ".original"].map((ext) =>
          unlink(path.join(folder, p.photo.id + ext)).catch(() => {}),
        ),
      ),
  );
  return result;
}
export async function reanalyze(household: string, id: string) {
  const s = readCircle(household),
    m = s.moments.find((m) => m.id === id);
  if (!m) throw new CircleError("This moment is not available.", 404);
  const photos = s.photos.filter((p) => m.photoIds.includes(p.id));
  const groups: PhotoGroup[] = [];
  for (let i = 0; i < photos.length; i += 80) {
    const batches = [];
    for (let j = i; j < Math.min(i + 80, photos.length); j += 20) batches.push(photos.slice(j, j + 20));
    groups.push(...(await Promise.all(batches.map(async (batch) => analyzePhotos(
      await Promise.all(batch.map(async (p) => ({ ...p, bytes: await readFile(path.join(mediaFolder(household), p.id + ".jpg")) }))),
      { singleEvent: true },
    )))).flat());
  }
  return updateCircle(household, (state) => {
    const current = state.moments.find((x) => x.id === id);
    if (!current) throw new CircleError("This moment is no longer available.", 404);
    if (current.revision !== m.revision) throw new CircleError("This moment changed while it was being organized. Reopen it before analyzing again.", 409);
    const g = groups[0];
    if (!g) throw new CircleError("No photos to analyze.");
    if (current.titleSource !== "family") current.title = g.title;
    current.description = g.description;
    current.peopleCount = Math.max(...groups.map((group) => group.peopleCount));
    if (g.coverPhotoId) current.coverId = g.coverPhotoId;
    for (const caption of groups.flatMap((group) => group.captions)) {
      const photo = state.photos.find((p) => p.id === caption.photoId);
      if (photo) photo.caption = caption.caption;
    }
    current.evidence = [
      ...new Set([...current.evidence, "Visible setting & activities"]),
    ];
    current.question = g.question;
    current.place = g.place;
    current.analysis = "complete";
    current.titleSource = current.titleSource === "family" ? "family" : "ai";
    current.revision++;
    return current;
  });
}
