/**
 * The language lint (AGENTS.md section 12, test 8):  npm run lint:language
 *
 * Over every fixed line in call-script.json, family-copy.json, and safety-phrases.json, and then over
 * every line Relay actually rendered and every family surface it produced on the judged path. Finds
 * evaluative or testing language (rule 11), diagnostic and emotional-state words (rule 4), the rule 9
 * word list, and anything that asks her for money or identifiers (rule 16).
 */
import { CALL_SCRIPT } from "@/fixtures";
import { runJudgedPath } from "@/fixtures/harness";
import { lintConduct, lintLines, type LintLine } from "@/lib/script/lint";
import { collectFixedLines } from "./lib/language-lines";

const lines: LintLine[] = collectFixedLines();
const fixedCount = lines.length;

const run = await runJudgedPath();
for (const p of run.recording.prompts) lines.push({ id: `rendered:${p.script_id}`, text: p.text, surface: "call" });
for (const l of run.recording.caregiver_receipt?.lines ?? []) lines.push({ id: `receipt:${l.script_id}`, text: l.text, surface: "family" });
const note = await run.service.weeklyNote("person:maya");
for (const l of note.note?.lines ?? []) if (l.kind !== "share") lines.push({ id: `note:${l.script_id}`, text: l.text, surface: "family" }); // a shared line is her words, not Relay's
const record = await run.service.topicRecord("person:maya");
for (const l of [...(record.header ? [record.header] : []), ...record.topics.flatMap((t) => t.lines), ...record.change_lines, ...(record.summary_line ? [record.summary_line] : [])]) lines.push({ id: `record:${l.script_id}`, text: l.text, surface: "family" });

// A rendered line keeps its script id for the allow-list: "rendered:FAM-X" is checked as "FAM-X".
const checked = lines.map((l) => ({ ...l, id: l.id.replace(/^[a-z]+:/, "") }));
// Banned language everywhere; and, for what is spoken to her, one question a turn and short sentences (EVIDENCE.md, section C).
const findings = [...lintLines(checked, CALL_SCRIPT.banned), ...lintConduct(checked, CALL_SCRIPT.conduct)];
for (const f of findings) console.error(`  ${f.id}: "${f.phrase}" (rule ${f.rule})  in  "${f.text}"`);
console.log(`language lint: ${fixedCount} fixed line(s) and ${lines.length - fixedCount} rendered line(s) checked, ${findings.length} finding(s).`);
process.exit(findings.length === 0 ? 0 : 1);
