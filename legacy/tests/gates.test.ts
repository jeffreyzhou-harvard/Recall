/**
 * AGENTS.md section 12.2: every gate fails closed. These call the tools
 * directly, the way a model that ignored the intended order would, and check
 * that the service - not the prompt - is what refuses.
 */
import { describe, expect, it } from "vitest";
import { GateError } from "@/lib/tools";
import { CALL, THREAD, diwaliForward, goldenTurn } from "./fixtures";
import { assentWindow, bench, throughCapture, throughVerify } from "./helpers";

const gate = (name: string) => expect.objectContaining({ name: "GateError", gate: name });

describe("retrieval gate", () => {
  it("refuses a graph query with no policy token", async () => {
    const b = await bench();
    const ask = await b.runtime.call("inspect_request", { thread_id: THREAD });
    await expect(
      b.runtime.call("query_context_graph", { ask_id: ask.ask_id, question: ask.text, allowed_sources: ["ask_artifact"], max_hops: 2, policy_token_id: "token:made-up" }),
    ).rejects.toEqual(gate("policy"));
    expect(b.runtime.log.at(-1)!.policy_decision).toBe("gate_failed:policy");
  });

  it("refuses to issue a policy before identities are verified", async () => {
    const b = await bench();
    const ask = await b.runtime.call("inspect_request", { thread_id: THREAD });
    await expect(
      b.runtime.call("get_access_policy", { ask_id: ask.ask_id, person: ask.addressee_id, purpose: "answer_current_ask", audience: THREAD }),
    ).rejects.toEqual(gate("identity"));
  });

  it("refuses source classes the policy did not allow", async () => {
    const p = await throughVerify();
    await expect(
      p.runtime.call("query_context_graph", { ask_id: p.ask.ask_id, question: p.ask.text, allowed_sources: ["joint_setup"], max_hops: 2, policy_token_id: p.tokenId }),
    ).rejects.toEqual(gate("policy"));
  });

  it("refuses an expired token", async () => {
    const p = await throughVerify();
    p.clock.advance(31 * 60_000);
    await expect(
      p.runtime.call("query_context_graph", { ask_id: p.ask.ask_id, question: p.ask.text, allowed_sources: ["ask_artifact"], max_hops: 2, policy_token_id: p.tokenId }),
    ).rejects.toEqual(gate("policy"));
  });

  it("does nothing at all when no ask was forwarded: Relay never initiates", async () => {
    const b = await bench();
    await expect(b.runtime.call("inspect_request", { thread_id: "artifact:some-other-thread" })).rejects.toEqual(gate("permission"));
  });

  it("permits the forwarded photo only once the policy has granted the ask", async () => {
    const b = await bench();
    const ask = await b.runtime.call("inspect_request", { thread_id: THREAD });
    const photo = ask.artifacts[0]!.artifact_id;
    const permitted = async (): Promise<boolean> => (await b.graph.edgesOf(photo)).some((e) => e.type === "PERMITTED_IN");
    expect(await permitted()).toBe(false);
    await b.runtime.call("resolve_identity_and_relationships", { ask_id: ask.ask_id, participants: ask.participants });
    await b.runtime.call("get_access_policy", { ask_id: ask.ask_id, person: ask.addressee_id, purpose: "answer_current_ask", audience: THREAD });
    expect(await permitted()).toBe(true);
  });
});

describe("identity and audience gate", () => {
  it("verifies the people, their relationship, and that the answer goes back to the thread it came from", async () => {
    const b = await bench();
    const ask = await b.runtime.call("inspect_request", { thread_id: THREAD });
    const out = await b.runtime.call("resolve_identity_and_relationships", { ask_id: ask.ask_id, participants: ask.participants });
    expect(out).toMatchObject({ verified: true, mismatches: [] });
    expect(out.relationships[0]).toMatchObject({ kind: "mother_daughter", verified_by: "artifact:setup-record" });
  });

  it("stops when the requested audience is anything other than the originating thread", async () => {
    const b = await bench({ forward: diwaliForward({ requested_audience: "person:anika" }) });
    const ask = await b.runtime.call("inspect_request", { thread_id: THREAD });
    const out = await b.runtime.call("resolve_identity_and_relationships", { ask_id: ask.ask_id, participants: ask.participants });
    expect(out.verified).toBe(false);
    expect(out.mismatches).toEqual([{ participant: "person:anika", reason: "requested audience is not the thread the ask came from" }]);
    await expect(
      b.runtime.call("get_access_policy", { ask_id: ask.ask_id, person: ask.addressee_id, purpose: "answer_current_ask", audience: "person:anika" }),
    ).rejects.toEqual(gate("identity"));
  });
});

describe("evidence gate", () => {
  it("refuses to render a prompt from uncited content", async () => {
    const p = await throughVerify();
    await expect(
      p.runtime.call("render_prompt", { ask_id: p.ask.ask_id, scaffold_id: "brief", citations: ["pref:mom-festival-desserts"] }),
    ).rejects.toEqual(gate("evidence"));
  });

  it("refuses a prompt whose slots have no citation to fill them", async () => {
    const p = await throughVerify();
    await expect(p.runtime.call("render_prompt", { ask_id: p.ask.ask_id, scaffold_id: "brief", citations: [] })).rejects.toEqual(gate("evidence"));
  });

  it("will not verify a node the policy-bounded retrieval never returned", async () => {
    const p = await throughVerify();
    const out = await p.runtime.call("verify_claim_support", { ask_id: p.ask.ask_id, claim_ids: ["pref:mom-festival-desserts"], policy_token_id: p.tokenId });
    expect(out.verified).toEqual([]);
    expect(out.rejected).toEqual([{ claim_id: "pref:mom-festival-desserts", reason: "not_retrieved_for_this_ask" }]);
    expect(p.ctx.gate.isVerified("pref:mom-festival-desserts")).toBe(false);
  });
});

describe("authorship gate", () => {
  it("rejects any interval that contains Relay's own speech", async () => {
    const p = await throughCapture();
    await expect(
      p.runtime.call("capture_exact_contribution", { ask_id: p.ask.ask_id, audio_intervals: [{ asset_id: CALL, start_ms: goldenTurn("r2").start_ms, end_ms: goldenTurn("p2").end_ms }] }),
    ).rejects.toEqual(gate("authorship"));
  });

  it("rejects an interval that clips one of her words", async () => {
    const p = await throughCapture();
    const answer = goldenTurn("p2");
    await expect(
      p.runtime.call("capture_exact_contribution", { ask_id: p.ask.ask_id, audio_intervals: [{ asset_id: CALL, start_ms: answer.start_ms + 100, end_ms: answer.end_ms }] }),
    ).rejects.toEqual(gate("authorship"));
  });

  it("will not capture before an answer has been heard", async () => {
    const p = await throughVerify();
    const answer = goldenTurn("p2");
    await expect(
      p.runtime.call("capture_exact_contribution", { ask_id: p.ask.ask_id, audio_intervals: [{ asset_id: CALL, start_ms: answer.start_ms, end_ms: answer.end_ms }] }),
    ).rejects.toEqual(gate("authorship"));
  });
});

describe("publish gate", () => {
  type Captured = Awaited<ReturnType<typeof throughCapture>>;
  const publish = (p: Captured, over: Partial<{ hash: string; destination: string }> = {}) =>
    p.runtime.call("publish_contribution", { ask_id: p.ask.ask_id, hash: over.hash ?? p.captured.content_hash, destination: over.destination ?? THREAD, policy_token_id: p.tokenId });
  const sayYes = (p: Captured) =>
    p.runtime.call("request_assent", { ask_id: p.ask.ask_id, contribution_hash: p.captured.content_hash, audience: THREAD, audio_window: assentWindow() });

  it("fails without assent", async () => {
    const p = await throughCapture();
    await expect(publish(p)).rejects.toEqual(gate("assent"));
    expect(p.bridge.posted()).toEqual([]);
  });

  it("fails with a mismatched hash", async () => {
    const p = await throughCapture();
    expect((await sayYes(p)).decision).toBe("yes");
    await expect(publish(p, { hash: "0".repeat(64) })).rejects.toEqual(gate("assent"));
    expect(p.bridge.posted()).toEqual([]);
  });

  it("fails with a mismatched audience", async () => {
    const p = await throughCapture();
    await sayYes(p);
    await expect(publish(p, { destination: "person:anika" })).rejects.toEqual(gate("permission"));
    expect(p.bridge.posted()).toEqual([]);
  });

  it("fails if the content changed after she approved it, even by one character", async () => {
    const p = await throughCapture();
    await sayYes(p);
    p.ctx.session.contribution!.literal_transcript += "!";
    await expect(publish(p)).rejects.toEqual(gate("assent"));
    expect(p.bridge.posted()).toEqual([]);
  });

  it("voids an earlier yes when the contribution is re-captured", async () => {
    const p = await throughCapture();
    await sayYes(p);
    p.ctx.gate.setPendingContribution("f".repeat(64));
    await expect(publish(p)).rejects.toEqual(gate("assent"));
  });

  it("will not ask for assent to an audience the policy did not approve", async () => {
    const p = await throughCapture();
    await expect(
      p.runtime.call("request_assent", { ask_id: p.ask.ask_id, contribution_hash: p.captured.content_hash, audience: "person:anika", audio_window: assentWindow() }),
    ).rejects.toEqual(gate("permission"));
  });

  it("succeeds only when hash, audience, assent, and token all line up", async () => {
    const p = await throughCapture();
    await sayYes(p);
    expect((await publish(p)).delivered_to).toBe(THREAD);
    expect(p.bridge.voiceCards()).toHaveLength(1);
  });
});

describe("GateError", () => {
  it("names the gate that failed, so the reducer can take the matching deterministic transition", () => {
    const e = new GateError("assent", "nope");
    expect(e.gate).toBe("assent");
    expect(e.message).toBe("assent gate: nope");
  });
});
