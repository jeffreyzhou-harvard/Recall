/** AGENTS.md section 12, test 8: language and conduct. The same lint runs here, in `npm run lint:language`, and inside render_prompt. */
import { describe, expect, it } from "vitest";
import { CALL_SCRIPT, FAMILY_COPY, SAFETY_PHRASES } from "@/fixtures";
import { runJudgedPath } from "@/fixtures/harness";
import { allScriptLines, fill, slotsOf } from "@/lib/script/call-script";
import { endsInOpenQuestion, isInvitation, lintLines, type LintLine } from "@/lib/script/lint";
import { collectFixedLines } from "@/scripts/lib/language-lines";
import { CAPTURE_AND_CONFIRM, OPENING, SAID, run } from "./helpers";

const banned = CALL_SCRIPT.banned;
const call = (text: string): LintLine[] => [{ id: "x", text, surface: "call" }];

describe("the banned-phrase lint", () => {
  it("passes over every fixed line Relay can say and every fixed line the family side can show", () => {
    const lines = collectFixedLines();
    expect(lines.length).toBeGreaterThan(50);
    expect(lintLines(lines, banned)).toEqual([]);
  });

  it("passes over every line Relay actually rendered and every family surface it produced, across the branches", async () => {
    const golden = await runJudgedPath();
    const climbed = await run([...OPENING, ["her", "Cape May...?"], ["relay", SAID.rung2], ["her", "I'm not sure."], ["relay", SAID.rung3], ["her", "Hmm."], ["relay", SAID.rung4], ["her", "My sister."], ["relay", SAID.rung5], ...CAPTURE_AND_CONFIRM()]);
    const lines: LintLine[] = [];
    for (const r of [golden, climbed]) {
      for (const p of r.recording.prompts) lines.push({ id: p.script_id, text: p.text, surface: "call" });
      for (const l of r.recording.caregiver_receipt!.lines) lines.push({ id: l.script_id, text: l.text, surface: "family" });
      const note = await r.service.weeklyNote("person:maya");
      for (const l of note.note!.lines.filter((l) => l.kind !== "share")) lines.push({ id: l.script_id, text: l.text, surface: "family" }); // a shared line is her words, not Relay's
      const record = await r.service.topicRecord("person:maya");
      for (const l of [record.header!, ...record.topics.flatMap((t) => t.lines), ...record.change_lines]) lines.push({ id: l.script_id, text: l.text, surface: "family" });
      lines.push({ id: "FAM-EXPORT", text: (await r.service.exportRecord("person:maya")).file!.text.replace(FAMILY_COPY.lines.export_note.text, ""), surface: "family" });
    }
    expect(lintLines(lines, banned)).toEqual([]);
  });

  it.each([
    ["rule 11", ["That's wrong.", "Try again.", "You forgot.", "Good job!", "That's right!", "No, actually it was Maya.", "Incorrect."]],
    ["rule 4", ["She seemed confused today.", "Her mood was low.", "Cognitive testing.", "She was thinking of you."]],
    ["rule 9", ["A decline since last month.", "Signs of improvement.", "Good progress this week.", "It is getting worse.", "She did better today.", "Relay will monitor her.", "An early stage."]],
    ["rule 16", ["What is your account number?", "Can you send money?", "Tell me your password.", "Which bank do you use?"]],
  ])("finds %s language", (_rule, texts) => {
    for (const text of texts) expect(lintLines(call(text), banned), text).not.toEqual([]);
  });

  it("matches whole words and phrases: 'correction' is not 'correct', and a disclaimer may say what it disclaims", () => {
    expect(lintLines(call("No correction, no distress."), banned)).toEqual([]);
    expect(lintLines([{ id: "FAM-EXPORT-NOTE", text: FAMILY_COPY.lines.export_note.text, surface: "family" }], banned)).toEqual([]);
    expect(lintLines([{ id: "SOMEWHERE-ELSE", text: FAMILY_COPY.lines.export_note.text, surface: "family" }], banned).map((f) => f.phrase).sort()).toEqual(["clinical assessment", "diagnosis"]);
  });

  it("render_prompt refuses a line that would carry banned language, whatever filled the slot", async () => {
    const script = structuredClone(CALL_SCRIPT);
    script.lines.close_kind.text = "That's wrong, but we can try again another time.";
    await expect(run([...OPENING], { script })).resolves.toMatchObject({ recording: { final_state: "blocked" } }); // refused before the call is ever placed
  });
});

describe("conduct", () => {
  it("rung-1 prompts are invitations: never 'Who is...', never 'Do you remember...'", () => {
    expect(isInvitation(fill(CALL_SCRIPT.ladder.free_recall, { topic: "the summers at Cape May" }))).toBe(true);
    expect(isInvitation(fill(CALL_SCRIPT.ladder.free_recall, { topic: "Maya" }))).toBe(true); // a person topic, when the setup enables one
    for (const opener of ["Who is Maya?", "Do you remember Cape May?", "Can you remember the summers?"]) {
      expect(isInvitation(opener)).toBe(false);
      expect(lintLines(call(opener), banned)).not.toEqual([]);
    }
    // Not at the start, the same words are an open question, not a test - and they are the golden path's own line.
    expect(lintLines(call("What do you remember about those summers?"), banned)).toEqual([]);
  });

  it("every family-sourced cue ends in an open question, never a yes/no one (rule 13)", () => {
    const attributed = allScriptLines(CALL_SCRIPT).filter((l) => slotsOf(l.text).includes("author"));
    expect(attributed.map((l) => l.id).sort()).toEqual(["LADDER-3-FAMILY-SOURCED", "LADDER-3-PHOTO-FAMILY-SUMMERS"]);
    for (const l of attributed) expect(endsInOpenQuestion(l.text), l.id).toBe(true);
    expect(endsInOpenQuestion("Maya mentioned a trip to Cape May. Do you remember that?")).toBe(false);
    expect(endsInOpenQuestion("Maya mentioned a trip to Cape May.")).toBe(false);
  });

  it("rungs 1-4 never state the answer; only rung 5 says 'You told me', and only of her own words", () => {
    for (const l of allScriptLines(CALL_SCRIPT)) expect(/you told me/i.test(l.text), l.id).toBe(/^LADDER-5-/.test(l.id));
  });

  it("script ids are unique, and every slot is one Relay knows how to fill from the graph or the joint setup", () => {
    const lines = [...allScriptLines(CALL_SCRIPT), ...Object.values(FAMILY_COPY.lines), SAFETY_PHRASES.alert];
    expect(new Set(lines.map((l) => l.id)).size).toBe(lines.length);
    const known = new Set(["name", "set_up_by", "caregiver", "emergency_number", "topic", "cue", "person", "author", "place", "relation", "option_a", "option_b"]);
    for (const l of allScriptLines(CALL_SCRIPT)) for (const slot of slotsOf(l.text)) expect(known.has(slot), `${l.id} {${slot}}`).toBe(true);
  });

  it("the first line of every call says Relay is an AI assistant set up by a named family member; the identity line says it is not a person", () => {
    expect(CALL_SCRIPT.lines.greeting.text).toMatch(/I'm Relay, an AI assistant \{set_up_by\} set up/);
    expect(CALL_SCRIPT.lines.identity.text).toMatch(/a computer assistant, not a person/);
    expect(CALL_SCRIPT.lines.safety.text).toMatch(/\{caregiver\}.*\{emergency_number\}/);
  });

  it("the safety alert has no slot that could carry her words", () => {
    expect(slotsOf(SAFETY_PHRASES.alert.text).sort()).toEqual(["category", "name", "name", "time"]);
    expect(SAFETY_PHRASES.alert.text).toMatch(/not an emergency service/);
  });
});
