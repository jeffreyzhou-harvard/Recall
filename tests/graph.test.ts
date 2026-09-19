/**
 * The graph layer: policy-bounded retrieval, and parity between the in-memory
 * store the judged path uses and the LadybugDB store that persists it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MANIFEST } from "@/fixtures";
import { buildFixtureRig, runFixture, runJudgedPath } from "@/fixtures/harness";
import { LadybugGraphStore, schemaDdl } from "@/lib/graph/ladybug-store";
import { MemoryGraphStore } from "@/lib/graph/memory-store";
import { retrieveCandidates, type RetrievalParams } from "@/lib/graph/retrieval";
import { loadInto } from "@/lib/graph/store";
import { EDGE_TYPES, NODE_LAYER, NODE_TYPES } from "@/lib/graph/types";
import type { GraphData } from "@/lib/graph/types";
import { AssetIndex } from "@/lib/provenance/assets";
import { NEGATIVE_CONTROLS } from "./fixtures";

const assets = new AssetIndex(MANIFEST);
const PHOTO = "artifact:photo:fwd-diwali-dessert:photo-desserts";

/** The family graph plus negative controls, with the ask taken in through real intake and its photo permitted by a grant. */
async function graphWithAsk(): Promise<GraphData> {
  const rig = await buildFixtureRig({ overlays: [NEGATIVE_CONTROLS] });
  await rig.service.forwardAsk(rig.forward);
  const photo = (await rig.graph.getNode(PHOTO))!;
  await rig.graph.putEdge({ id: `PERMITTED_IN:${PHOTO}->policy:mom-default`, type: "PERMITTED_IN", from: PHOTO, to: "policy:mom-default", props: {}, prov: photo.prov });
  return rig.graph.snapshot();
}

const params: RetrievalParams = {
  ask_id: "ask:fwd-diwali-dessert",
  policy_id: "policy:mom-default",
  audience: "artifact:thread-family",
  allowed_sources: ["current_ask", "ask_artifact", "prior_claim_with_source"],
  max_hops: 2,
  now_iso: "2026-11-05T17:30:00.000Z",
};

describe("schema", () => {
  it("has the twelve node types and sixteen edge types the brief names, each node in exactly one layer", () => {
    expect(NODE_TYPES).toHaveLength(12);
    expect(EDGE_TYPES).toHaveLength(16);
    expect(Object.keys(NODE_LAYER).sort()).toEqual([...NODE_TYPES].sort());
    expect(schemaDdl()).toHaveLength(28);
  });
});

describe("policy-bounded retrieval", () => {
  let withControls: GraphData;
  beforeAll(async () => {
    withControls = await graphWithAsk();
  });

  it("drops everything the policy does not permit, and says why", async () => {
    const result = await retrieveCandidates(MemoryGraphStore.from(withControls), params);
    expect(result.candidates.map((c) => c.root_id).sort()).toEqual([PHOTO, "claim:cardamom-last"]);
    expect(result.excluded).toEqual([
      { node_id: "claim:expired", reason: "expired" },
      { node_id: "claim:other-audience", reason: "audience_out_of_scope" },
      { node_id: "claim:unpermitted", reason: "artifact_not_permitted_by_policy" },
      { node_id: "pref:mom-festival-desserts", reason: "source_class_not_allowed" },
    ]);
  });

  it("returns citations, not prose: every candidate carries its source, span, and media hash", async () => {
    const { candidates } = await retrieveCandidates(MemoryGraphStore.from(withControls), params);
    const claim = candidates.find((c) => c.root_id === "claim:cardamom-last")!;
    expect(claim.hops).toBe(2);
    expect(claim.path_node_ids).toEqual(["ask:fwd-diwali-dessert", "topic:kheer", "claim:cardamom-last"]);
    expect(claim.citations[0]).toMatchObject({ source_id: "artifact:clip-cardamom", asset_id: "clip-cardamom", span: { start_ms: 2100, end_ms: 4300 } });
    expect(claim.citations[0]!.media_hash).toBe(assets.get("clip-cardamom").sha256);
    expect(candidates.map((c) => c.rank)).toEqual([1, 2]);
  });

  it("never walks through a person: what she once said is not reachable just because she said it", async () => {
    const { candidates } = await retrieveCandidates(MemoryGraphStore.from(withControls), { ...params, max_hops: 2 });
    expect(candidates.some((c) => c.path_node_ids.includes("person:mom"))).toBe(false);
  });

  it("without a grant, the forwarded photo is not usable: nothing permits it yet", async () => {
    const rig = await buildFixtureRig();
    await rig.service.forwardAsk(rig.forward);
    const result = await retrieveCandidates(rig.graph, params);
    expect(result.excluded).toContainEqual({ node_id: PHOTO, reason: "artifact_not_permitted_by_policy" });
  });

  it("an expired ask artifact stops being evidence once its time passes", async () => {
    const later = { ...params, now_iso: "2026-11-08T00:00:00.000Z" };
    const result = await retrieveCandidates(MemoryGraphStore.from(withControls), later);
    expect(result.candidates.map((c) => c.root_id)).toEqual(["claim:cardamom-last"]);
  });
});

describe("LadybugDB store", () => {
  let lbug: LadybugGraphStore;
  let data: GraphData;

  beforeAll(async () => {
    data = await graphWithAsk();
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

  it("native Cypher agrees with the shared retrieval about which prior claims are usable", async () => {
    const cypher = await lbug.claimIdsForAsk(params.ask_id, params.allowed_sources, params.now_iso);
    // Cypher filters on source class and freshness; audience and artifact permission are applied on top.
    expect(cypher).toEqual(["claim:cardamom-last", "claim:other-audience", "claim:unpermitted"]);
    expect(cypher).not.toContain("claim:expired");
    const shared = (await retrieveCandidates(lbug, params)).candidates.filter((c) => c.root_type === "EpisodicClaim").map((c) => c.root_id);
    expect(cypher).toEqual(expect.arrayContaining(shared));
  });

  it("finds the one live ask for a thread", async () => {
    expect((await lbug.findCurrentAsk("artifact:thread-family"))!.id).toBe("ask:fwd-diwali-dessert");
    expect(await lbug.findCurrentAsk("artifact:nowhere")).toBeNull();
  });

  it("lists nodes by type, as intake needs in order to match an ask against known names", async () => {
    expect((await lbug.nodesOfType("Topic")).map((t) => t.id)).toEqual((await MemoryGraphStore.from(data).nodesOfType("Topic")).map((t) => t.id));
    expect((await lbug.nodesOfType("Event")).map((e) => e.label)).toEqual(["Diwali"]);
  });

  it("runs the whole judged path - intake, grant, audit writes - with the same result as the in-memory store", async () => {
    const store = await LadybugGraphStore.open(":memory:");
    try {
      const onLbug = await runFixture({ graph: store });
      const inMemory = await runJudgedPath();
      expect(onLbug.recording).toEqual(inMemory.recording);
      expect(await store.snapshot()).toEqual(await inMemory.graph.snapshot());
    } finally {
      await store.close();
    }
  });
});
