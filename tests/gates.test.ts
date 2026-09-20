/** AGENTS.md section 12, test 2: every gate fails closed. */
import { describe, expect, it } from "vitest";
import { runJudgedPath } from "@/fixtures/harness";
import { GateError, GateKeeper } from "@/lib/tools";
import { bench, overlay, policyWith, HER_LINE, SCRIPT_WITH_REORIENTATION } from "./helpers";

const H = "a".repeat(64);
const gateOf = async (p: Promise<unknown>): Promise<string> => p.then(() => "no gate fired", (e) => (e instanceof GateError ? e.gate : `threw ${String(e)}`));

describe("confirmation gates the graph (rule 3)", () => {
  it("storing without a confirmation fails; so does a no, an unclear, a different hash, and a commit before the share question", () => {
    const gate = new GateKeeper();
    expect(() => gate.requireCommittable(H)).toThrow(/no captured contribution/);
    gate.setPendingContribution(H);
    expect(() => gate.requireCommittable(H)).toThrow(/no confirmation has been recorded/);
    expect(() => gate.requireCommittable("b".repeat(64))).toThrow(/does not match the captured/);
    for (const decision of ["no", "unclear"] as const) {
      gate.recordStoreConfirmation(H, decision);
      expect(() => gate.requireCommittable(H)).toThrow(/not yes/);
      expect(() => gate.recordShareConfirmation(H, "yes")).toThrow(/only after she has said yes/);
    }
    gate.recordStoreConfirmation(H, "yes");
    expect(() => gate.requireCommittable(H)).toThrow(/commit comes last/);
    gate.recordShareConfirmation(H, "no");
    expect(gate.requireCommittable(H)).toEqual({ shared: false });
    expect(() => gate.recordShareConfirmation(H, "yes")).toThrow(/already been answered/); // she is asked once
  });

  it("a new capture voids every earlier confirmation", () => {
    const gate = new GateKeeper();
    gate.setPendingContribution(H);
    gate.recordStoreConfirmation(H, "yes");
    gate.recordShareConfirmation(H, "yes");
    gate.setPendingContribution("c".repeat(64));
    expect(() => gate.requireCommittable("c".repeat(64))).toThrow(/no confirmation/);
    expect(() => gate.requireCommittable(H)).toThrow(/does not match/);
  });

  it("the commit tool refuses a hash she never heard, and nothing reaches the graph", async () => {
    const b = await bench();
    expect(await gateOf(b.runtime.call("confirm_and_store", { step: "commit", contribution_hash: H, policy_token_id: b.tokenId }))).toBe("confirmation");
    expect((await b.graph.nodesOfType("Contribution")).length).toBe(0);
  });

  it("a contribution changed after she confirmed it is not stored", async () => {
    const run = await runJudgedPath();
    // Re-open the same session state and tamper with the words after both yeses.
    const b = await bench();
    Object.assign(b.ctx.session, { contribution: { ...run.ctx.session.contribution!, literal_transcript: "We went to Cape May every winter." } });
    const hash = run.ctx.session.contribution!.content_hash;
    b.ctx.gate.setPendingContribution(hash);
    b.ctx.gate.recordStoreConfirmation(hash, "yes");
    b.ctx.gate.recordShareConfirmation(hash, "yes");
    Object.assign(b.ctx.session, { share_confirmation: run.ctx.session.share_confirmation });
    await expect(b.runtime.call("confirm_and_store", { step: "commit", contribution_hash: hash, policy_token_id: b.tokenId })).rejects.toThrow(/changed after she confirmed it/);
  });
});

describe("evidence-bounded speech (rule 6)", () => {
  it("a line that is not in the reviewed script is not said", async () => {
    const b = await bench();
    expect(await gateOf(b.runtime.call("render_prompt", { topic_id: b.topicId, scaffold_id: "LADDER-9-IMPROVISED", slot_ids: {}, citations: [] }))).toBe("evidence");
  });

  it("uncited content fails: a slot with no citation, an unverified citation, a slot the line does not have", async () => {
    const b = await bench();
    const person = "LADDER-3-PERSON-FAMILY-SUMMERS";
    expect(await gateOf(b.runtime.call("render_prompt", { topic_id: b.topicId, scaffold_id: person, slot_ids: {}, citations: [] }))).toBe("evidence");
    expect(await gateOf(b.runtime.call("render_prompt", { topic_id: b.topicId, scaffold_id: person, slot_ids: { cue: "person:maya" }, citations: [] }))).toBe("evidence");
    expect(await gateOf(b.runtime.call("render_prompt", { topic_id: b.topicId, scaffold_id: person, slot_ids: { cue: "person:nobody" }, citations: ["person:nobody"] }))).toBe("evidence");
    expect(await gateOf(b.runtime.call("render_prompt", { topic_id: b.topicId, scaffold_id: "LADDER-2-FAMILY-SUMMERS", slot_ids: { cue: "person:maya" }, citations: [b.topicId, "person:maya"] }))).toBe("evidence");
    expect(await gateOf(b.runtime.call("render_prompt", { topic_id: b.topicId, scaffold_id: "GREETING", slot_ids: { name: "person:maya" }, citations: ["person:maya"] }))).toBe("evidence"); // setup slots are never a caller's to fill
  });

  it("an attribution that does not match the claim's speaker fails closed, both ways round", async () => {
    const b = await bench();
    const hers = "claim:cape-may-with-maya";
    const mayas = "claim:maya-remembers-cape-may";
    // Maya's account said as a plain fact ("You and Maya..."): refused.
    expect(await gateOf(b.runtime.call("render_prompt", { topic_id: b.topicId, scaffold_id: "LADDER-3-PERSON-FAMILY-SUMMERS", slot_ids: { cue: "person:maya" }, citations: [b.topicId, mayas, "person:maya"] }))).toBe("evidence");
    // Maya's account under "You told me": refused. (Recall's own script has no such line; this is the test-only one.)
    const withLastRung = await bench({ script: SCRIPT_WITH_REORIENTATION });
    expect(await gateOf(withLastRung.runtime.call("render_prompt", { topic_id: b.topicId, scaffold_id: "LADDER-5-TEST-ONLY", slot_ids: { relation: "RELATED_TO:person:susan->person:maya", person: "person:maya", place: "place:cape-may" }, citations: [b.topicId, mayas, "person:maya", "place:cape-may", "RELATED_TO:person:susan->person:maya"] }))).toBe("evidence");
    // Her own account attributed to Maya: refused.
    expect(await gateOf(b.runtime.call("render_prompt", { topic_id: b.topicId, scaffold_id: "LADDER-3-FAMILY-SOURCED", slot_ids: { author: "person:maya", topic: b.topicId }, citations: [b.topicId, hers, "person:maya"] }))).toBe("evidence");
    // The matching attribution is said.
    const ok = await b.runtime.call("render_prompt", { topic_id: b.topicId, scaffold_id: "LADDER-3-FAMILY-SOURCED", slot_ids: { author: "person:maya", topic: b.topicId }, citations: [b.topicId, mayas, "person:maya"] });
    expect(ok.text).toBe("Maya mentioned the summers at Cape May. What do you remember about that?");
  });

  it("verification cannot be used to launder something retrieval did not return", async () => {
    const b = await bench();
    const out = await b.runtime.call("verify_claim_support", { topic_id: b.topicId, claim_ids: ["claim:taught-at-lincoln", "claim:no-such-thing"], policy_token_id: b.tokenId });
    expect(out.rejected).toEqual([{ claim_id: "claim:no-such-thing", reason: "not_in_graph" }, { claim_id: "claim:taught-at-lincoln", reason: "not_retrieved_for_this_topic" }]);
    expect(b.ctx.gate.isVerified("claim:taught-at-lincoln")).toBe(false);
  });

  it("an identity or relationship binding without an approved source fails closed", async () => {
    // A neighbour - not an approved person - says who someone is. It is in the graph, and it cannot be spoken.
    const neighbour = overlay(
      "a binding from someone the joint setup never approved",
      [
        { id: "artifact:neighbour-note", type: "Artifact", label: "A note from a neighbour", props: { kind: "family_story", text: "Ravi is her son.", alt: null }, source: "artifact:neighbour-note" },
        { id: "person:ravi", type: "Person", label: "Ravi", props: { display_name: "Ravi", role: "known" }, source: "artifact:neighbour-note" },
      ],
      [
        { type: "RELATED_TO", from: "person:susan", to: "person:ravi", source: "artifact:neighbour-note", props: { relation: "child", said_as: "son" } },
        { type: "RELATED_TO", from: "person:ravi", to: "event:cape-may-summers", source: "artifact:neighbour-note", props: { relation: "attended", said_as: null } },
        { type: "PERMITTED_IN", from: "artifact:neighbour-note", to: "policy:susan-setup", source: "artifact:setup-record" },
      ],
      { "artifact:neighbour-note": { source_class: "family_contribution", asset_id: null, observed_at: "2026-10-30T12:00:00.000Z", author: "person:neighbour", extraction_method: "family_form", confidence: 1, audience_scope: ["person:susan"], expires_at: null } },
    );
    const b = await bench({ overlays: [neighbour] });
    expect(b.verified).not.toContain("person:ravi");
    expect(b.verified).not.toContain("RELATED_TO:person:susan->person:ravi");
    // Unapproved evidence is now rejected before traversal, so it cannot lead to another person's claims.
    const retrieved = b.runtime.log.find((c) => c.tool === "query_context_graph")!.output as { candidates: Array<{ root_id: string }>; relations: Array<{ edge_id: string }> };
    expect(retrieved.candidates.map((c) => c.root_id)).not.toContain("person:ravi");
    expect(retrieved.relations.map((r) => r.edge_id)).not.toContain("RELATED_TO:person:susan->person:ravi");
  });
});

describe("graph cue edges must carry their own evidence", () => {
  it.each(["inferred", "expired", "revoked", "other_audience", "unpermitted"] as const)("does not use a %s link between independently verified nodes", async (problem) => {
    const b = await bench();
    const original = await b.graph.getNode("claim:cape-may-with-maya");
    if (original?.type !== "EpisodicClaim") throw new Error("missing fixture");
    const source = await b.graph.getNode(original.prov.source_id);
    if (source?.type !== "Artifact") throw new Error("missing source");
    const id = "claim:aaa-waves", sourceId = "artifact:waves", prov = { ...original.prov, source_id: sourceId };
    await b.graph.putNode({ ...source, id: sourceId, props: { ...source.props, text: "We watched the waves." }, prov });
    await b.graph.putNode({ ...original, id, props: { text: "We watched the waves." }, prov });
    for (const [type, from, to] of [["EVIDENCE_FOR", sourceId, id], ["PERMITTED_IN", sourceId, b.setup.current().policy_id], ["SPOKEN_BY", id, "person:susan"], ["ABOUT", id, b.topicId]] as const) {
      await b.graph.putEdge({ id: `${type}:waves`, type, from, to, props: {}, prov });
    }
    const bad = { ...prov };
    if (problem === "inferred") bad.status = "inferred";
    if (problem === "expired") bad.expires_at = "2000-01-01T00:00:00.000Z";
    if (problem === "revoked") { bad.source_class = "family_contribution"; bad.author = "person:revoked"; }
    if (problem === "other_audience") bad.audience_scope = ["person:someone-else"];
    if (problem === "unpermitted") bad.source_id = "artifact:unpermitted";
    await b.graph.putEdge({ id: "ABOUT:unsupported-cue", type: "ABOUT", from: id, to: "person:maya", props: { mention_only: true }, prov: bad });
    const query = await b.runtime.call("query_context_graph", { topic_id: b.topicId, max_hops: 2, policy_token_id: b.tokenId });
    const support = await b.runtime.call("verify_claim_support", { topic_id: b.topicId, claim_ids: [b.topicId, ...query.candidates.map((c) => c.root_id), ...query.relations.map((r) => r.edge_id)], policy_token_id: b.tokenId });
    const verified = support.verified.map((c) => c.claim_id);
    expect(verified).toContain(id); expect(verified).toContain("person:maya");
    const machine = b.ctx.machine(); b.ctx.machine = () => ({ ...machine, context: { ...machine.context, rungs_fired: [1, 2] } });
    b.ctx.knowledgeQuestions = true;
    const selected = await b.runtime.call("select_scaffold", { topic_id: b.topicId, state: "no_answer", rungs_fired: [1, 2], verified_ids: verified });
    expect(selected.citations).not.toContain(id);
    expect(await gateOf(b.runtime.call("render_prompt", { topic_id: b.topicId, scaffold_id: "LADDER-3-KNOWLEDGE", slot_ids: { cue: "person:maya" }, citations: [b.topicId, id, "person:maya"] }))).toBe("evidence");
  });
});

describe("the ladder cannot be talked up", () => {
  it("select_scaffold refuses a caller's account of which rungs have fired", async () => {
    const b = await bench();
    // Claiming 1-4 are done, to reach reorientation: the reducer's record says none has fired.
    expect(await gateOf(b.runtime.call("select_scaffold", { topic_id: b.topicId, state: "no_answer", verified_ids: b.verified, rungs_fired: [1, 2, 3, 4] }))).toBe("evidence");
    const opening = await b.runtime.call("select_scaffold", { topic_id: b.topicId, state: "opening", verified_ids: b.verified, rungs_fired: [] });
    expect(opening.rung).toBe(1); // never above rung 1, even though the retrieval layer already knows a good cue
    expect(opening.cue).toBeNull();
  });

  it("never returns rung 4 or 5 for a patient_confirmed: false topic, whatever has fired", async () => {
    const b = await bench({ policy: policyWith((p) => (p.topics.allow = ["event:mayas-wedding"])) });
    expect(b.ctx.session.topic).toMatchObject({ family_sourced: true });
    const first = await b.runtime.call("select_scaffold", { topic_id: b.topicId, state: "opening", verified_ids: b.verified, rungs_fired: [] });
    expect(first.rung).toBe(1);
    expect(first.family_sourced_limit).toBe(true);
    expect(first.rejected.filter((r) => r.rung > 3).map((r) => r.reason)).toEqual([expect.stringMatching(/rule 13/), expect.stringMatching(/rule 13/)]);
    expect((await b.graph.getNode("claim:wedding-in-new-jersey"))!.prov.patient_confirmed).toBe(false);
  });
});

describe("the call gate", () => {
  it("place_recall_call places a call only for the topic the ranking chose", async () => {
    const b = await bench();
    expect(await gateOf(b.runtime.call("place_recall_call", { person_id: "person:susan", topic_id: "event:mayas-wedding", window: { now: b.clock.iso() } }))).toBe("policy");
  });

  it("calls go only to her", async () => {
    const b = await bench();
    const pick = await b.runtime.call("get_next_recall_topic", { person_id: "person:maya", schedule_context: { now: b.clock.iso() } });
    expect(pick.topic).toBeNull(); // there is no topic to call a family member about, so no call
  });

  it("a token is for one topic, and expires", async () => {
    const b = await bench();
    expect(await gateOf(b.runtime.call("query_context_graph", { topic_id: "place:princeton", max_hops: 2, policy_token_id: b.tokenId }))).toBe("policy");
    b.clock.advance(31 * 60_000);
    expect(await gateOf(b.runtime.call("query_context_graph", { topic_id: b.topicId, max_hops: 2, policy_token_id: b.tokenId }))).toBe("policy");
  });
});

describe("capture", () => {
  it("rejects any stretch of the call that holds Recall's speech", async () => {
    const run = await runJudgedPath();
    const b = await bench();
    Object.assign(b.ctx.session, { assessments: run.ctx.session.assessments });
    expect(await gateOf(b.runtime.call("capture_contribution", { topic_id: b.topicId, audio_intervals: [{ asset_id: "call-golden", start_ms: 33_000, end_ms: 42_000 }] }))).toBe("authorship");
    const ok = await b.runtime.call("capture_contribution", { topic_id: b.topicId, audio_intervals: [{ asset_id: "call-golden", start_ms: 37_500, end_ms: 41_900 }] });
    expect(ok.literal_transcript).toBe(HER_LINE);
  });

  it("captures nothing before she has said anything about it", async () => {
    const b = await bench();
    expect(await gateOf(b.runtime.call("capture_contribution", { topic_id: b.topicId, audio_intervals: [{ asset_id: "call-golden", start_ms: 37_500, end_ms: 41_900 }] }))).toBe("authorship");
  });
});
