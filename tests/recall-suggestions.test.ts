import { describe, expect, it } from "vitest";
import { suggestionError, type SuggestionDraft } from "@/lib/recall-preview/contributions";
import copy from "@/fixtures/family-copy.json";

const draft: SuggestionDraft = { kind: "memory", topicId: "cape-may", who: "Maya and Susan", text: "We spent a summer at Cape May together.", whenWhere: "", photo: null };
const check = (patch: Partial<SuggestionDraft>) => suggestionError({ ...draft, ...patch }, copy.question_openers);

describe("caregiver suggestion boundary", () => {
  it("accepts a family memory contribution", () => {
    expect(check({})).toBeNull();
  });
  it("keeps questions out of family-authored memory claims", () => {
    expect(check({ text: "What do you remember about Cape May?" })).toContain("Choose ‘Suggest a question’");
  });
  it("permits a separately labeled question under the user's revised brief", () => {
    expect(check({ kind: "question", who: "", text: "What comes to mind about summers at Cape May?" })).toBeNull();
  });
  it("limits a question to one short prompt and requires content", () => {
    expect(check({ kind: "question", text: "Where was it? Who was there?" })).not.toBeNull();
    expect(check({ kind: "question", text: "x".repeat(281) })).not.toBeNull();
    expect(check({ kind: "question", text: "  " })).not.toBeNull();
    expect(check({ who: "" })).not.toBeNull();
  });
  it("rejects non-photo and oversized attachments", () => {
    expect(check({ photo: { type: "text/html", size: 100 } as File })).not.toBeNull();
    expect(check({ photo: { type: "image/jpeg", size: 11 * 1024 * 1024 } as File })).not.toBeNull();
  });
});
