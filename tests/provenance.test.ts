/** AGENTS.md section 12.5: provenance. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FAMILY_SEED, MANIFEST } from "@/fixtures";
import { runJudgedPath } from "@/fixtures/harness";
import { buildGraph } from "@/lib/graph/seed";
import { AssetIndex, AssetResolutionError } from "@/lib/provenance/assets";
import { canonicalJson, contentHash, sha256Bytes } from "@/lib/provenance/hash";
import { verifySealed } from "@/lib/provenance/prov-log";
import { THESIS_LINE } from "@/lib/provenance/receipt";

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
    expect(() => assets.resolveSpan("clip-onboarding", { start_ms: 12000, end_ms: 19000 })).toThrow(AssetResolutionError);
    expect(() => assets.resolveSpan("no-such-asset", null)).toThrow(AssetResolutionError);
  });
});

describe("citations", () => {
  it("every one resolves to a real span or hash - in the family seed, and in everything a call writes", async () => {
    const run = await runJudgedPath();
    const data = await run.graph.snapshot();
    expect(data.nodes.length).toBeGreaterThan(buildGraph(FAMILY_SEED, assets).nodes.length);
    for (const x of [...data.nodes, ...data.edges]) {
      expect(await run.graph.getNode(x.prov.source_id), `${x.id} cites ${x.prov.source_id}`).not.toBeNull();
      if (x.prov.asset_id === null) continue;
      expect(assets.resolveSpan(x.prov.asset_id, x.prov.span).sha256, x.id).toBe(x.prov.media_hash);
    }
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
  it("lists source, trims, store-confirmation, share-confirmation, timestamp, and hash", async () => {
    const run = await runJudgedPath();
    const p = run.recording.provenance_receipt!;
    expect(p.waveform).toEqual({ asset_id: "call-golden", sha256: assets.get("call-golden").sha256, kept: run.ctx.session.contribution!.kept });
    expect(p.literal_transcript).toBe("We went to Cape May every summer.");
    expect(p.edits).toEqual({ silence_trims: 2, disfluency_trims: 0, generated_first_person_words: 0 });
    expect(p.her_words_pct).toBe(100);
    expect(p.store_confirmation).toMatchObject({ audio_sha256: assets.get("call-golden").sha256, audio_span: { start_ms: 49000, end_ms: 49500 } });
    expect(p.share_confirmation.decision).toBe("yes");
    expect(p.content_hash).toBe(run.ctx.session.contribution!.content_hash);
    expect(p.stored_at >= p.share_confirmation.recorded_at).toBe(true); // commit came last
    expect(p.rungs_used).toBe(3);
    expect(p.retrieval_updates).toEqual([{ topic_label: "Cape May summers", cue_id: "person:maya", rung: 3, effective: true }]);
    expect(p.prov_head).toBe(run.recording.prov.head);
    expect(p.final_line).toBe(THESIS_LINE);
    expect(THESIS_LINE).toBe("Cues, not answers - every memory stays in her own words.");
  });

  it("does not exist for a contribution she did not confirm", async () => {
    const { run, OPENING, SAID, HER_LINE } = await import("./helpers");
    const r = await run([...OPENING, ["her", "Oh, the little house by the water!"], ["playback"], ["recall", SAID.storeQuestion], ["her", "No."], ["recall", SAID.closeNotStored]]);
    expect(r.recording.provenance_receipt).toBeNull();
    expect(HER_LINE).toBeTruthy();
  });

  it("writes the audit layer: the claim derived from the contribution, spoken by her, share-confirmed, about the topic", async () => {
    const run = await runJudgedPath();
    const edges = (await run.graph.snapshot()).edges.filter((e) => e.from === "contribution:session:judged" || e.from === "claim:session:judged").map((e) => e.id).sort();
    expect(edges).toEqual([
      "ABOUT:claim:session:judged->event:cape-may-summers",
      "ABOUT:claim:session:judged->place:cape-may",
      "DERIVED_FROM:claim:session:judged->contribution:session:judged",
      "DERIVED_FROM:contribution:session:judged->artifact:call:session:judged",
      "DERIVED_FROM:contribution:session:judged->session:judged",
      "INCLUDED_SPAN:contribution:session:judged->artifact:call:session:judged",
      "SHARE_CONFIRMED_BY:contribution:session:judged->share-confirmation:session:judged",
      "SPOKEN_BY:claim:session:judged->person:susan",
      "SPOKEN_BY:contribution:session:judged->person:susan",
    ]);
    // What she said on this call can be spoken back to her on the next one: it verifies like any other claim of hers.
    expect((await run.graph.getNode("claim:session:judged"))!.prov).toMatchObject({ status: "participant_confirmed", patient_confirmed: true, author: "person:susan" });
    expect((await run.graph.nodesOfType("TopicOutcome")).find((o) => o.id === "outcome:session:judged")!.props).toMatchObject({ topic_id: "event:cape-may-summers", first_rung_reached_unaided: 3, highest_rung_used: 3 });
  });
});

describe("PROV-style event log", () => {
  it("is hash-chained, and any edit to history breaks the chain", async () => {
    const sealed = (await runJudgedPath()).recording.prov;
    expect(sealed.records.length).toBeGreaterThan(20);
    expect(await verifySealed(sealed)).toBe(true);

    const tampered = structuredClone(sealed);
    const entity = tampered.records.find((r) => r.kind === "entity" && r.type === "recall:Contribution")!;
    (entity as { attrs: Record<string, unknown> }).attrs.generated_first_person_words = 4;
    expect(await verifySealed(tampered)).toBe(false);

    const dropped = { ...sealed, records: sealed.records.slice(0, -1) };
    expect(await verifySealed(dropped)).toBe(false);
  });

  it("attributes the contribution to her and derives it from the call recording", async () => {
    const { records } = (await runJudgedPath()).recording.prov;
    const rel = (relation: string, from: string) => records.filter((r) => r.kind === "relation" && r.relation === relation && r.from === from).map((r) => (r as { to: string }).to);
    expect(rel("wasAttributedTo", "contribution:session:judged")).toEqual(["person:susan"]);
    expect(rel("wasDerivedFrom", "contribution:session:judged")).toEqual(["asset:call-golden"]);
    expect(rel("wasDerivedFrom", "claim:session:judged")).toEqual(["contribution:session:judged"]);
    expect(rel("wasAttributedTo", "share-confirmation:session:judged")).toEqual(["person:susan"]);
  });
});
