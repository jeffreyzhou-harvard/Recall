/** One-way, local-only caregiver suggestions. These never enter the patient preview state. */
export type MemorySuggestion = {
  id: string;
  contributor: string;
  patientConfirmed: false;
  kind: "memory" | "question";
  topicId: string | null;
  who: string;
  text: string;
  whenWhere: string;
  photo: File | null;
  createdAt: string;
};
export type SuggestionDraft = Pick<MemorySuggestion, "kind" | "topicId" | "who" | "text" | "whenWhere" | "photo">;

export function suggestionError(draft: SuggestionDraft, questionOpeners: readonly string[]): string | null {
  if (draft.kind === "memory" && !draft.who.trim()) return "Add who was part of this memory.";
  if (!draft.text.trim()) return draft.kind === "question" ? "Add one question you would like to suggest." : "Tell us a little about what you remember.";
  if (draft.who.length > 200 || draft.text.length > 2000 || draft.whenWhere.length > 200) return "Keep the memory to 2,000 characters, and the other fields to 200.";
  const start = draft.text.trim().toLowerCase().replace(/[’‘]/g, "'");
  const firstSentence = start.split(/(?<=[.?!])\s+/)[0] ?? "";
  if (draft.kind === "memory" && (firstSentence.endsWith("?") || questionOpeners.some((opener) => start.startsWith(opener.toLowerCase() + " ")))) {
    return "This reads like a question. Choose ‘Suggest a question’ so it stays separate from your own memory.";
  }
  if (draft.kind === "question" && (draft.text.length > 280 || (draft.text.match(/\?/g)?.length ?? 0) > 1)) {
    return "Suggest one short question, up to 280 characters. There will be room for other topics another time.";
  }
  if (draft.photo && (!["image/jpeg", "image/png", "image/webp"].includes(draft.photo.type) || draft.photo.size > 10 * 1024 * 1024)) {
    return "Choose a JPG, PNG or WebP photo smaller than 10 MB.";
  }
  return null;
}
