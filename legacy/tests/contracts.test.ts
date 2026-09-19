/** The twelve tool contracts, and the rule-4 guarantee that no contract can carry a judgment of the person. */
import { describe, expect, it } from "vitest";
import { MANIFEST, POLICY } from "@/fixtures";
import { ENFORCED_SEQUENCE, TOOL_IMPLS, TOOL_NAMES, ToolContractError, contracts, evaluatePolicy, policySchema, toolDefinitions } from "@/lib/tools";
import { THREAD } from "./fixtures";
import { bench } from "./helpers";

const policy = policySchema.parse(POLICY);
const request = {
  person_id: "person:mom",
  asker_id: "person:anika",
  purpose: "answer_current_ask",
  audience: THREAD,
  topic_ids: ["topic:kheer", "topic:halwa"],
  ask_expires_at: "2026-11-07T17:25:00.000Z",
  now_iso: "2026-11-05T17:30:00.000Z", // Thursday 12:30 in New York
};

describe("tool contracts", () => {
  it("are exactly the twelve tools, implemented, in the enforced order", () => {
    expect(TOOL_NAMES).toHaveLength(12);
    expect([...ENFORCED_SEQUENCE]).toEqual(TOOL_NAMES);
    expect(Object.keys(TOOL_IMPLS)).toEqual(TOOL_NAMES);
  });

  it("export JSON Schema for a model's tool interface", () => {
    const defs = toolDefinitions();
    expect(defs.map((d) => d.name)).toEqual(TOOL_NAMES);
    for (const def of defs) {
      expect(def.description.length).toBeGreaterThan(40);
      expect(def.input_schema).toMatchObject({ type: "object", additionalProperties: false });
      expect(JSON.stringify(def.output_schema).length).toBeGreaterThan(20);
    }
    expect((defs[0]!.input_schema as { required: string[] }).required).toEqual(["thread_id"]);
  });

  it("have no field anywhere that could hold a clinical or emotional judgment", () => {
    const banned = /diagnos|dementia|cognit|competen|mood|emotion_|sentiment|severity|stage|decline|risk|score|rating|grade/i;
    const names = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          if (k === "properties" && v && typeof v === "object") Object.keys(v).forEach((n) => names.add(n));
          walk(v);
        }
      }
    };
    for (const def of toolDefinitions()) walk([def.input_schema, def.output_schema]);
    expect(names.size).toBeGreaterThan(60);
    expect([...names].filter((n) => banned.test(n))).toEqual([]);
  });

  it("limit assess_conversation_state to the four observable turn states", () => {
    const schema = JSON.stringify(toolDefinitions().find((d) => d.name === "assess_conversation_state")!.output_schema);
    expect(schema).toContain('"followed","asked_repeat","no_answer","answer_present"');
    expect(contracts.assess_conversation_state.output.shape.state.options).toEqual(["followed", "asked_repeat", "no_answer", "answer_present"]);
  });

  it("reject unknown input fields rather than ignoring them", async () => {
    const b = await bench();
    await expect(b.runtime.call("inspect_request", { thread_id: THREAD, also: "this" } as never)).rejects.toBeInstanceOf(ToolContractError);
    expect(b.runtime.log.at(-1)!.error!.name).toBe("ToolContractError");
  });

  it("cap graph traversal at two hops", () => {
    const parse = (max_hops: number) =>
      contracts.query_context_graph.input.safeParse({ ask_id: "a", question: "q", allowed_sources: ["ask_artifact"], max_hops, policy_token_id: "t" });
    expect(parse(2).success).toBe(true);
    expect(parse(3).success).toBe(false);
  });
});

describe("access policy", () => {
  it("grants the judged ask", () => {
    expect(evaluatePolicy(policy, request)).toEqual({ decision: "granted" });
  });

  it.each([
    ["an unapproved asker", { asker_id: "person:stranger" }, "asker_not_approved"],
    ["an unapproved audience", { audience: "person:anika" }, "audience_not_approved"],
    ["a purpose nobody agreed to", { purpose: "daily_check_in" }, "purpose_not_permitted"],
    ["a blocked topic", { topic_ids: ["topic:kheer", "topic:finances"] }, "topic_blocked"],
    ["a topic not on the allow list", { topic_ids: ["topic:travel"] }, "topic_not_allowed"],
    ["an expired ask", { now_iso: "2026-11-07T18:00:00.000Z" }, "ask_expired"],
    ["a time outside the call window", { now_iso: "2026-11-06T03:30:00.000Z" }, "outside_call_window"],
    ["someone the policy does not cover", { person_id: "person:anika" }, "person_not_covered"],
  ])("denies %s", (_label, change, reason) => {
    expect(evaluatePolicy(policy, { ...request, ...change })).toMatchObject({ decision: "denied", reason });
  });

  it("always requires voice assent: a policy that waives it does not parse", () => {
    const waived = { ...(POLICY as object), review: { voice_assent_required: false, caregiver_review_before_send: false } };
    expect(policySchema.safeParse(waived).success).toBe(false);
  });
});

describe("fixtures", () => {
  it("label every stand-in asset, so a placeholder can never pass for real media", () => {
    for (const asset of MANIFEST.assets) expect(["placeholder", "final"]).toContain(asset.status);
  });
});
