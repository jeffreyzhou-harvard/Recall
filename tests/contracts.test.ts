/** AGENTS.md section 6: nineteen tools, strict contracts, and a family side that cannot express a leak. */
import { describe, expect, it } from "vitest";
import { runJudgedPath } from "@/fixtures/harness";
import { ENFORCED_SEQUENCE, FAMILY_TOOLS, TOOL_IMPLS, TOOL_NAMES, ToolContractError, ToolRuntime, contracts, toolDefinitions } from "@/lib/tools";
import { bench } from "./helpers";

const BRIEF_ORDER = ["get_next_recall_topic", "place_recall_call", "query_context_graph", "verify_claim_support", "assess_conversation_state", "select_scaffold", "render_prompt", "capture_contribution", "confirm_and_store", "record_retrieval_outcome", "receive_family_contribution", "handle_family_query", "build_caregiver_receipt", "build_weekly_note", "get_topic_record", "export_record_for_clinician", "confirm_share", "check_safety_phrases", "send_safety_alert"];

describe("the nineteen tools", () => {
  it("are exactly the brief's, in the brief's numbering, each with an implementation and a JSON schema", () => {
    expect(TOOL_NAMES).toEqual(BRIEF_ORDER);
    expect(Object.keys(TOOL_IMPLS)).toEqual(BRIEF_ORDER);
    const defs = toolDefinitions();
    expect(defs).toHaveLength(19);
    for (const d of defs) {
      expect(d.description.length, d.name).toBeGreaterThan(40);
      // An object, or - for confirm_and_store, whose two steps take different inputs - a choice between objects.
      expect("type" in (d.input_schema as object) || "oneOf" in (d.input_schema as object), d.name).toBe(true);
      expect(JSON.stringify(d.output_schema).length, d.name).toBeGreaterThan(20);
    }
  });

  it("the family flows never enter the call sequence, and every other tool is in it", () => {
    expect([...FAMILY_TOOLS].sort()).toEqual(["build_weekly_note", "export_record_for_clinician", "get_topic_record", "handle_family_query", "receive_family_contribution"]);
    for (const t of FAMILY_TOOLS) expect(ENFORCED_SEQUENCE as readonly string[]).not.toContain(t);
    expect([...ENFORCED_SEQUENCE, ...FAMILY_TOOLS].sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("are strict: an unknown field is an error on the way in, and nothing unvalidated comes out", async () => {
    const b = await bench();
    await expect(b.runtime.call("check_safety_phrases", { audio_window: { asset_id: "call-golden", start_ms: 0, end_ms: 1000 }, her_words: "anything" } as never)).rejects.toBeInstanceOf(ToolContractError);
    await expect(b.runtime.call("send_safety_alert", { category: "fall", caregiver_ids: [] })).rejects.toBeInstanceOf(ToolContractError);
    expect(b.runtime.log.at(-1)).toMatchObject({ tool: "send_safety_alert", error: { name: "ToolContractError" } }); // refused calls are logged too
  });

  it("no family-side output, and no confirm_share output, has a field that could hold a claim id, a citation, or a transcript", () => {
    const fieldsOf = (schema: unknown, out = new Set<string>()): Set<string> => {
      if (Array.isArray(schema)) schema.forEach((s) => fieldsOf(s, out));
      else if (schema && typeof schema === "object") for (const [k, v] of Object.entries(schema)) (k === "properties" ? Object.keys(v as object).forEach((f) => out.add(f)) : undefined, fieldsOf(v, out));
      return out;
    };
    const defs = new Map(toolDefinitions().map((d) => [d.name, d.output_schema]));
    for (const tool of [...FAMILY_TOOLS, "confirm_share"] as const) {
      const fields = [...fieldsOf(defs.get(tool))];
      expect(fields.filter((f) => /claim|citation|transcript|node_id|source_id|words|evidence|cue/.test(f)), tool).toEqual([]);
    }
    expect([...fieldsOf(defs.get("send_safety_alert"))].filter((f) => /text|words|transcript|audio/.test(f))).toEqual([]);
    expect([...fieldsOf(defs.get("check_safety_phrases"))].sort()).toEqual(["category", "turn_id"]); // a category or none - not her words
    expect(contracts.assess_conversation_state.output.shape.state.options).toEqual(["recalled", "asked_repeat", "no_answer", "new_detail_offered"]); // observable turn states only
  });

  it("a family tool cannot run without a family context, and a call tool cannot run in one", async () => {
    const b = await bench();
    await expect(b.runtime.call("handle_family_query", { question: "?", requester_id: "person:maya" })).rejects.toThrow(/no family context/);
    await expect(b.service.familyRuntime.call("render_prompt", { topic_id: b.topicId, scaffold_id: "GREETING", slot_ids: {}, citations: [] })).rejects.toThrow(/no call context/);
    expect(new ToolRuntime({ clock: b.clock }, TOOL_IMPLS)).toBeDefined();
  });

  it("every call is logged: input, output, latency, source ids, policy decision, and the transition it caused", async () => {
    const { recording } = await runJudgedPath();
    for (const c of recording.tool_log) expect(c).toMatchObject({ seq: expect.any(Number), started_at: expect.any(String), latency_ms: expect.any(Number), error: null });
    expect(recording.tool_log.find((c) => c.tool === "place_recall_call")).toMatchObject({ policy_decision: "granted", state_transition: { from: "scheduled", to: "policy_passed" } });
    expect(recording.tool_log.find((c) => c.tool === "verify_claim_support")!.source_ids).toContain("artifact:onboarding-voice");
    expect(recording.tool_log.find((c) => c.tool === "get_next_recall_topic")!.output).toMatchObject({ decided_by: "deterministic_ranking", topic: { topic_id: "event:cape-may-summers", family_sourced: false } });
  });
});
