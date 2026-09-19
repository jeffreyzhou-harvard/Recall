/**
 * The bridge to the family's existing thread (product flow spec: B, C, X, Z).
 * Rule 5 - no autonomous outreach - is a property of the bridge itself.
 */
import { describe, expect, it } from "vitest";
import { runJudgedPath } from "@/fixtures/harness";
import { BridgeError, MemoryThreadBridge, NOTICE_TEXT, type ThreadMessage } from "@/lib/bridge/thread-bridge";
import { policySchema } from "@/lib/tools";
import { POLICY } from "@/fixtures";
import { THREAD } from "./fixtures";

const AT = "2026-11-05T17:31:00.000Z";
const notice = (over: Partial<Extract<ThreadMessage, { kind: "family_notice" }>> = {}): ThreadMessage => ({
  kind: "family_notice",
  in_reply_to: "fwd-1",
  to: { thread_id: THREAD },
  notice: "not_this_time",
  text: NOTICE_TEXT.not_this_time,
  authored_by: "relay",
  ...over,
});

describe("no autonomous outreach", () => {
  it("cannot send anything that is not a reply to a forward it received", async () => {
    const bridge = new MemoryThreadBridge();
    await expect(bridge.post(notice(), AT)).rejects.toBeInstanceOf(BridgeError);
    bridge.registerForward("fwd-1", THREAD);
    await bridge.post(notice(), AT);
    expect(bridge.posted()).toHaveLength(1);
  });

  it("replies only into the thread the ask came from", async () => {
    const bridge = new MemoryThreadBridge();
    bridge.registerForward("fwd-1", THREAD);
    await expect(bridge.post(notice({ to: { thread_id: "artifact:another-thread" } }), AT)).rejects.toThrow(/only to the thread the ask came from/);
    expect(bridge.posted()).toEqual([]);
  });

  it("will not carry free text as a notice: Relay's words to the family are the two fixed sentences", async () => {
    const bridge = new MemoryThreadBridge();
    bridge.registerForward("fwd-1", THREAD);
    await expect(bridge.post(notice({ text: "She seemed confused today." }), AT)).rejects.toThrow(/fixed wording/);
  });
});

describe("after a delivery", () => {
  it("the family gets her voice card in the original thread; the support receipt goes only to the named relative", async () => {
    const run = await runJudgedPath();
    const [card, receipt] = run.recording.messages;
    expect(card).toMatchObject({ kind: "voice_contribution", in_reply_to: "fwd-diwali-dessert", to: { thread_id: THREAD } });
    expect(receipt).toMatchObject({ kind: "support_receipt", in_reply_to: "fwd-diwali-dessert", to: { person_id: "person:anika" } });
    expect(run.recording.messages).toHaveLength(2);
  });

  it("the support receipt is non-clinical: three observable lines and a count of scaffolds, nothing else", async () => {
    const run = await runJudgedPath();
    const sent = run.recording.messages.find((m) => m.kind === "support_receipt")!;
    if (sent.kind !== "support_receipt") throw new Error("unreachable");
    expect(Object.keys(sent.receipt).sort()).toEqual(["lines", "scaffolds_logged", "session_id"]);
    expect(sent.receipt.lines.map((l) => l.dimension)).toEqual(["social", "emotional", "intellectual"]);
    expect(JSON.stringify(sent.receipt)).not.toMatch(/score|rating|diagnos|cognit|decline|memory|confus/i);
  });

  it("only approved people can be named as receipt recipients", () => {
    const tampered = { ...(POLICY as object), support_receipt: { recipients: ["person:stranger"] } };
    expect(policySchema.safeParse(tampered).success).toBe(false);
  });
});
