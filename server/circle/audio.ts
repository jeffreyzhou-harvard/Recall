import { unlink } from "node:fs/promises";
import path from "node:path";
import { mediaFolder } from "./photos";
import { CircleError, updateCircle } from "./store";

/** Draft recordings are private until explicitly saved; abandoned drafts expire. */
export async function discardAudio(household: string, owner: string, id: string) {
  const removed = updateCircle(household, (state) => {
    const draft = state.drafts?.find((d) => d.id === id);
    if (!draft) return false;
    if (draft.owner !== owner) throw new CircleError("Use your own recording.", 403);
    if (state.stories.some((s) => s.audioUrl === `/api/circle/media/${id}`)) return false;
    state.drafts = state.drafts!.filter((d) => d.id !== id);
    return true;
  });
  if (removed) await unlink(path.join(mediaFolder(household), id + ".audio")).catch((e: NodeJS.ErrnoException) => { if (e.code !== "ENOENT") throw e; });
}

export async function expireAudioDrafts(household: string) {
  const expired = updateCircle(household, (state) => {
    const shared = new Set(state.stories.map((s) => s.audioUrl));
    const stale = (state.drafts ?? []).filter((d) => Date.parse(d.createdAt) < Date.now() - 3600_000 && !shared.has(`/api/circle/media/${d.id}`));
    const ids = new Set(stale.map((d) => d.id));
    if (ids.size) state.drafts = state.drafts!.filter((d) => !ids.has(d.id));
    return stale;
  });
  await Promise.all(expired.map((d) => unlink(path.join(mediaFolder(household), d.id + ".audio")).catch((e: NodeJS.ErrnoException) => { if (e.code !== "ENOENT") throw e; })));
}
