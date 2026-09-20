import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { mediaFolder } from "./photos";
import { CircleError, updateCircle, type CircleState } from "./store";

/** Drop collection stories and only recordings that no remaining story uses. */
function removeStories(state: CircleState, ids: Set<string>) {
  const removed = state.stories.filter(story => ids.has(story.id));
  state.stories = state.stories.filter(story => !ids.has(story.id));
  for (const story of removed) {
    // Keep the publication receipt, so a later call sync cannot recreate a deleted shared story.
    if (story.sharedFromCall && state.demoCall && !state.demoCall.sharedContributions.includes(story.sharedFromCall)) state.demoCall.sharedContributions.push(story.sharedFromCall);
  }
  const audioIds = new Set(removed.flatMap(story => {
    const id = story.audioUrl?.match(/^\/api\/circle\/media\/([a-f0-9-]{36})$/)?.[1];
    return id && !state.stories.some(kept => kept.audioUrl === story.audioUrl) ? [id] : [];
  }));
  state.drafts = state.drafts?.filter(draft => !audioIds.has(draft.id));
  return [...audioIds];
}

/** Prune all derived references in the same transaction as the collection edit. */
export function removeCollectionItems(state: CircleState, photoIds: Set<string>, momentIds: Set<string>) {
  state.photos = state.photos.filter((photo) => !photoIds.has(photo.id));
  for (const moment of state.moments) {
    if (!moment.photoIds.some((id) => photoIds.has(id))) continue;
    moment.photoIds = moment.photoIds.filter((id) => !photoIds.has(id));
    if (!moment.photoIds.length) { momentIds.add(moment.id); continue; }
    if (!moment.photoIds.includes(moment.coverId)) moment.coverId = moment.photoIds[0]!;
    const photos = state.photos.filter((photo) => moment.photoIds.includes(photo.id));
    const dates = photos.flatMap((photo) => photo.capturedAt ? [photo.capturedAt] : []).sort();
    const location = photos.find((photo) => photo.latitude !== null && photo.longitude !== null);
    moment.startAt = dates[0] ?? null; moment.endAt = dates.at(-1) ?? null;
    moment.latitude = location?.latitude ?? null; moment.longitude = location?.longitude ?? null;
    moment.revision++;
  }
  state.moments = state.moments.filter((moment) => !momentIds.has(moment.id));
  const audioIds = removeStories(state, new Set(state.stories.filter(story => momentIds.has(story.eventId)).map(story => story.id)));
  for (const receipt of state.imports) receipt.momentIds = receipt.momentIds?.filter((id) => !momentIds.has(id));
  if (state.faceIndex) {
    const index = state.faceIndex;
    index.faces = index.faces.filter((face) => !photoIds.has(face.photoId));
    index.scannedPhotoIds = index.scannedPhotoIds.filter((id) => !photoIds.has(id));
    index.groups = index.groups.filter((group) => index.faces.some((face) => face.groupId === group.id));
    index.generation = randomUUID(); index.revision++;
  }
  return { removedPhotoIds: [...photoIds], removedMomentIds: [...momentIds], audioIds: [...audioIds] };
}

export async function removeCollectionFiles(household: string, result: ReturnType<typeof removeCollectionItems>) {
  const files = [...result.removedPhotoIds.flatMap((id) => [id + ".jpg", id + ".original"]), ...result.audioIds.map((id) => id + ".audio")];
  const removed = await Promise.allSettled(files.map((file) => rm(path.join(mediaFolder(household), file), { force: true })));
  return removed.some((result) => result.status === "rejected") ? "Removed from your collection. Some local files could not be cleaned up." : null;
}

const deletion = z.object({
  kind: z.enum(["photo", "moment"]), id: z.string().min(1).max(100), momentId: z.string().min(1).max(100),
  revision: z.number().int().nonnegative(), storyCount: z.number().int().nonnegative(),
});
export async function deleteCollectionItem(household: string, canManage: boolean, input: unknown) {
  if (!canManage) throw new CircleError("Only a caregiver can delete photographs or photo groups.", 403);
  const edit = deletion.parse(input);
  const result = updateCircle(household, (state) => {
    const moment = state.moments.find((item) => item.id === edit.momentId);
    if (!moment || (edit.kind === "moment" ? moment.id !== edit.id : !moment.photoIds.includes(edit.id))) throw new CircleError("This photograph or group is no longer available.", 404);
    if (moment.revision !== edit.revision) throw new CircleError("This group has changed. Close and reopen it before deleting.", 409);
    const photoIds = new Set(edit.kind === "photo" ? [edit.id] : moment.photoIds.filter((id) => !state.moments.some((other) => other.id !== moment.id && other.photoIds.includes(id))));
    const momentIds = new Set(state.moments.filter((item) => item.id === (edit.kind === "moment" ? edit.id : "") || item.photoIds.every((id) => photoIds.has(id))).map((item) => item.id));
    if (state.stories.filter((story) => momentIds.has(story.eventId)).length !== edit.storyCount) throw new CircleError("The stories in this group have changed. Close and reopen it before deleting.", 409);
    return removeCollectionItems(state, photoIds, momentIds);
  });
  const warning = await removeCollectionFiles(household, result);
  return { removedPhotoIds: result.removedPhotoIds, removedMomentIds: result.removedMomentIds, warning };
}

export async function deleteStory(household: string, canManage: boolean, input: unknown) {
  if (!canManage) throw new CircleError("Only a caregiver can delete stories.", 403);
  const { id } = z.object({ id: z.string().min(1).max(200) }).parse(input);
  const result = updateCircle(household, state => {
    const story = state.stories.find(story => story.id === id);
    if (!story) throw new CircleError("This story is no longer in your family collection.", 404);
    const audioIds = removeStories(state, new Set([id]));
    const moment = state.moments.find(moment => moment.id === story.eventId);
    if (moment) moment.revision++;
    return { removedPhotoIds: [] as string[], removedMomentIds: [] as string[], audioIds };
  });
  const warning = await removeCollectionFiles(household, result);
  return { deletedStoryId: id, warning };
}
