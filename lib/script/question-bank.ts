/**
 * The live model's few-shot bank (fixtures/reminiscence-techniques.md §3–4).
 * Category-tag lookup only: the bank is small, so embeddings would buy nothing.
 * The judged path never speaks these lines.
 */
import { z } from "zod";

export const BANK_CATEGORIES = ["childhood", "school", "work", "courtship", "parenting", "places", "holidays", "food", "music", "community", "person", "later_life"] as const;
export type BankCategory = (typeof BANK_CATEGORIES)[number];

const entry = z.strictObject({
  id: z.string().regex(/^QB-[A-Z0-9-]+$/),
  bank_category: z.enum(BANK_CATEGORIES),
  /** Call-script ladder categories this row may be retrieved for. Empty: core-few-shot only, never a live topic cue. */
  script_categories: z.array(z.string()),
  kind: z.enum(["opener", "followup"]),
  text: z.string().min(1),
  adaptation: z.enum(["R", "A", "G"]),
  source: z.string().min(1),
});
export type QuestionBankEntry = z.infer<typeof entry>;

export const questionBankSchema = z
  .strictObject({
    version: z.literal(1),
    description: z.string(),
    core_few_shot_ids: z.array(z.string()).min(10).max(15),
    entries: z.array(entry).min(1),
  })
  .superRefine((bank, ctx) => {
    const ids = new Set<string>();
    for (const row of bank.entries) {
      if (ids.has(row.id)) ctx.addIssue({ code: "custom", message: `duplicate question-bank id ${row.id}` });
      ids.add(row.id);
    }
    for (const id of bank.core_few_shot_ids) {
      if (!ids.has(id)) ctx.addIssue({ code: "custom", message: `core few-shot "${id}" is not in the bank` });
    }
  });
export type QuestionBank = z.infer<typeof questionBankSchema>;

/** The 10–15 examples that always go in the system prompt, so the tone is anchored before retrieval. */
export function coreFewShot(bank: QuestionBank): QuestionBankEntry[] {
  return bank.core_few_shot_ids.map((id) => bank.entries.find((e) => e.id === id)!);
}

/**
 * Category-matched examples for the live topic, on top of the core set.
 * Follow-ups are included so the model can deepen after she has started, never as a rung-1 opener.
 */
export function examplesForScriptCategory(bank: QuestionBank, scriptCategory: string | null | undefined): QuestionBankEntry[] {
  if (!scriptCategory) return [];
  const core = new Set(bank.core_few_shot_ids);
  return bank.entries.filter((e) => !core.has(e.id) && e.script_categories.includes(scriptCategory));
}

export function formatExamples(rows: readonly QuestionBankEntry[]): string {
  return rows.map((e) => `- (${e.kind}, ${e.bank_category}) ${e.text}`).join("\n");
}
