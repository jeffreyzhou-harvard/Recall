/** Replace a local sample collection, retaining the two requested groups and a private backup. */
import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readCircle, circleRoot } from "@/server/circle/store";
import { mediaFolder } from "@/server/circle/photos";
import { loadSampleFamily } from "@/server/circle/sample";

const household = process.argv[2];
if (!household) throw new Error("Supply the sample household id.");
const before = readCircle(household);
if (!before.demo || !before.photos.length) throw new Error("Choose an existing sample family with photographs.");
const keep = before.moments.filter((moment) => ["Home Garden Morning", "Quiet Library Rooms"].includes(moment.title));
if (keep.length !== 2) throw new Error("Both retained photo groups must exist before replacement.");
const owner = before.photos.find((photo) => keep[0]!.photoIds.includes(photo.id))!;
const backup = path.join(circleRoot(), "backups", `family-kit-${Date.now()}`);
await mkdir(backup, { recursive: true, mode: 0o700 });
const confirmedAudio = new Set(before.stories.flatMap(story => story.audioUrl?.match(/^\/api\/circle\/media\/([a-f0-9-]{36})$/)?.slice(1) ?? []));
await writeFile(path.join(backup, "state.json"), JSON.stringify({ ...before, drafts: before.drafts?.filter(draft => confirmedAudio.has(draft.id)) }, null, 2), { mode: 0o600 });
await mkdir(path.join(backup, "media"), { mode: 0o700 });
const files = [...before.photos.flatMap(photo => [photo.id + ".jpg", photo.id + ".original"]), ...[...confirmedAudio].map(id => id + ".audio")];
await Promise.all(files.map(file => cp(path.join(mediaFolder(household), file), path.join(backup, "media", file))));
await loadSampleFamily(household, owner.owner, owner.contributor, true);
const after = readCircle(household);
for (const original of keep) {
  if (JSON.stringify(after.moments.find((moment) => moment.id === original.id)) !== JSON.stringify(original)) throw new Error("A retained group changed; the backup is available at " + backup);
}
console.log(JSON.stringify({ photos: after.photos.length, groups: after.moments.map((moment) => ({ title: moment.title, photos: moment.photoIds.length })), backup }, null, 2));
