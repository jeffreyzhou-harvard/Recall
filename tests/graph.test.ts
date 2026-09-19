/**
 * The graph layer: policy-bounded retrieval from a topic, and parity between
 * the in-memory store the judged path uses and the LadybugDB store that
 * persists it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FAMILY_SEED, MANIFEST } from "@/fixtures";
import { buildFixtureRig, runFixture, runJudgedPath } from "@/fixtures/harness";
import { LadybugGraphStore, schemaDdl } from "@/lib/graph/ladybug-store";
import { MemoryGraphStore } from "@/lib/graph/memory-store";
import { retrieveCandidates, type RetrievalParams } from "@/lib/graph/retrieval";
import { cueHints, preferCues } from "@/lib/graph/retrieval-layer";
import { SeedValidationError, buildGraph, mergeSeeds } from "@/lib/graph/seed";
import { loadInto } from "@/lib/graph/store";
import { EDGE_TYPES, ERASABLE_NODE_TYPES, NODE_LAYER, NODE_TYPES, patientConfirmed, type GraphData } from "@/lib/graph/types";
import { AssetIndex } from "@/lib/provenance/assets";
import { overlay } from "./helpers";

const assets = new AssetIndex(MANIFEST);
const TOPIC = "event:cape-may-summers";
const V = "artifact:onboarding-voice";

/** Facts the policy must keep out, each for a different reason. They exist only to be excluded. */
const NEGATIVE_CONTROLS = overlay(
  "claims about Cape May that must never be offered as context",
  [
    { id: "artifact:old-note", type: "Artifact", label: "An old note", props: { kind: "family_story", text: "We rented the blue house.", alt: null }, source: "artifact:old-note" },
    { id: "claim:expired", type: "EpisodicClaim", label: "An expired claim", props: { text: "We rented the blue house." }, source: "artifact:old-note" },
    { id: "artifact:someone-elses", type: "Artifact", label: "A note scoped to someone else", props: { kind: "family_story", text: "A note for Priya only.", alt: null }, source: "artifact:someone-elses" },
    { id: "claim:other-audience", type: "EpisodicClaim", label: "Scoped to someone else", props: { text: "A note for Priya only." }, source: "artifact:someone-elses" },
    { id: "artifact:unpermitted", type: "Artifact", label: "A note nobody permitted", props: { kind: "family_story", text: "Never shown to the joint setup.", alt: null }, source: "artifact:unpermitted" },
    { id: "claim:unpermitted", type: "EpisodicClaim", label: "Not permitted", props: { text: "Never shown to the joint setup." }, source: "artifact:unpermitted" },
    { id: "artifact:a-guess", type: "Artifact", label: "A guess", props: { kind: "answer", text: null, alt: null }, source: "artifact:a-guess" },
    { id: "claim:inferred", type: "EpisodicClaim", label: "Worked out, never said", props: { text: "Presumably they drove." }, source: "artifact:a-guess" },
  ],
  [
    ...["claim:expired", "claim:other-audience", "claim:unpermitted", "claim:inferred"].map((c) => ({ type: "ABOUT" as const, from: c, to: TOPIC, source: "artifact:setup-record" })),
    ...["artifact:old-note", "artifact:someone-elses", "artifact:a-guess"].map((a) => ({ type: "PERMITTED_IN" as const, from: a, to: "policy:susan-setup", source: "artifact:setup-record" })),
  ],
  {
    "artifact:old-note": { source_class: "family_contribution", asset_id: null, observed_at: "2025-01-01T00:00:00.000Z", author: "person:maya", extraction_method: "family_form", confidence: 1, audience_scope: ["person:susan"], expires_at: "2026-01-01T00:00:00.000Z" },
    "artifact:someone-elses": { source_class: "family_contribution", asset_id: null, observed_at: "2026-10-01T00:00:00.000Z", author: "person:maya", extraction_method: "family_form", confidence: 1, audience_scope: ["person:priya"], expires_at: null },
    "artifact:unpermitted": { source_class: "family_contribution", asset_id: null, observed_at: "2026-10-01T00:00:00.000Z", author: "person:maya", extraction_method: "family_form", confidence: 1, audience_scope: ["person:susan"], expires_at: null },
    "artifact:a-guess": { source_class: "discovery_answer", asset_id: null, observed_at: "2026-10-01T00:00:00.000Z", author: "person:maya", extraction_method: "rule_deduction", confidence: 0.5, audience_scope: ["person:susan"], expires_at: null, status: "inferred" },
  },
);

const graphWithControls = (): GraphData => buildGraph(mergeSeeds(FAMILY_SEED, NEGATIVE_CONTROLS), assets);
const params: RetrievalParams = { topic_id: TOPIC, policy_id: "policy:susan-setup", audience: "person:susan", allowed_sources: ["prior_claim_with_source", "recall_call", "family_contribution", "joint_setup"], max_hops: 2, now_iso: "2026-11-05T17:30:00.000Z" };

describe("schema", () => {
  it("has the brief's eighteen node types and its edges, each node in exactly one layer", () => {
    const brief = ["Person", "Relationship", "Place", "Event", "EpisodicClaim", "PreferenceExpertise", "Artifact", "AccessPolicy", "Session", "Contribution", "RetrievalRecord", "FamilyQueryEvent", "WeeklyNote", "ShareConfirmation", "TopicOutcome", "ExportEvent", "DashboardAccessGrant", "SafetyEvent"];
    expect(NODE_TYPES.slice(0, 18)).toEqual(brief);
    expect(NODE_TYPES.slice(18)).toEqual(["Activity", "Story", "Cluster"]); // ask-don't-assert; off unless the joint setup turns it on
    for (const edge of ["RELATED_TO", "OCCURRED_AT", "DEPICTS", "ABOUT", "EVIDENCE_FOR", "SPOKEN_BY", "CONTRIBUTED_BY", "RECALLED_IN", "CUE_EFFECTIVE_FOR", "CUE_INEFFECTIVE_FOR", "CONTRADICTS", "DERIVED_FROM", "INCLUDED_SPAN", "SHARE_CONFIRMED_BY", "POSTED_IN", "OUTCOME_OF"]) expect(EDGE_TYPES).toContain(edge);
    expect(Object.keys(NODE_LAYER).sort()).toEqual([...NODE_TYPES].sort());
    expect(schemaDdl()).toHaveLength(NODE_TYPES.length + EDGE_TYPES.length);
    // Nothing is left of the family-relay mechanic.
    for (const gone of ["CurrentAsk", "Assent", "ASKED_BY", "ADDRESSED_TO", "DELIVERED_TO", "MEMBER_OF_THREAD"]) expect([...NODE_TYPES, ...EDGE_TYPES]).not.toContain(gone);
  });

  it("the seed is compact - a couple of dozen hand-curated facts, not an ontology - and every claim has a named human author", () => {
    const data = buildGraph(FAMILY_SEED, assets);
    const curated = data.nodes.filter((n) => !["Session", "TopicOutcome", "RetrievalRecord"].includes(n.type));
    expect(curated.length).toBeGreaterThanOrEqual(20);
    expect(curated.length).toBeLessThanOrEqual(30);
    for (const claim of data.nodes.filter((n) => n.type === "EpisodicClaim")) expect(claim.prov.author).toMatch(/^person:/);
  });

  it("patient_confirmed is never typed by hand: it follows from how each fact is known, everywhere", () => {
    const data = buildGraph(FAMILY_SEED, assets);
    for (const x of [...data.nodes, ...data.edges]) expect(x.prov.patient_confirmed, x.id).toBe(patientConfirmed(x.prov.status));
    const of = (id: string) => data.nodes.find((n) => n.id === id)!.prov;
    expect(of("claim:cape-may-with-maya")).toMatchObject({ author: "person:susan", patient_confirmed: true });
    expect(of("claim:maya-remembers-cape-may")).toMatchObject({ author: "person:maya", status: "family_confirmed", patient_confirmed: false });
    expect(of("claim:wedding-in-new-jersey").patient_confirmed).toBe(false);
  });

  it("call history is one row per call: the loader writes the Session, its TopicOutcome, and the cue record so they always agree", () => {
    const data = buildGraph(FAMILY_SEED, assets);
    const outcomes = data.nodes.filter((n) => n.type === "TopicOutcome");
    expect(outcomes).toHaveLength(21);
    expect(data.nodes.filter((n) => n.type === "Session")).toHaveLength(21);
    expect(data.edges.filter((e) => e.type === "OUTCOME_OF")).toHaveLength(21);
    expect(data.edges.filter((e) => e.type === "CUE_EFFECTIVE_FOR").map((e) => e.to)).toEqual(Array(4).fill(TOPIC));
  });

  it("refuses an edge the schema does not allow, a fact with no declared source, and clinical language", () => {
    const bad = (nodes: Parameters<typeof overlay>[1], edges: Parameters<typeof overlay>[2]) => () => buildGraph(mergeSeeds(FAMILY_SEED, overlay("bad", nodes, edges)), assets);
    expect(bad([], [{ type: "OUTCOME_OF", from: "person:susan", to: "person:maya", source: "artifact:setup-record" }])).toThrow(/OUTCOME_OF may not connect Person -> Person/);
    expect(bad([{ id: "claim:x", type: "EpisodicClaim", label: "x", props: { text: "x" }, source: "artifact:nowhere" }], [])).toThrow(/undeclared source/);
    expect(bad([{ id: "claim:y", type: "EpisodicClaim", label: "y", props: { text: "Her cognitive decline is advancing." }, source: V }], [])).toThrow(SeedValidationError);
    expect(bad([{ id: "claim:z", type: "EpisodicClaim", label: "z", props: { text: "z" }, source: V, contradicts: ["claim:cape-may-with-maya"] }], [])).toThrow(/no CONTRADICTS edge/);
  });
});

describe("policy-bounded retrieval", () => {
  it("drops everything the policy does not permit, and says why", async () => {
    const result = await retrieveCandidates(MemoryGraphStore.from(graphWithControls()), params);
    expect(result.excluded).toEqual([
      { node_id: "claim:expired", reason: "expired" },
      { node_id: "claim:inferred", reason: "not_confirmed" },
      { node_id: "claim:other-audience", reason: "audience_out_of_scope" },
      { node_id: "claim:unpermitted", reason: "artifact_not_permitted_by_policy" },
    ]);
    const kept = result.candidates.map((c) => c.root_id);
    for (const id of ["claim:cape-may-with-maya", "claim:maya-remembers-cape-may", "person:maya", "person:priya", "place:cape-may", "artifact:photo-cape-may"]) expect(kept).toContain(id);
    for (const id of ["claim:expired", "claim:inferred", "claim:other-audience", "claim:unpermitted"]) expect(kept).not.toContain(id);
  });

  it("returns citations, not prose: every candidate carries its source, span, media hash, and whether these are her words", async () => {
    const { candidates } = await retrieveCandidates(MemoryGraphStore.from(graphWithControls()), params);
    const hers = candidates.find((c) => c.root_id === "claim:cape-may-with-maya")!;
    expect(hers).toMatchObject({ hops: 1, path_node_ids: [TOPIC, "claim:cape-may-with-maya"] });
    expect(hers.citations[0]).toMatchObject({ source_id: V, asset_id: "clip-onboarding", span: { start_ms: 3000, end_ms: 6000 }, author: "person:susan", patient_confirmed: true });
    expect(hers.citations[0]!.media_hash).toBe(assets.get("clip-onboarding").sha256);
    expect(candidates.find((c) => c.root_id === "claim:maya-remembers-cape-may")!.citations[0]).toMatchObject({ author: "person:maya", patient_confirmed: false });
    expect(candidates.map((c) => c.rank)).toEqual(candidates.map((_, i) => i + 1));
  });

  it("returns the stated ties between the people in reach, in the word that was actually used", async () => {
    const { relations } = await retrieveCandidates(MemoryGraphStore.from(graphWithControls()), params);
    expect(relations.map((r) => [r.from, r.said_as, r.to])).toEqual([["person:maya", "daughter", "person:anika"], ["person:susan", "daughter", "person:maya"], ["person:susan", "sister", "person:priya"]]);
  });

  it("one hop reaches less than two, and what is reached is always inside the policy", async () => {
    const store = MemoryGraphStore.from(graphWithControls());
    const one = (await retrieveCandidates(store, { ...params, max_hops: 1 })).candidates.map((c) => c.root_id);
    const two = (await retrieveCandidates(store, params)).candidates.map((c) => c.root_id);
    expect(one).not.toContain("person:priya");
    expect(two).toEqual(expect.arrayContaining(one));
    expect((await retrieveCandidates(store, { ...params, allowed_sources: ["prior_claim_with_source"] })).candidates.every((c) => c.citations[0]!.source_class === "prior_claim_with_source")).toBe(true);
  });
});

describe("the retrieval layer", () => {
  it("counts what happened per cue, and orders candidates: helped before, never tried, only ever not helped", async () => {
    const store = MemoryGraphStore.from(buildGraph(FAMILY_SEED, assets));
    const hints = await cueHints(store, TOPIC);
    expect(hints.map((h) => [h.cue_id, h.effective, h.ineffective])).toEqual([["artifact:photo-cape-may", 1, 0], ["person:maya", 3, 0]]);
    const order = (ids: string[], h = hints) => preferCues(ids.map((cue_id) => ({ cue_id })), h).map((c) => c.cue_id);
    expect(order(["artifact:photo-cape-may", "person:maya", "person:priya"])).toEqual(["person:maya", "artifact:photo-cape-may", "person:priya"]);
    expect(order(["person:priya", "person:maya"], [{ cue_id: "person:maya", effective: 0, ineffective: 2, last_used_at: "" }])).toEqual(["person:priya", "person:maya"]);
    expect(order(["person:maya", "artifact:photo-cape-may"], [])).toEqual(["artifact:photo-cape-may", "person:maya"]); // no preference: plain id order
  });
});

describe("LadybugDB store", () => {
  let lbug: LadybugGraphStore;
  const data = graphWithControls();

  beforeAll(async () => {
    lbug = await LadybugGraphStore.open(":memory:");
    await loadInto(lbug, data);
  });
  afterAll(async () => {
    await lbug.close();
  });

  it("round-trips the whole graph exactly, provenance included", async () => {
    expect(await lbug.snapshot()).toEqual(await MemoryGraphStore.from(data).snapshot());
  });

  it("answers retrieval identically to the in-memory store", async () => {
    expect(await retrieveCandidates(lbug, params)).toEqual(await retrieveCandidates(MemoryGraphStore.from(data), params));
  });

  it("native Cypher agrees with the shared retrieval about which claims on a topic are usable", async () => {
    const cypher = await lbug.claimIdsForTopic(TOPIC, params.allowed_sources, params.now_iso);
    // Cypher filters on source class and freshness; audience, artifact permission, and confirmation are applied on top.
    expect(cypher).toEqual(["claim:cape-may-with-maya", "claim:maya-remembers-cape-may", "claim:other-audience", "claim:unpermitted"]);
    const shared = (await retrieveCandidates(lbug, params)).candidates.filter((c) => c.root_type === "EpisodicClaim" && c.hops === 1).map((c) => c.root_id);
    expect(cypher).toEqual(expect.arrayContaining(shared));
  });

  it("both stores refuse to overwrite a node or edge that is already written", async () => {
    const memory = MemoryGraphStore.from(data);
    const node = data.nodes.find((n) => n.id === "claim:cape-may-with-maya")!;
    const edge = data.edges.find((e) => e.from === node.id)!;
    await expect(memory.putNode({ ...node, label: "rewritten" })).rejects.toThrow(/already in the graph/);
    await expect(memory.putEdge({ ...edge, props: { rewritten: "yes" } })).rejects.toThrow(/already in the graph/);
    await expect(lbug.putNode({ ...node, label: "rewritten" })).rejects.toThrow();
    await expect(lbug.putEdge({ ...edge, props: { rewritten: "yes" } })).rejects.toThrow(/already in the graph/);
    expect((await lbug.getNode(node.id))!.label).toBe(node.label);
  });

  it("both stores delete only the two record layers, with their edges, and nothing else", async () => {
    const fresh = await LadybugGraphStore.open(":memory:");
    try {
      await loadInto(fresh, buildGraph(FAMILY_SEED, assets));
      const memory = MemoryGraphStore.from(buildGraph(FAMILY_SEED, assets));
      expect(ERASABLE_NODE_TYPES).toEqual(["RetrievalRecord", "TopicOutcome"]);
      for (const store of [fresh, memory]) {
        await expect(store.removeNodesOfType("EpisodicClaim" as never)).rejects.toThrow(/cannot be removed/);
        expect(await store.removeNodesOfType("RetrievalRecord")).toBe(4);
        expect(await store.nodesOfType("RetrievalRecord")).toEqual([]);
        expect((await store.nodesOfType("TopicOutcome")).length).toBe(21); // the other layer is untouched
        expect((await store.edgesOf(TOPIC)).filter((e) => e.type.startsWith("CUE_"))).toEqual([]);
      }
      expect(await fresh.snapshot()).toEqual(await memory.snapshot());
    } finally {
      await fresh.close();
    }
  });

  it("runs the whole judged path - the call, the writes, the family side - with the same result as the in-memory store", async () => {
    const store = await LadybugGraphStore.open(":memory:");
    try {
      const onLbug = await runFixture({ graph: store });
      const inMemory = await runJudgedPath();
      expect(onLbug.recording).toEqual(inMemory.recording);
      expect(await onLbug.service.weeklyNote("person:maya")).toEqual(await inMemory.service.weeklyNote("person:maya"));
      expect(await onLbug.service.topicRecord("person:maya")).toEqual(await inMemory.service.topicRecord("person:maya"));
      expect(await store.snapshot()).toEqual(await inMemory.graph.snapshot());
    } finally {
      await store.close();
    }
  });
});

describe("a rig builds from the seed as it is", () => {
  it("and the default graph validates", async () => {
    await expect(buildFixtureRig()).resolves.toBeDefined();
  });
});
