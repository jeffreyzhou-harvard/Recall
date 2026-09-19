/**
 * The family side's fixed lines and numbers: /fixtures/family-copy.json and
 * /fixtures/record-thresholds.json, validated (AGENTS.md section 6.4). Text on
 * a family surface comes only from here, or from a line she confirmed sharing.
 */
import { z } from "zod";

const line = z.strictObject({ id: z.string().regex(/^[A-Z0-9-]+$/), text: z.string().min(1) });

export const FAMILY_LINE_KEYS = [
  "note_warm",
  "note_gap",
  "note_difference",
  "note_pointer",
  "note_empty",
  "record_header",
  "record_unaided",
  "record_after_cue",
  "record_recognition",
  "record_not_enough",
  "change_topic",
  "change_summary",
  "export_note",
  "contribution_prompt",
  "contribution_question_hint",
  "contribution_thanks",
  "receipt_unaided",
  "receipt_context",
  "receipt_cue",
  "receipt_recognition",
  "receipt_reorientation",
  "receipt_not_reached",
  "receipt_no_call",
  "receipt_stopped",
  "receipt_safety",
  "receipt_conduct",
  "thesis",
] as const;
export type FamilyLineKey = (typeof FAMILY_LINE_KEYS)[number];

export const familyCopySchema = z.strictObject({
  version: z.literal(1),
  description: z.string(),
  lines: z.strictObject(Object.fromEntries(FAMILY_LINE_KEYS.map((k) => [k, line])) as Record<FamilyLineKey, typeof line>),
  /** A contribution that opens with one of these is a question, and is refused with the hint (section 6.4.1). */
  question_openers: z.array(z.string().min(1)).min(1),
  /** Words in a family QUESTION that put it in a category for the log. Matched against the question only - never against the graph. */
  query_categories: z.strictObject({ event: z.array(z.string()), place: z.array(z.string()), person: z.array(z.string()) }),
});
export type FamilyCopy = z.infer<typeof familyCopySchema>;

/** Not clinically validated; placeholders expected to change, with a second reviewer (Appendix B, item 4). */
export const recordThresholdsSchema = z.strictObject({
  version: z.literal(1),
  description: z.string(),
  record_window_calls: z.number().int().positive(),
  min_calls_to_show: z.number().int().positive(),
  change_window_calls: z.number().int().positive(),
  min_calls_to_compare: z.number().int().positive(),
  min_difference: z.number().int().positive(),
  min_topics_for_summary: z.number().int().positive(),
  weekly_note_days: z.number().int().positive(),
});
export type RecordThresholds = z.infer<typeof recordThresholdsSchema>;
