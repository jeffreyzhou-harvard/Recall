import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { buildFixtureRig } from "@/fixtures/harness";
import { FAMILY_SEED, MANIFEST } from "@/fixtures";
import { buildGraph } from "@/lib/graph/seed";
import { AssetIndex } from "@/lib/provenance/assets";
import { KnowledgeUpdater, LiteralGraphExtractor, relinkKnownMentions, updateId, type Extraction, type GraphExtractor } from "@/lib/knowledge/updates";
import { planQuestion } from "@/lib/knowledge/questions";
import { importKnowledge } from "@/server/knowledge-import";
import { reviewItems, reviewKnowledge } from "@/server/knowledge-review";
import { SqliteGraphStore } from "@/server/graph-store";
import { LadybugGraphStore } from "@/lib/graph/ladybug-store";
import { retrieveCandidates } from "@/lib/graph/retrieval";
import { MuseGraphExtractor } from "@/lib/providers/muse/graph";
import { MuseSpark, type MuseFetch } from "@/lib/providers/muse/spark";
const folders: string[] = [], stores: SqliteGraphStore[] = [];
afterEach(async () => { for (const s of stores.splice(0)) { await s.closeIndex(); s.close(); } for (const p of folders.splice(0)) rmSync(p, { recursive: true, force: true }); vi.restoreAllMocks(); });
async function rig(native = false) {
  const dir = mkdtempSync(join(tmpdir(), "recall-kg-")); folders.push(dir);
  const graph = new SqliteGraphStore(join(dir, "graph.db"), "test", native); stores.push(graph);
  const fixture = await buildFixtureRig({ graph });
  return { ...fixture, graph, dir, media: null, refreshSetup: async () => {} };
}
const draft = (text = "Maya and Susan visited Cape May.") => ({ request_id: randomUUID(), contributor_id: "person:maya", reviewed: true as const, items: [{ kind: "history" as const, label: "a seaside visit", text }] });
async function markSeed(r: Awaited<ReturnType<typeof rig>>) {
  await new KnowledgeUpdater(r.graph, () => r.setup.current(), new LiteralGraphExtractor(), r.refreshSetup, r.clock).process(100);
}

describe("source-backed incremental graph updates", () => {
  it("links exact known mentions, keeps family authorship, and is idempotent across restart", async () => {
    const r = await rig(); await markSeed(r);
    const input = draft(), imported = await importKnowledge(r, input);
    const updater = new KnowledgeUpdater(r.graph, () => r.setup.current(), new LiteralGraphExtractor(), r.refreshSetup, r.clock);
    expect((await updater.process()).processed).toBe(1);
    const claim = `claim:${imported.topics[0]!.id}`;
    expect((await r.graph.edgesOf(claim)).filter((e) => e.props.mention_only).map((e) => e.to).sort()).toEqual(["person:maya", "person:susan", "place:cape-may"]);
    expect((await r.graph.getNode(claim))?.prov).toMatchObject({ author: "person:maya", patient_confirmed: false });
    const before = await r.graph.snapshot();
    expect((await updater.process()).processed).toBe(0);
    expect(await r.graph.snapshot()).toEqual(before);
    const reopened = new SqliteGraphStore(join(r.dir, "graph.db"), "test"); stores.push(reopened);
    expect((await new KnowledgeUpdater(reopened, () => r.setup.current(), undefined, undefined, r.clock).process()).processed).toBe(0);
  });

  it("keeps proposed types and semantic relations inferred, with literal offsets and immutable source", async () => {
    const r = await rig(); await markSeed(r);
    const text = "Maya visited Boston.", imported = await importKnowledge(r, draft(text));
    const extractor: GraphExtractor = { name: "test-model", extract: async () => ({ entities: [{ key: "m", type: "Person", name: "Maya", start: 0, end: 4 }, { key: "b", type: "Place", name: "Boston", start: 13, end: 19 }], relations: [{ from: "m", to: "b", relation: "visited", quote: text, start: 0, end: text.length }] }) };
    const before = await r.graph.getNode(`claim:${imported.topics[0]!.id}`);
    expect((await new KnowledgeUpdater(r.graph, () => r.setup.current(), extractor, r.refreshSetup, r.clock).process()).processed).toBe(1);
    const boston = (await r.graph.nodesOfType("Place")).find((n) => n.label === "Boston")!;
    expect(boston.prov).toMatchObject({ status: "inferred", patient_confirmed: false, source_id: before!.prov.source_id, author: "person:maya" });
    expect((await r.graph.edgesOf(boston.id)).every((e) => e.prov.status === "inferred")).toBe(true);
    expect(await r.graph.getNode(before!.id)).toEqual(before);
    const reviews = await reviewItems(r.graph, r.setup.current(), "person:maya");
    expect(reviews).toHaveLength(2);
    const otherPolicy = structuredClone(r.setup.current()); otherPolicy.approved_people.push("person:priya");
    expect(await reviewItems(r.graph, otherPolicy, "person:priya")).toEqual([]);
    await expect(reviewKnowledge(r.graph, () => otherPolicy, "person:priya", reviews.map((r) => r.id))).rejects.toThrow();
    await reviewKnowledge(r.graph, () => r.setup.current(), "person:maya", reviews.map((r) => r.id));
    const reviewed = await r.graph.getNode(`reviewed:${boston.id}`);
    expect(reviewed?.prov).toMatchObject({ status: "family_confirmed", patient_confirmed: false, author: "person:maya" });
    expect((await r.graph.edgesOf(reviewed!.id)).filter((e) => e.type === "RELATED_TO")).toHaveLength(1);
    expect(await reviewItems(r.graph, r.setup.current(), "person:maya")).toEqual([]);
    const afterReview = await r.graph.snapshot();
    await reviewKnowledge(r.graph, () => r.setup.current(), "person:maya", reviews.map((r) => r.id));
    expect(await r.graph.snapshot()).toEqual(afterReview);
    expect(await r.graph.getNode(before!.id)).toEqual(before);
  });

  it("does not expose or allow family approval of patient-derived interpretations", async () => {
    const r = await rig();
    const person = (await r.graph.nodesOfType("Person"))[0]!;
    const source = (await r.graph.nodesOfType("Artifact"))[0]!;
    await r.graph.putNode({ ...person, id: "entity:private", prov: { ...person.prov, author: "person:susan", source_class: "recall_call", source_id: source.id, status: "inferred", patient_confirmed: false } });
    expect((await reviewItems(r.graph, r.setup.current(), "person:maya")).some((r) => r.id === "entity:private")).toBe(false);
    await expect(reviewKnowledge(r.graph, () => r.setup.current(), "person:maya", ["entity:private"])).rejects.toThrow();
  });

  it("backs off failed episodes so newer contributions can still be organized", async () => {
    const r = await rig(); await markSeed(r);
    await importKnowledge(r, draft("Maya visited Boston.")); await importKnowledge(r, draft("Maya visited Cape May."));
    const extractor: GraphExtractor = { name: "sometimes-unavailable", extract: async (episode) => { if (episode.text.includes("Boston")) throw new Error("unavailable"); return new LiteralGraphExtractor().extract(episode); } };
    const updater = new KnowledgeUpdater(r.graph, () => r.setup.current(), extractor, r.refreshSetup, r.clock);
    await updater.process(1); await updater.process(1);
    expect((await updater.status()).waiting).toBe(1);
  });

  it("rejects fabricated names and partial proposals without writes; a later retry can finish", async () => {
    const r = await rig(); await markSeed(r); const imported = await importKnowledge(r, draft("Maya visited Cape May."));
    const bad: GraphExtractor = { name: "bad", extract: async () => ({ entities: [{ key: "x", type: "Person", name: "Alex", start: 0, end: 4 }], relations: [] }) };
    await r.graph.atomic(() => relinkKnownMentions(r.graph, r.setup.current(), r.clock.iso()));
    const before = await r.graph.snapshot();
    expect((await new KnowledgeUpdater(r.graph, () => r.setup.current(), bad, r.refreshSetup, r.clock).process()).failed).toBe(1);
    expect(await r.graph.snapshot()).toEqual(before);
    expect(await r.graph.getNode(updateId(`claim:${imported.topics[0]!.id}`))).toBeNull();
    expect((await new KnowledgeUpdater(r.graph, () => r.setup.current(), undefined, undefined, r.clock).process()).processed).toBe(1);
  });

  it("does not choose an identity when two known people have the same name", async () => {
    const r = await rig(); await markSeed(r);
    const maya = await r.graph.getNode("person:maya"); if (maya?.type !== "Person") throw new Error("missing fixture person");
    await r.graph.putNode({ ...maya, id: "person:another-maya" });
    const imported = await importKnowledge(r, draft("Maya visited Cape May."));
    await new KnowledgeUpdater(r.graph, () => r.setup.current(), undefined, undefined, r.clock).process();
    const ends = (await r.graph.edgesOf(`claim:${imported.topics[0]!.id}`)).filter((e) => e.type === "ABOUT").map((e) => e.to);
    expect(ends).not.toContain("person:maya"); expect(ends).not.toContain("person:another-maya");
    expect(ends).toContain("place:cape-may");
  });

  it("rechecks joint setup after model execution", async () => {
    const r = await rig(); await markSeed(r); await importKnowledge(r, draft());
    await r.graph.atomic(() => relinkKnownMentions(r.graph, r.setup.current(), r.clock.iso()));
    const before = await r.graph.snapshot();
    const extractor: GraphExtractor = { name: "revocation", extract: async (episode) => {
      // Replace through the fixture store's tightening path.
      r.setup.pauseCalls(true);
      return new LiteralGraphExtractor().extract(episode);
    } };
    expect((await new KnowledgeUpdater(r.graph, () => r.setup.current(), extractor, r.refreshSetup, r.clock).process()).failed).toBe(1);
    expect(await r.graph.snapshot()).toEqual(before);
  });

  it("never enriches a patient claim without a committed contribution", async () => {
    const r = await rig(); await markSeed(r);
    const input = draft(), imported = await importKnowledge(r, input);
    const claim = await r.graph.getNode(`claim:${imported.topics[0]!.id}`);
    if (claim?.type !== "EpisodicClaim") throw new Error("missing claim");
    const id = "claim:unconfirmed-test";
    await r.graph.putNode({ ...claim, id, prov: { ...claim.prov, source_class: "recall_call", author: "person:susan", status: "participant_confirmed", patient_confirmed: true } });
    await r.graph.putEdge({ id: "source:unconfirmed-test", type: "EVIDENCE_FOR", from: claim.prov.source_id, to: id, props: {}, prov: claim.prov });
    const read = vi.fn(async () => ({ entities: [], relations: [] }));
    const updater = new KnowledgeUpdater(r.graph, () => r.setup.current(), { name: "spy", extract: read }, undefined, r.clock);
    expect((await updater.process()).failed).toBe(1);
    expect(await r.graph.getNode(updateId(id))).toBeNull();
    expect(read.mock.calls).toHaveLength(1); // The family claim only.
  });
});

describe("selected onboarding imports", () => {
  it("preserves literal accounts and selected dates, creates unapproved topics, and safely retries", async () => {
    const r = await rig(), input = { ...draft(), items: [{ kind: "calendar" as const, label: "summer gathering", text: "Summer gathering at Cape May.", date: "2020-07-14", place: "Cape May" }] };
    const result = await importKnowledge(r, input), before = await r.graph.snapshot();
    expect(await importKnowledge(r, input)).toEqual(result); expect(await r.graph.snapshot()).toEqual(before);
    expect(r.setup.current().topics.allow).not.toContain(result.topics[0]!.id);
    expect(await r.graph.getNode(result.topics[0]!.id)).toMatchObject({ props: { date: "2020-07-14" }, prov: { patient_confirmed: false, author: "person:maya" } });
    await expect(importKnowledge(r, { ...input, items: [{ ...input.items[0], text: "A different account." }] })).rejects.toThrow();
  });
  it("rejects unapproved contacts, extra private fields, foreign photos, and an invalid batch atomically", async () => {
    const r = await rig(), before = await r.graph.snapshot();
    for (const items of [
      [{ kind: "contact", person_id: "person:stranger", label: "Stranger", text: "Someone I know." }],
      [{ kind: "contact", person_id: "person:maya", label: "Maya", text: "My sister.", phone: "123" }],
      [{ kind: "photo", label: "a summer", text: "Our summer.", asset_id: "not-owned" }],
      [...draft().items, { kind: "history", label: "What happened?", text: "Tell me her secret." }],
    ]) await expect(importKnowledge(r, { ...draft(), items })).rejects.toThrow();
    expect(await r.graph.snapshot()).toEqual(before);
  });
  it("rolls back an interrupted batch", async () => {
    const r = await rig(), before = await r.graph.snapshot(), real = r.graph.putEdge.bind(r.graph); let writes = 0;
    vi.spyOn(r.graph, "putEdge").mockImplementation(async (edge) => { if (++writes === 3) throw new Error("interrupted"); await real(edge); });
    await expect(importKnowledge(r, draft())).rejects.toThrow("interrupted"); expect(await r.graph.snapshot()).toEqual(before);
  });
});

describe("graph-driven question planning and native reads", () => {
  it("invites her account for a family-only topic and honors topic revocation", async () => {
    const r = await rig(), imported = await importKnowledge(r, draft()), id = imported.topics[0]!.id;
    const policy = structuredClone(r.setup.current()); policy.topics.allow.push(id);
    expect(await planQuestion(r.graph, policy, id, r.clock.iso())).toMatchObject({ purpose: "invite_account", gap: "own_account", evidence_ids: [] });
    policy.topics.block.push(id);
    expect(await planQuestion(r.graph, policy, id, r.clock.iso())).toMatchObject({ purpose: "revisit", gap: null });
  });
  it("runs citation retrieval on Ladybug, refreshes after writes, and agrees with the committed store", async () => {
    const r = await rig(true), params = { topic_id: "event:cape-may-summers", policy_id: r.setup.current().policy_id, audience: "person:susan", allowed_sources: r.setup.current().allowed_source_classes, max_hops: 2, now_iso: r.clock.iso() };
    const expected = await retrieveCandidates(r.graph, params);
    expect(await r.graph.withReadSnapshot((s) => { expect(s).toBeInstanceOf(LadybugGraphStore); return retrieveCandidates(s, params); })).toEqual(expected);
    const imported = await importKnowledge(r, draft());
    expect(await r.graph.withReadSnapshot((s) => s.getNode(imported.topics[0]!.id))).toMatchObject({ label: "a seaside visit" });
  });
  it("reopens a persistent Ladybug graph without recreating tables", async () => {
    const folder = mkdtempSync(join(tmpdir(), "recall-lbug-")); folders.push(folder); const path = join(folder, "graph");
    let graph = await LadybugGraphStore.open(path);
    const node = buildGraph(FAMILY_SEED, new AssetIndex(MANIFEST)).nodes[0]!;
    await graph.putNode(node); await graph.close();
    graph = await LadybugGraphStore.open(path);
    try { expect(await graph.getNode(node.id)).toEqual(node); } finally { await graph.close(); }
  });
  it("validates Muse structured output without giving it graph write access", async () => {
    const body: Extraction = { entities: [{ key: "m", type: "Person", name: "Maya", start: 0, end: 4 }], relations: [] };
    const fetcher: MuseFetch = async (_url, init) => { expect(JSON.parse(init.body as string).response_format.json_schema.name).toBe("graph_episode"); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(body) } }] }), text: async () => "" }; };
    expect(await new MuseGraphExtractor(new MuseSpark("test", fetcher)).extract({ claim_id: "claim:test", source_id: "artifact:test", author: "person:susan", text: "Maya", known: [] })).toEqual(body);
  });
});
