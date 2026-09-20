import { describe, expect, it, vi } from "vitest";
import { bench, call, SAID } from "./helpers";
import { conversationalRepair, type ConversationAdvisor } from "@/lib/providers/conversation";
import { museConversationAdvisor } from "@/lib/providers/muse/reasoning";
import { MuseSpark } from "@/lib/providers/muse/spark";

async function assess(reply: string, advisor?: ConversationAdvisor) {
  const transcript = call([["recall", SAID.rung1], ["her", reply]]);
  const b = await bench({ transcript });
  b.ctx.conversationalRepairs = true; b.ctx.conversationAdvisor = advisor;
  b.ctx.session.spoken.push({ prompt_id: "opening", script_id: "LADDER-1", rung: 1, text: SAID.rung1, at: b.clock.iso() });
  const turn = transcript.turns.at(-1)!;
  return b.runtime.call("assess_conversation_state", { topic_id: b.topicId, audio_window: { asset_id: transcript.asset_id, start_ms: turn.start_ms, end_ms: turn.end_ms }, turn_history: [] });
}
describe("bounded natural conversation", () => {
  it.each(["Could you repeat that?", "Please say that again.", "I didn't catch that."])("repeats the pending question for %s", async text => {
    const model = vi.fn();
    expect(await assess(text, model)).toMatchObject({ state: "asked_repeat", evidence: { matched_rule: "conversation:repeat" } });
    expect(model).not.toHaveBeenCalled();
  });
  it("keeps concrete accounts that begin with uncertainty, but not longer statements of uncertainty", async () => {
    expect(await assess("I don't remember when, but we took the train with Maya.")).toMatchObject({ state: "new_detail_offered" });
    expect(await assess("I don't remember but I really don't know.")).toMatchObject({ state: "no_answer" });
  });
  it.each(["What do you mean?", "Did you go there too?"])("does not mistake a question for a memory: %s", async text => {
    expect(await assess(text)).toMatchObject({ state: "no_answer", evidence: { matched_rule: "conversation:clarification" } });
  });
  it("lets Muse recognize a short unexpected account, and falls back when it is unavailable", async () => {
    const model = vi.fn<ConversationAdvisor>().mockResolvedValue("detail");
    expect(await assess("With Priya.", model)).toMatchObject({ state: "new_detail_offered", evidence: { transcript: "With Priya." } });
    expect(model.mock.calls[0]![0]).toMatchObject({ reply: "With Priya.", question: SAID.rung1 });
    model.mockRejectedValue(new Error("unavailable"));
    expect(await assess("We built sandcastles together every summer.", model)).toMatchObject({ state: "new_detail_offered" });
  });
  it("does not let an advisor override stop or identity handling", async () => {
    const model = vi.fn<ConversationAdvisor>().mockResolvedValue("detail");
    expect(await assess("I have to go.", model)).toMatchObject({ evidence: { conduct_signal: "stop_request" } });
    expect(await assess("Who is this?", model)).toMatchObject({ evidence: { conduct_signal: "identity_question" } });
    expect(model).not.toHaveBeenCalled();
  });
  it("keeps a bare acknowledgment out of memory capture even with an overeager advisor", async () => {
    const model = vi.fn<ConversationAdvisor>().mockResolvedValue("detail");
    expect(await assess("Oh yes.", model)).toMatchObject({ state: "recalled" });
    expect(await assess("I do not remember.", model)).toMatchObject({ state: "no_answer" });
    expect(model).not.toHaveBeenCalled();
  });
  it("treats a requested thinking pause as continuing", () => {
    expect(conversationalRepair("Let me think.")).toBe("continuing");
  });
  it("validates Muse's routing output rather than accepting generated dialogue", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"intent":"detail"}' } }] }) });
    const route = museConversationAdvisor(new MuseSpark("test", fetch));
    expect(await route({ topic: "Cape May", question: SAID.rung1, reply: "With Priya." })).toBe("detail");
    const body = JSON.parse(fetch.mock.calls[0]![1].body);
    expect(body.response_format.type).toBe("json_schema");
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"intent":"detail","reply":"Invented words"}' } }] }) });
    await expect(route({ topic: "Cape May", question: SAID.rung1, reply: "With Priya." })).rejects.toThrow();
  });
});
