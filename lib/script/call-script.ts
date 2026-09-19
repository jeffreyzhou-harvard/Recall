/**
 * Relay's fixed lines (AGENTS.md section 6.2). Every line Relay can say that
 * carries no factual claim lives in /fixtures/call-script.json under a stable
 * script id; this module validates that file and fills its slots.
 *
 * A slot is filled with a value the caller took from a graph node or the joint
 * setup - never with free text, and never with anything she said. A template
 * with a slot left over, or a value for a slot the template does not have, is
 * an error: a line is either exactly what was reviewed, or it is not said.
 */
import { z } from "zod";

const line = z.strictObject({ id: z.string().regex(/^[A-Z0-9-]+$/), text: z.string().min(1) });
export type ScriptLine = z.infer<typeof line>;

/**
 * What kind of memory a topic category holds. Stating a fact outright - the ladder's last rung - has evidence
 * behind it only for procedural or functional information; for an autobiographical or identity memory it
 * shades into correction (AGENTS.md §6.1). So a category says
 * which it is, and an autobiographical one cannot even carry a reorientation line.
 */
export const MEMORY_KINDS = ["autobiographical", "procedural"] as const;

const categoryLines = z
  .strictObject({
    memory_kind: z.enum(MEMORY_KINDS),
    context: line,
    association: z.strictObject({ person: line.optional(), photo: line.optional() }).optional(),
    recognition: line.optional(),
    reorientation: line.optional(),
    elaborate: line.optional(),
  })
  .refine((c) => c.memory_kind === "procedural" || c.reorientation === undefined, {
    message: "an autobiographical category has no reorientation line: Relay never states such a memory outright",
    path: ["reorientation"],
  });
export type CategoryLines = z.infer<typeof categoryLines>;

export const bannedEntry = z.strictObject({
  phrase: z.string().min(1),
  /** The AGENTS.md rule (or section 6.1, as 6) the phrase would break. */
  rule: z.number().int(),
  /** Fixed lines that may contain it because they negate it: "not a clinical assessment or diagnosis". */
  allowed_in: z.array(z.string()).optional(),
  /** `call`: only lines spoken to her are checked for it. */
  scope: z.enum(["call"]).optional(),
  /** Banned only as the way a line opens ("Who is..."). */
  only_at_start: z.boolean().optional(),
});
export type BannedEntry = z.infer<typeof bannedEntry>;

export const callScriptSchema = z.strictObject({
  version: z.literal(1),
  description: z.string(),
  lines: z.strictObject({
    greeting: line,
    identity: line,
    store_question: line,
    share_question: line,
    close_warm: line,
    close_kind: line,
    close_not_stored: line,
    narrowing: line,
    stop_ack: line,
    backchannel_wait: line,
    safety: line,
    family_redirect: line,
    family_nothing_yet: line,
  }),
  ladder: z.strictObject({
    free_recall: line,
    family_sourced_association: line,
    elaborate_default: line,
    categories: z.record(z.string(), categoryLines),
  }),
  stop_phrases: z.array(z.string().min(1)).min(1),
  identity_phrases: z.array(z.string().min(1)).min(1),
  /** How Relay talks (AGENTS.md §6.2): one question at a time, and short sentences rather than slow ones. */
  conduct: z.strictObject({ max_questions_per_line: z.number().int().positive(), max_words_per_sentence: z.number().int().positive() }),
  unsure_phrases: z.array(z.string().min(1)).min(1),
  /** Short replies that say she is with the topic without yet saying anything about it. Relay then asks the open follow-up. */
  affirm_phrases: z.array(z.string().min(1)).min(1),
  banned: z.array(bannedEntry).min(1),
});
export type CallScript = z.infer<typeof callScriptSchema>;
export type FixedLineKey = keyof CallScript["lines"];

export class ScriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptError";
  }
}

const SLOT = /\{([a-z_]+)\}/g;
export const slotsOf = (text: string): string[] => [...text.matchAll(SLOT)].map((m) => m[1]!);

/** Fill a reviewed line. Every slot must be given, nothing extra may be, and no value may smuggle in another slot. */
export function fill(template: ScriptLine, values: Readonly<Record<string, string>>): string {
  const wanted = new Set(slotsOf(template.text));
  for (const key of Object.keys(values)) if (!wanted.has(key)) throw new ScriptError(`${template.id} has no slot "{${key}}"`);
  for (const slot of wanted) {
    const value = values[slot];
    if (value === undefined || value.trim() === "") throw new ScriptError(`${template.id} needs a value for "{${slot}}"`);
    if (/[{}]/.test(value)) throw new ScriptError(`a value for "{${slot}}" may not contain braces`);
  }
  return template.text.replace(SLOT, (_, slot: string) => values[slot]!);
}

/** Every fixed line in the script, flat, for the lint and for checking that script ids are unique. */
export function allScriptLines(script: CallScript): ScriptLine[] {
  const out: ScriptLine[] = [...Object.values(script.lines), script.ladder.free_recall, script.ladder.family_sourced_association, script.ladder.elaborate_default];
  for (const c of Object.values(script.ladder.categories)) {
    out.push(c.context);
    for (const l of [c.association?.person, c.association?.photo, c.recognition, c.reorientation, c.elaborate]) if (l) out.push(l);
  }
  return out;
}

/** Lowercased, punctuation to spaces, apostrophes kept: the one normal form every lexical rule in Relay matches on. */
export const normalize = (text: string): string =>
  ` ${text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()} `;

/** Does the text contain the phrase as whole words? "correction" does not contain "correct". */
export const containsPhrase = (text: string, phrase: string): boolean => normalize(text).includes(normalize(phrase));

/** The first phrase on a list that the text contains, as whole words, or null. */
export const firstPhraseIn = (text: string, phrases: readonly string[]): string | null => phrases.find((p) => containsPhrase(text, p)) ?? null;
