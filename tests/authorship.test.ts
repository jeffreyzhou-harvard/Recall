/** AGENTS.md section 12.4: authorship invariants. */
import { beforeAll, describe, expect, it } from "vitest";
import { GOLDEN_TRANSCRIPT } from "@/fixtures";
import { runJudgedPath, type FixtureRun } from "@/fixtures/harness";
import { AuthorshipError, generatedFirstPersonWords, participantWordsIn } from "@/lib/provenance/authorship";
import { EdlError, buildEdl, validateEdl, type EditDecisionList } from "@/lib/provenance/edl";
import type { ToolOutput } from "@/lib/tools";
import { goldenTurn } from "./fixtures";

let run: FixtureRun;
let contribution: ToolOutput<"capture_exact_contribution">;
const turns = GOLDEN_TRANSCRIPT.turns;

beforeAll(async () => {
  run = await runJudgedPath();
  contribution = run.ctx.session.contribution!;
});

describe("the outbound artifact", () => {
  it("contains only her audio spans", () => {
    const hers = turns.filter((t) => t.speaker === "participant");
    for (const span of contribution.kept) {
      expect(hers.some((t) => span.start_ms >= t.start_ms && span.end_ms <= t.end_ms)).toBe(true);
    }
    const others = turns.filter((t) => t.speaker !== "participant");
    for (const span of contribution.kept) {
      expect(others.some((t) => span.start_ms < t.end_ms && t.start_ms < span.end_ms)).toBe(false);
    }
  });

  it("has exactly 0 generated first-person words, and is 100% her words", () => {
    expect(generatedFirstPersonWords(contribution.words, turns)).toBe(0);
    expect(contribution.generated_first_person_words).toBe(0);
    expect(contribution.her_words_pct).toBe(100);
    expect(contribution.literal_transcript).toBe(contribution.words.map((w) => w.w).join(" "));
  });

  it("counts any word that is not hers", () => {
    const forged = [...contribution.words, { w: "definitely", start_ms: 23950, end_ms: 24400 }];
    expect(generatedFirstPersonWords(forged, turns)).toBe(1);
    const reworded = contribution.words.map((w, i) => (i === 2 ? { ...w, w: "halwa." } : w));
    expect(generatedFirstPersonWords(reworded, turns)).toBe(1);
  });
});

describe("the edit-decision list", () => {
  it("lists every edit: three silence trims, nothing else", () => {
    expect(contribution.trims).toHaveLength(3);
    expect(contribution.trims.every((t) => t.kind === "silence")).toBe(true);
    expect(contribution.silence_trims).toBe(3);
    expect(contribution.disfluency_trims).toBe(0);
  });

  it("accounts for every millisecond: kept plus trimmed equals the interval", () => {
    const len = (s: { start_ms: number; end_ms: number }): number => s.end_ms - s.start_ms;
    const total = contribution.intervals.reduce((n, s) => n + len(s), 0);
    const kept = contribution.kept.reduce((n, s) => n + len(s), 0);
    const trimmed = contribution.trims.reduce((n, s) => n + len(s), 0);
    expect(kept + trimmed).toBe(total);
  });

  it("never cuts into a word", () => {
    for (const trim of contribution.trims) {
      for (const w of contribution.words) expect(trim.start_ms < w.end_ms && w.start_ms < trim.end_ms).toBe(false);
    }
  });

  const answer = goldenTurn("p2");
  const base = (): EditDecisionList =>
    buildEdl({ asset_id: "call-golden", sha256: "a".repeat(64) }, [{ start_ms: answer.start_ms, end_ms: answer.end_ms }], answer.words);

  it("rejects a trim that would remove a word", () => {
    const edl = base();
    const word = answer.words[4]!; // "grandfather"
    edl.trims = [{ kind: "silence", start_ms: word.start_ms, end_ms: word.end_ms }];
    expect(() => validateEdl(edl, answer.words)).toThrow(EdlError);
  });

  it("rejects any kind of edit other than a silence or disfluency trim", () => {
    const edl = base();
    (edl.trims[0] as { kind: string }).kind = "rephrase";
    expect(() => validateEdl(edl, answer.words)).toThrow(/not a permitted edit/);
  });

  it("rejects an EDL whose kept spans were tampered with", () => {
    const edl = base();
    edl.kept = [{ start_ms: answer.start_ms, end_ms: answer.end_ms }];
    expect(() => validateEdl(edl, answer.words)).toThrow(EdlError);
  });

  it("trims a standalone filler as a listed disfluency, and only a filler", () => {
    const words = [
      { w: "Um", start_ms: 0, end_ms: 300 },
      { w: "kheer.", start_ms: 350, end_ms: 900 },
    ];
    const edl = buildEdl({ asset_id: "x", sha256: "a".repeat(64) }, [{ start_ms: 0, end_ms: 900 }], words);
    expect(edl.trims).toEqual([{ kind: "disfluency", start_ms: 0, end_ms: 300 }]);
    edl.trims = [{ kind: "disfluency", start_ms: 350, end_ms: 900 }];
    expect(() => validateEdl(edl, words)).toThrow(/cut into the word/);
  });
});

describe("capturing words", () => {
  it("refuses Relay's speech and played-back audio", () => {
    const relay = goldenTurn("r1");
    expect(() => participantWordsIn(turns, [{ start_ms: relay.start_ms, end_ms: relay.end_ms }])).toThrow(AuthorshipError);
    expect(() => participantWordsIn(turns, [{ start_ms: 0, end_ms: 40_000 }])).toThrow(/only her own words/);
  });
});

describe("everything Relay says", () => {
  it("maps every fact to a verified citation, and has no fact-free free text", () => {
    const prompts = run.ctx.session.prompts;
    expect(prompts.length).toBeGreaterThan(0);
    for (const p of prompts) {
      expect(p.voice).toBe("relay");
      expect(p.segments.map((s) => s.text).join("")).toBe(p.text);
      for (const s of p.segments.filter((s) => s.kind === "fact")) {
        expect(s.citation_ids.length, `"${s.text}" has no citation`).toBeGreaterThan(0);
        for (const id of s.citation_ids) expect(run.ctx.gate.isVerified(id), `${id} was never verified`).toBe(true);
      }
    }
  });

  it("only ever says a line that was rendered through render_prompt, word for word", () => {
    const rendered = new Map(run.ctx.session.prompts.map((p) => [p.prompt_id, p.text]));
    expect(run.ctx.session.spoken.length).toBeGreaterThan(0);
    for (const line of run.ctx.session.spoken) expect(rendered.get(line.prompt_id)).toBe(line.text);
  });

  it("never speaks as her: no prompt is attributed to the participant", () => {
    for (const p of run.ctx.session.prompts) expect(p.voice).not.toBe("participant");
  });
});

describe("end-card metrics", () => {
  it("can show: 100% her words, scaffolds logged, 0 generated first-person words", () => {
    expect(run.recording.caregiver_receipt!.artifact_metrics!.her_words_pct).toBe(100);
    expect(run.recording.caregiver_receipt!.scaffolds_logged).toBe(1);
    expect(run.recording.caregiver_receipt!.artifact_metrics!.generated_first_person_words).toBe(0);
  });
});
