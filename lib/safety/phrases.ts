/**
 * The fixed safety list (AGENTS.md rule 15), and the only thing that reads it.
 *
 * This is a lexical match on her literal words. It infers nothing about her,
 * it will miss things, and it will sometimes fire on a harmless phrase ("I fell
 * in love with Maya"): a neutral note to her caregiver is the accepted cost of
 * not missing a real one. Relay is not an emergency service.
 */
import { z } from "zod";
import { containsPhrase } from "@/lib/script/call-script";

export const safetyPhrasesSchema = z.strictObject({
  version: z.literal(1),
  description: z.string(),
  categories: z.record(z.string().regex(/^[a-z_]+$/), z.strictObject({ label: z.string().min(1), phrases: z.array(z.string().min(1)).min(1) })),
  alert: z.strictObject({ id: z.string().min(1), text: z.string().min(1) }),
});
export type SafetyPhrases = z.infer<typeof safetyPhrasesSchema>;

export interface SafetyMatch {
  category: string;
  /** Which entry on the list matched. For the tool log only: it is a phrase from the list, never her sentence. */
  list_phrase: string;
}

/** Categories are checked in the file's order and the first match wins, so the same words always give the same category. */
export function matchSafetyPhrase(list: SafetyPhrases, herWords: string): SafetyMatch | null {
  for (const [category, entry] of Object.entries(list.categories)) {
    const hit = entry.phrases.find((p) => containsPhrase(herWords, p));
    if (hit) return { category, list_phrase: hit };
  }
  return null;
}
