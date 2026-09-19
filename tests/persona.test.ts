/** The live model's persona and question bank: the LLM is bound by these, and they stay inside AGENTS.md. */
import { describe, expect, it } from "vitest";
import { CALL_SCRIPT, QUESTION_BANK } from "@/fixtures";
import { museScaffoldAdvisor } from "@/lib/providers/muse/reasoning";
import { MuseSpark, type MuseFetch } from "@/lib/providers/muse/spark";
import { CALL_PERSONA_RULES, callSystemPrompt } from "@/lib/script/persona";
import { coreFewShot, examplesForScriptCategory } from "@/lib/script/question-bank";
import { isInvitation, lintConduct, lintLines } from "@/lib/script/lint";

describe("the question bank", () => {
  it("has a 10–15 example core set that spans categories, and every id resolves", () => {
    expect(QUESTION_BANK.core_few_shot_ids.length).toBeGreaterThanOrEqual(10);
    expect(QUESTION_BANK.core_few_shot_ids.length).toBeLessThanOrEqual(15);
    expect(new Set(coreFewShot(QUESTION_BANK).map((e) => e.bank_category)).size).toBeGreaterThanOrEqual(8);
  });

  it("every opener is an invitation, and no row opens as a test or names a feeling", () => {
    for (const e of QUESTION_BANK.entries) {
      if (e.kind === "opener") {
        expect(isInvitation(e.text), e.id).toBe(true);
        expect(e.text, e.id).not.toMatch(/do you remember/i);
      }
      expect(e.text, e.id).not.toMatch(/^(who is|what is the name)/i);
      expect(e.text, e.id).not.toMatch(/\b(sad|heavy|upset|distressed|mood)\b/i);
    }
    expect(lintLines(QUESTION_BANK.entries.map((e) => ({ id: e.id, text: e.text, surface: "call" })), CALL_SCRIPT.banned)).toEqual([]);
    expect(lintConduct(QUESTION_BANK.entries.map((e) => ({ id: e.id, text: e.text, surface: "call" })), CALL_SCRIPT.conduct)).toEqual([]);
  });

  it("pulls only same-category extras on top of the core set", () => {
    const summers = examplesForScriptCategory(QUESTION_BANK, "family_summers");
    expect(summers.every((e) => e.script_categories.includes("family_summers"))).toBe(true);
    expect(summers.some((e) => e.id === "QB-HOLIDAY-SMELL")).toBe(true);
    expect(summers.map((e) => e.id)).not.toContain("QB-PLACE-OPEN"); // already in the core set
    expect(examplesForScriptCategory(QUESTION_BANK, "workplace").every((e) => e.script_categories.includes("workplace"))).toBe(true);
    expect(examplesForScriptCategory(QUESTION_BANK, null)).toEqual([]);
  });
});

describe("the persona prompt", () => {
  it("states the hard rules and never tells the model to name a feeling", () => {
    expect(CALL_PERSONA_RULES).toMatch(/AI assistant, not a person/);
    expect(CALL_PERSONA_RULES).toMatch(/Never generate, paraphrase, or polish words and attribute them to her/);
    expect(CALL_PERSONA_RULES).toMatch(/Do you remember/);
    expect(CALL_PERSONA_RULES).toMatch(/Take your time/);
    expect(CALL_PERSONA_RULES).toMatch(/Want me to remember that/);
    expect(CALL_PERSONA_RULES).toMatch(/lead with the person/);
    expect(CALL_PERSONA_RULES).toMatch(/only if this topic is procedural/);
    expect(CALL_PERSONA_RULES).not.toMatch(/sounds as though you are feeling/);
    expect(CALL_PERSONA_RULES).not.toMatch(/name the feeling/i);
  });

  it("includes the core few-shot set, and category extras only for the live topic", () => {
    const base = callSystemPrompt(QUESTION_BANK);
    expect(base).toContain("I'd love to hear about {place}. What comes to mind?");
    expect(base).not.toContain("What smells would bring you back there?");
    const summers = callSystemPrompt(QUESTION_BANK, "family_summers");
    expect(summers).toContain("What smells would bring you back there?");
    expect(summers).toContain("More examples for this topic's category");
  });
});

describe("Muse Spark is fed the persona", () => {
  it("sends the persona and matching few-shot examples as the system prompt", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const fetchImpl: MuseFetch = async (_url, init) => {
      calls.push(JSON.parse(init.body as string) as Record<string, unknown>);
      return { ok: true, status: 200, text: async () => "", json: async () => ({ choices: [{ message: { content: JSON.stringify({ cue_id: "person:maya", citations: ["person:maya"] }) } }] }) };
    };
    await museScaffoldAdvisor(new MuseSpark("test-key", fetchImpl), QUESTION_BANK)({
      rung: 3,
      what_she_said: "I'm not sure.",
      topic_category: "family_summers",
      eligible: [
        { scaffold_id: "a", cue_id: "person:maya", citations: ["person:maya"], what_it_does: "names someone" },
        { scaffold_id: "b", cue_id: "person:priya", citations: ["person:priya"], what_it_does: "names someone" },
      ],
    });
    const system = (calls[0]!.messages as Array<{ role: string; content: string }>).find((m) => m.role === "system")!.content;
    expect(system).toContain("You are Relay, an AI assistant, not a person");
    expect(system).toContain("What smells would bring you back there?");
    expect(system).toContain("choosing which ONE cue");
    expect(system).toContain("eligible");
  });
});
