import { describe, expect, it } from "vitest";
import { shouldFinishTurn } from "@/client/turn-end";

const preview = (text = "We went to the beach.", endpointMs: number | null = 2000) => ({ text, endpointMs, unavailable: false });
describe("patient speech endpoint timing", () => {
  it("ends a completed phrase after a corroborated 1.4 second pause", () => {
    expect(shouldFinishTurn(3200, 2000, preview())).toBe(false);
    expect(shouldFinishTurn(3400, 2000, preview())).toBe(true);
  });
  it("allows the initial thinking pause and has a bounded recording length", () => {
    expect(shouldFinishTurn(20000, null, null)).toBe(false);
    expect(shouldFinishTurn(25000, null, null)).toBe(true);
    expect(shouldFinishTurn(75000, 74999, null)).toBe(true);
  });
  it.each(["We went to the beach and…", "I remember because", "Let me think.", "Um."])("leaves time to continue %s", text => {
    expect(shouldFinishTurn(5500, 2000, preview(text))).toBe(false);
    expect(shouldFinishTurn(8500, 2000, preview(text))).toBe(true);
  });
  it("ignores an endpoint overtaken by fresh local speech or an interim continuation", () => {
    expect(shouldFinishTurn(4500, 3000, preview())).toBe(false);
    expect(shouldFinishTurn(3500, 2000, preview("We went to the beach.", null))).toBe(false);
    expect(shouldFinishTurn(4500, 3000, preview("With my daughter.", 3000))).toBe(true);
  });
  it("handles quiet speech and provider failure without waiting indefinitely", () => {
    expect(shouldFinishTurn(3400, null, preview())).toBe(true);
    expect(shouldFinishTurn(4000, 2000, { ...preview(), unavailable: true })).toBe(false);
    expect(shouldFinishTurn(5500, 2000, null)).toBe(true);
  });
});
