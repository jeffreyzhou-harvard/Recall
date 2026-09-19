/** AGENTS.md section 12.5: provenance. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FAMILY_SEED, MANIFEST } from "@/fixtures";
import { runFixture, runJudgedPath } from "@/fixtures/harness";
import { buildGraph, mergeSeeds, SeedValidationError, type SeedFile } from "@/lib/graph/seed";
import { AssetIndex, AssetResolutionError } from "@/lib/provenance/assets";
import { canonicalJson, contentHash, sha256Bytes } from "@/lib/provenance/hash";
import { verifySealed } from "@/lib/provenance/prov-log";
import { THESIS_LINE } from "@/lib/provenance/receipt";
import { CONFLICTING_CLAIMS, CONFLICT_MANIFEST, NEGATIVE_CONTROLS, unclearAssentCall } from "./fixtures";

const ROOT = join(import.meta.dirname, "..");
const assets = new AssetIndex(MANIFEST);

describe("asset manifest", () => {
  it("matches the bytes on disk, hash for hash", async () => {
    expect(MANIFEST.assets.length).toBeGreaterThan(0);
    for (const asset of MANIFEST.assets) {
      const path = join(ROOT, asset.path);
      expect(existsSync(path), `${asset.path} is missing`).toBe(true);
      const bytes = readFileSync(path);
      expect(createHash("sha256").update(bytes).digest("hex"), asset.id).toBe(asset.sha256);
      expect(await sha256Bytes(new Uint8Array(bytes)), `${asset.id} (WebCrypto)`).toBe(asset.sha256);
      expect(bytes.byteLength).toBe(asset.bytes);
    }
  });

  it("refuses a span that runs outside the recording", () => {
    expect(() => assets.resolveSpan("clip-cardamom", { start_ms: 5000, end_ms: 9000 })).toThrow(AssetResolutionError);
    expect(() => assets.resolveSpan("no-such-asset", null)).toThrow(AssetResolutionError);
  });
});

describe("citations", () => {
  it("every one resolves to a real span or hash - in the family seed, in what intake writes, and in the audit layer", async () => {
    const run = await runJudgedPath();
    const data = await run.graph.snapshot();
    expect(data.nodes.length).toBeGreaterThan(15);
    for (const item of [...data.nodes, ...data.edges]) {
      const prov = item.prov;
      for (const field of ["source_id", "observed_at", "author", "extraction_method"] as const) expect(prov[field], `${item.id}.${field}`).toBeTruthy();
      if (prov.asset_id !== null) expect(prov.media_hash, `${item.id} has an asset but no hash`).toBe(assets.resolveSpan(prov.asset_id, prov.span).sha256);
      else expect(prov.span, `${item.id} has a span but no asset`).toBeNull();
    }
  });

  it("the family seed is compact: a couple of dozen hand-curated facts, not an ontology", () => {
    const data = buildGraph(FAMILY_SEED, assets);
    expect(data.edges.length).toBeGreaterThanOrEqual(20);
    expect(data.edges.length).toBeLessThanOrEqual(30);
  });

  it("test overlays validate too", () => {
    expect(() => buildGraph(mergeSeeds(FAMILY_SEED, NEGATIVE_CONTROLS), assets)).not.toThrow();
    expect(() => buildGraph(mergeSeeds(FAMILY_SEED, CONFLICTING_CLAIMS), new AssetIndex(CONFLICT_MANIFEST))).not.toThrow();
  });
});

describe("seed validation", () => {
  const withNode = (node: SeedFile["nodes"][number]): SeedFile => mergeSeeds(FAMILY_SEED, { version: 1, description: "test", sources: {}, nodes: [node], edges: [] });

  it("refuses to store clinical or state language as fact", () => {
    const bad = withNode({ id: "claim:x", type: "EpisodicClaim", label: "x", props: { text: "her cognition is declining" }, source: "artifact:setup-record" });
    expect(() => buildGraph(bad, assets)).toThrow(/clinical or state language/);
  });

  it("refuses a clinical field name even with an innocent value", () => {
    const bad = withNode({ id: "person:x", type: "Person", label: "x", props: { display_name: "X", role: "asker", mood: "fine" }, source: "artifact:setup-record" });
    expect(() => buildGraph(bad, assets)).toThrow(SeedValidationError);
  });

  it("refuses an edge the schema does not allow, and a fact with no declared source", () => {
    const seed = structuredClone(FAMILY_SEED);
    seed.edges.push({ type: "DEPICTS", from: "person:mom", to: "topic:kheer", source: "artifact:setup-record" });
    expect(() => buildGraph(seed, assets)).toThrow(/may not connect Person -> Topic/);
    const unsourced = withNode({ id: "claim:y", type: "EpisodicClaim", label: "y", props: { text: "y" }, source: "artifact:nowhere" });
    expect(() => buildGraph(unsourced, assets)).toThrow(/undeclared source/);
  });
});

describe("content hashing", () => {
  it("is independent of key order and sensitive to every value", async () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    expect(await contentHash({ a: 1, b: 2 })).toBe(await contentHash({ b: 2, a: 1 }));
    expect(await contentHash({ a: 1, b: 2 })).not.toBe(await contentHash({ a: 1, b: 3 }));
    expect(() => canonicalJson({ a: undefined })).toThrow();
  });
});

describe("provenance receipt", () => {
  it("lists source, trims, assent, timestamp, hash, and destination", async () => {
    const run = await runJudgedPath();
    const receipt = run.recording.provenance_receipt!;

    expect(receipt.waveform.asset_id).toBe("call-golden");
    expect(receipt.waveform.sha256).toBe(assets.get("call-golden").sha256);
    expect(receipt.literal_transcript).toBe("Make the kheer. Your grandfather always added cardamom last.");
    expect(receipt.edits).toEqual({ silence_trims: 3, disfluency_trims: 0, generated_first_person_words: 0 });
    expect(receipt.assent.recorded_at).toMatch(/^2026-11-05T/);
    expect(receipt.assent.audio_span).toEqual({ start_ms: 36200, end_ms: 36700 });
    expect(receipt.assent.assent_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.content_hash).toBe(run.ctx.session.contribution!.content_hash);
    expect(receipt.delivered_to).toEqual(["artifact:thread-family"]);
    expect(receipt.source_links).toContain("artifact:clip-cardamom");
    expect(receipt.final_line).toBe(THESIS_LINE);
    expect(receipt.final_line).toBe("Access changed. Authorship didn't.");
  });

  it("does not exist for a contribution that never sent", async () => {
    expect((await runFixture({ transcript: unclearAssentCall() })).recording.provenance_receipt).toBeNull();
  });

  it("writes the audit layer: contribution approved_by assent, delivered_to the original thread", async () => {
    const run = await runJudgedPath();
    const { edges } = await run.graph.snapshot();
    const audit = edges.filter((e) => e.prov.source_class === "session_audit").map((e) => e.type).sort();
    expect(audit).toEqual(["APPROVED_BY", "DELIVERED_TO", "DERIVED_FROM", "INCLUDED_SPAN", "SPOKEN_BY", "SPOKEN_BY"]);
    expect(edges.find((e) => e.type === "DELIVERED_TO")!.to).toBe("artifact:thread-family");
  });
});

describe("PROV-style event log", () => {
  it("is hash-chained, and any edit to history breaks the chain", async () => {
    const sealed = (await runJudgedPath()).recording.prov;
    expect(sealed.records.length).toBeGreaterThan(20);
    expect(await verifySealed(sealed)).toBe(true);

    const tampered = structuredClone(sealed);
    const entity = tampered.records.find((r) => r.kind === "entity" && r.type === "relay:Contribution")!;
    (entity as { attrs: Record<string, unknown> }).attrs.generated_first_person_words = 4;
    expect(await verifySealed(tampered)).toBe(false);

    const dropped = { ...sealed, records: sealed.records.slice(0, -1) };
    expect(await verifySealed(dropped)).toBe(false);
  });

  it("attributes the contribution to her and derives it from the call recording", async () => {
    const { records } = (await runJudgedPath()).recording.prov;
    const rel = (relation: string, from: string) => records.filter((r) => r.kind === "relation" && r.relation === relation && r.from === from).map((r) => (r as { to: string }).to);
    expect(rel("wasAttributedTo", "contribution:session:fwd-diwali-dessert")).toEqual(["person:mom"]);
    expect(rel("wasDerivedFrom", "contribution:session:fwd-diwali-dessert")).toEqual(["asset:call-golden"]);
    expect(rel("wasDerivedFrom", "delivery:session:fwd-diwali-dessert")).toEqual(["contribution:session:fwd-diwali-dessert"]);
  });
});
