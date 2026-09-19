/**
 * The language lint (AGENTS.md section 12, test 8). One pure function over
 * lines of text; the script in /scripts and the tests both run it, over the
 * fixtures and over every line Relay actually rendered.
 *
 * It finds: evaluative or testing language (rule 11), diagnostic and
 * emotional-state words (rule 4), the rule 9 word list, anything that asks her
 * for money or identifiers (rule 16), and openers that test rather than invite
 * (section 6.1). The banned list lives in the call script and only grows.
 */
import { normalize, type BannedEntry } from "./call-script";

export interface LintLine {
  /** A script id, or where the text came from ("rendered:prompt:7"). */
  id: string;
  text: string;
  /** `call`: spoken to her. `family`: shown to family. */
  surface: "call" | "family";
}

export interface LintFinding {
  id: string;
  phrase: string;
  rule: number;
  text: string;
}

export function lintLines(lines: readonly LintLine[], banned: readonly BannedEntry[]): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const line of lines) {
    const text = normalize(line.text);
    for (const b of banned) {
      if (b.scope === "call" && line.surface !== "call") continue;
      if (b.allowed_in?.includes(line.id)) continue;
      const phrase = normalize(b.phrase);
      const hit = b.only_at_start ? text.startsWith(phrase) : text.includes(phrase);
      if (hit) findings.push({ id: line.id, phrase: b.phrase, rule: b.rule, text: line.text });
    }
  }
  return findings;
}

/**
 * How Relay talks (AGENTS.md §6.2). One question per turn; and sentences kept short, because it is
 * syntactic complexity - not speed - that costs comprehension. Checked over every line spoken to her.
 */
export function lintConduct(lines: readonly LintLine[], conduct: { max_questions_per_line: number; max_words_per_sentence: number }): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const line of lines.filter((l) => l.surface === "call")) {
    const questions = (line.text.match(/\?/g) ?? []).length;
    if (questions > conduct.max_questions_per_line) findings.push({ id: line.id, phrase: `${questions} questions in one turn`, rule: 6, text: line.text });
    for (const sentence of line.text.split(/(?<=[.?!])\s+/)) {
      const words = sentence.trim().split(/\s+/).filter(Boolean).length;
      if (words > conduct.max_words_per_sentence) findings.push({ id: line.id, phrase: `a sentence of ${words} words`, rule: 6, text: sentence });
    }
  }
  return findings;
}

/** Section 12, test 8: a rung-1 prompt is an invitation. It never opens by testing her. */
export const isInvitation = (text: string): boolean => {
  const t = normalize(text).trimStart();
  return !t.startsWith("who is") && !t.startsWith("do you remember") && !t.startsWith("can you remember") && !t.startsWith("what is the name");
};

const YES_NO_OPENERS = ["do", "did", "does", "is", "are", "was", "were", "can", "could", "will", "would", "have", "has", "had"];

/** Rule 13: a family-sourced cue ends in an open question - one that cannot be answered yes or no. */
export function endsInOpenQuestion(text: string): boolean {
  const sentences = text.split(/(?<=[.?!])\s+/).filter(Boolean);
  const last = sentences[sentences.length - 1] ?? "";
  if (!last.trim().endsWith("?")) return false;
  const first = normalize(last).trim().split(" ")[0] ?? "";
  return !YES_NO_OPENERS.includes(first);
}
