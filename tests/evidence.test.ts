/** The design choices in EVIDENCE.md that live in the engine, each held in place by a test. */
import { describe, expect, it } from "vitest";
import { POLICY } from "@/fixtures";
import { runFixture, runJudgedPath } from "@/fixtures/harness";
import { policySchema } from "@/lib/tools";
import { bench, overlay, policyWith } from "./helpers";

type Ranked = Array<{ topic_id: string; rank: number; times_told: number; life_period: string | null; last_revisited_at: string | null }>;
const rankedOf = (b: Awaited<ReturnType<typeof bench>>): Ranked => (b.runtime.log[0]!.output as { ranked: Ranked }).ranked;

describe("A. which memory, and when", () => {
  it("the same memory comes round again: the topic revisited longest ago is the one that is due", async () => {
    const ranked = rankedOf(await bench());
    expect(ranked.map((r) => r.topic_id)).toEqual(["event:cape-may-summers", "place:lincoln-elementary", "place:princeton", "event:mayas-wedding"]);
    expect(ranked.map((r) => r.last_revisited_at!.slice(0, 10))).toEqual(["2026-10-27", "2026-11-01", "2026-11-02", "2026-11-03"]);
    // ...and once it has been talked about, it goes to the back of the queue rather than out of it.
    const after = await runJudgedPath();
    after.clock.advance(24 * 3_600_000);
    after.setup.pauseCalls(true); // no second call is wanted here - only the schedule's choice of what is due next
    const next = await after.service.runScheduledCall("session:next");
    expect(next!.recording.final_state).toBe("blocked");
    expect((next!.recording.tool_log[0]!.output as { ranked: Ranked }).ranked.map((r) => r.topic_id)).toEqual(["place:lincoln-elementary", "place:princeton", "event:mayas-wedding", "event:cape-may-summers"]);
  });

  it("among memories equally due, the one told most often comes first", async () => {
    // Before any call has happened, nothing has been revisited: every topic is equally due.
    const b = await bench({ now: "2026-08-03T14:30:00.000Z" });
    const ranked = rankedOf(b);
    expect(ranked.every((r) => r.last_revisited_at === null)).toBe(true);
    expect(ranked.map((r) => [r.topic_id, r.times_told])).toEqual([["event:cape-may-summers", 2], ["event:mayas-wedding", 1], ["place:lincoln-elementary", 1], ["place:princeton", 1]]);
  });

  it("then by when in her life it is from - where a person has said: ages 6-30, then recent, then the years between, unknown last", async () => {
    const dated = overlay(
      "three more places, told once each, from different times in her life",
      [
        { id: "place:a-recent", type: "Place", label: "The new flat", props: { aliases: [], topic: { spoken_as: "the new flat", category: "hometown", life_period: "recent" } }, source: "artifact:setup-record" },
        { id: "place:b-after-30", type: "Place", label: "Trenton", props: { aliases: [], topic: { spoken_as: "Trenton", category: "hometown", life_period: "after_30" } }, source: "artifact:setup-record" },
        { id: "place:c-young", type: "Place", label: "Pune", props: { aliases: [], topic: { spoken_as: "Pune", category: "hometown", life_period: "ages_6_to_30" } }, source: "artifact:setup-record" },
      ],
      [],
    );
    const allow = ["place:a-recent", "place:b-after-30", "place:c-young", "place:princeton"];
    const b = await bench({ now: "2026-08-03T14:30:00.000Z", overlays: [dated], policy: policyWith((p) => (p.topics.allow = allow)) });
    // Princeton has been told once and has no life period; the other three have been told 0 times, so it leads on telling.
    expect(rankedOf(b).map((r) => [r.topic_id, r.life_period])).toEqual([["place:princeton", null], ["place:c-young", "ages_6_to_30"], ["place:a-recent", "recent"], ["place:b-after-30", "after_30"]]);
  });
});

describe("C. how Recall talks", () => {
  it("logs the kind of prompt beside every reply of hers: open, forced choice, or yes/no", async () => {
    const r = await runJudgedPath();
    const formats = r.recording.tool_log.filter((c) => ["assess_conversation_state", "confirm_and_store", "confirm_share"].includes(c.tool)).map((c) => (c.output as { response_format?: string; evidence?: { response_format: string } }).response_format ?? (c.output as { evidence?: { response_format: string } }).evidence?.response_format);
    expect(formats).toEqual(["open", "open", "open", "open", "yes_no", "yes_no", undefined]); // the last is the commit step: it hears nothing
  });

  it("a bare yes is never the only thing standing behind a stored memory: she has just heard her own words played back", async () => {
    const r = await runJudgedPath();
    const tools = r.recording.tool_log.map((c) => c.tool);
    expect(tools.indexOf("capture_contribution")).toBeLessThan(tools.indexOf("confirm_and_store"));
    expect(r.recording.trace.map((t) => t.event).join(" ")).toMatch(/CONTRIBUTION_CAPTURED STORE_CONFIRMATION_RECORDED SHARE_CONFIRMATION_RECORDED CONTRIBUTION_STORED/);
  });
});

describe("E. when, and for how long", () => {
  it("the joint setup defaults to mornings, and a call is 8 minutes at most", () => {
    const p = policySchema.parse(POLICY);
    expect(p.call_windows).toEqual([{ days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], start: "09:00", end: "12:00" }]);
    expect(p.speech.max_call_minutes).toBe(8);
  });

  it("10 minutes is a ceiling no setup can raise", () => {
    expect(() => policySchema.parse(policyWith((p) => (p.speech.max_call_minutes = 11)))).toThrow();
    expect(policySchema.parse(policyWith((p) => (p.speech.max_call_minutes = 10))).speech.max_call_minutes).toBe(10);
  });

  it("an afternoon or evening call is not placed under the default setup", async () => {
    for (const now of ["2026-11-05T19:30:00.000Z", "2026-11-05T23:00:00.000Z"]) {
      const r = await runFixture({ now }); // 2:30 pm and 6 pm in New York
      expect(r.recording.final_state).toBe("blocked");
      expect(r.recording.call).toBeNull();
    }
  });
});
