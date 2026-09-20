import { randomUUID } from "node:crypto";
import { z } from "zod";
import sharp from "sharp";
import path from "node:path";
import { mediaFolder } from "./photos";
import { emptyFaceIndex, FACE_MODEL, type FaceIndex, type PeopleView } from "@/lib/people/types";
import { CircleError, readCircle, updateCircle, type CircleState } from "./store";

// A larger descriptor distance permits slightly more variation between photos.
const FACE_MATCH_DISTANCE = 0.52;

const box = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) })
  .refine(b => b.x + b.width <= 1.00001 && b.y + b.height <= 1.00001, "Face must fit inside the photo.");
const scanSchema = z.object({
  model: z.literal(FACE_MODEL), generation: z.string().max(80),
  photos: z.array(z.object({ photoId: z.string().uuid(), faces: z.array(z.object({ box, score: z.number().min(0.5).max(1), descriptor: z.array(z.number().min(-10).max(10)).length(128).refine(v => v.some(n => n !== 0), "Empty face descriptor.") })).max(30) })).min(1).max(8),
});
export function peopleView(state: CircleState): PeopleView {
  const index = state.faceIndex ?? emptyFaceIndex();
  return {
    generation: index.generation, revision: index.revision, scannedPhotoIds: index.scannedPhotoIds,
    groups: index.groups.map(group => {
      const faces = index.faces.filter(f => f.groupId === group.id).map(({ id, photoId, box }) => ({ id, photoId, box }));
      return { ...group, faces, photoIds: [...new Set(faces.map(f => f.photoId))] };
    }).filter(g => g.faces.length).sort((a, b) => b.photoIds.length - a.photoIds.length || a.id.localeCompare(b.id)),
  };
}
export const getPeople = (household: string) => peopleView(readCircle(household));
export async function faceThumbnail(household: string, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new CircleError("Face unavailable.", 404);
  const state = readCircle(household), face = state.faceIndex?.faces.find(f => f.id === id);
  if (!face || !state.photos.some(p => p.id === face.photoId)) throw new CircleError("Face unavailable.", 404);
  const image = sharp(path.join(mediaFolder(household), face.photoId + ".jpg"));
  const meta = await image.metadata(), width = meta.width!, height = meta.height!;
  const size = Math.min(width, height, Math.max(1, Math.round(Math.max(face.box.width * width, face.box.height * height) * 1.5)));
  const left = Math.max(0, Math.min(width - size, Math.round((face.box.x + face.box.width / 2) * width - size / 2)));
  const top = Math.max(0, Math.min(height - size, Math.round((face.box.y + face.box.height / 2) * height - size / 2)));
  return image.extract({ left, top, width: size, height: size }).resize(240, 240).jpeg({ quality: 85 }).toBuffer();
}
export function faceDistance(a: number[], b: number[]) { return Math.sqrt(a.reduce((sum, n, i) => sum + (n - b[i]!) ** 2, 0)); }

export function saveFaceScan(household: string, input: unknown) {
  const batch = scanSchema.parse(input);
  return updateCircle(household, state => {
    const index = state.faceIndex ??= emptyFaceIndex();
    if (index.generation !== batch.generation || index.model !== batch.model) throw new CircleError("People was reset. Refresh before finding faces again.", 409);
    const photoIds = new Set(state.photos.map(p => p.id));
    if (new Set(batch.photos.map(p => p.photoId)).size !== batch.photos.length || batch.photos.some(p => !photoIds.has(p.photoId))) throw new CircleError("Use photos from this collection.", 404);
    let changed = false;
    for (const photo of batch.photos) {
      if (index.scannedPhotoIds.includes(photo.photoId)) continue;
      for (const detection of photo.faces) {
        // Complete-link matching avoids chaining different people through one weak match.
        // Two faces in the same photograph never join automatically.
        const candidates = index.groups.flatMap(group => {
          const faces = index.faces.filter(f => f.groupId === group.id);
          if (!faces.length || faces.some(f => f.photoId === photo.photoId)) return [];
          const distance = Math.max(...faces.map(f => faceDistance(f.descriptor, detection.descriptor)));
          return distance < FACE_MATCH_DISTANCE ? [{ group, distance }] : [];
        }).sort((a, b) => a.distance - b.distance);
        const best = candidates[0];
        const group = best && (!candidates[1] || candidates[1].distance - best.distance >= 0.06) ? best.group : { id: randomUUID(), name: "" };
        if (!index.groups.some(g => g.id === group.id)) index.groups.push(group);
        index.faces.push({ ...detection, id: randomUUID(), photoId: photo.photoId, groupId: group.id });
      }
      index.scannedPhotoIds.push(photo.photoId);
      changed = true;
    }
    if (changed) index.revision++;
    return peopleView(state);
  });
}

const editSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("name"), id: z.string().uuid(), name: z.string().trim().max(80), revision: z.number().int().nonnegative() }),
  z.object({ action: z.literal("merge"), id: z.string().uuid(), targetId: z.string().uuid(), revision: z.number().int().nonnegative() }),
  z.object({ action: z.literal("separate"), faceId: z.string().uuid(), revision: z.number().int().nonnegative() }),
  z.object({ action: z.literal("dismiss"), faceId: z.string().uuid(), revision: z.number().int().nonnegative() }),
  z.object({ action: z.literal("clear"), revision: z.number().int().nonnegative() }),
]);
export function editPeople(household: string, author: string, canManage: boolean, input: unknown) {
  const edit = editSchema.parse(input);
  return updateCircle(household, state => {
    const index: FaceIndex = state.faceIndex ??= emptyFaceIndex();
    if (index.revision !== edit.revision) throw new CircleError("People changed. Refresh and save again.", 409);
    if (edit.action === "clear") {
      if (!canManage) throw new CircleError("Only your family organizer can clear all face groups.", 403);
      state.faceIndex = { ...emptyFaceIndex(), generation: randomUUID(), revision: index.revision + 1 };
      return peopleView(state);
    }
    if (edit.action === "name" || edit.action === "merge") {
      const group = index.groups.find(g => g.id === edit.id);
      if (!group) throw new CircleError("This person group is no longer available.", 404);
      if (edit.action === "name") {
        group.name = edit.name; group.labeledBy = author; group.labeledAt = new Date().toISOString();
      } else {
        const target = index.groups.find(g => g.id === edit.targetId);
        if (edit.targetId === edit.id || !target) throw new CircleError("Choose a different person group.");
        if (!target.name && group.name) {
          target.name = group.name; target.labeledBy = group.labeledBy; target.labeledAt = group.labeledAt;
        }
        index.faces.filter(f => f.groupId === edit.id).forEach(f => { f.groupId = edit.targetId; });
        index.groups = index.groups.filter(g => g.id !== edit.id);
      }
    } else {
      const face = index.faces.find(f => f.id === edit.faceId);
      if (!face) throw new CircleError("This face is no longer available.", 404);
      if (edit.action === "dismiss") index.faces = index.faces.filter(f => f.id !== face.id);
      else {
        const group = { id: randomUUID(), name: "" };
        index.groups.push(group); face.groupId = group.id;
      }
      index.groups = index.groups.filter(g => index.faces.some(f => f.groupId === g.id));
    }
    index.revision++;
    return peopleView(state);
  });
}
