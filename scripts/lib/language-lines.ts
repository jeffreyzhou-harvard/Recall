/** Every fixed line in the fixtures, tagged with the surface it appears on. Shared by `npm run lint:language` and the tests. */
import { CALL_SCRIPT, FAMILY_COPY, SAFETY_PHRASES } from "@/fixtures";
import { allScriptLines } from "@/lib/script/call-script";
import type { LintLine } from "@/lib/script/lint";

export function collectFixedLines(): LintLine[] {
  const familySide = new Set([CALL_SCRIPT.lines.family_redirect.id, CALL_SCRIPT.lines.family_nothing_yet.id]);
  return [
    ...allScriptLines(CALL_SCRIPT).map((l): LintLine => ({ id: l.id, text: l.text, surface: familySide.has(l.id) ? "family" : "call" })),
    ...Object.values(FAMILY_COPY.lines).map((l): LintLine => ({ id: l.id, text: l.text, surface: "family" })),
    { id: SAFETY_PHRASES.alert.id, text: SAFETY_PHRASES.alert.text, surface: "family" },
    { id: SAFETY_PHRASES.ack_prompt.id, text: SAFETY_PHRASES.ack_prompt.text, surface: "family" },
    { id: SAFETY_PHRASES.missed_calls_alert.id, text: SAFETY_PHRASES.missed_calls_alert.text, surface: "family" },
    ...Object.entries(SAFETY_PHRASES.categories).map(([k, c]): LintLine => ({ id: `SAFETY-LABEL-${k}`, text: c.label, surface: "family" })),
  ];
}
