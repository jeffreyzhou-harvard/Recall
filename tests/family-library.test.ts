import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFixtureRig } from "@/fixtures/harness";
import { loadInto } from "@/lib/graph/store";
import { edgeId } from "@/lib/graph/seed";
import { SqliteGraphStore } from "@/server/graph-store";
import { MediaStore } from "@/server/media";
import { mutateFamilyLibrary, readFamilyLibrary, type LibraryLive } from "@/server/family-library";
import { reviewKnowledge } from "@/server/knowledge-review";
import { GET, POST } from "@/app/api/family/library/route";
import { getLiveRecall } from "@/server/recall-live";
import { get_next_recall_topic } from "@/lib/tools/impl/scheduling";
import { bench } from "./helpers";

vi.mock("@/server/recall-live", async (original) => ({ ...await original<typeof import("@/server/recall-live")>(), getLiveRecall: vi.fn() }));
const cleanup: Array<() => void> = [];
afterEach(() => { for (const fn of cleanup.splice(0)) fn(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
async function liveLibrary(): Promise<LibraryLive & { graph: SqliteGraphStore; media: MediaStore }> {
  const rig = await buildFixtureRig();
  const root = mkdtempSync(join(tmpdir(), "recall-library-")), graph = new SqliteGraphStore(join(root, "graph.db"), "library-test");
  await loadInto(graph, await rig.graph.snapshot());
  const media = new MediaStore(root, "library-test", rig.assets, graph);
  cleanup.push(() => { media.close(); graph.close(); rmSync(root, { recursive: true, force: true }); });
  const policy = rig.setup.current(); policy.approved_people.push("person:priya");
  policy.dashboard.grants.push({ member_id: "person:priya", detail_level: "weekly_note", granted_at: "2026-09-19T12:00:00.000Z", revoked_at: null });
  rig.setup.replace(policy);
  return { graph, media, assets: rig.assets, setup: rig.setup, refreshSetup: async () => {} };
}
const draft = (patch: Record<string, unknown> = {}) => ({ member: "person:maya", action: "create", request_id: randomUUID(), title: "Summer picnic", people: ["Maya"], place: "Cape May", date: "1984-07-20", latitude: null, longitude: null, asset_ids: [] as string[], text: "I brought the picnic basket to Cape May.", ...patch });
async function photo(live: Awaited<ReturnType<typeof liveLibrary>>, owner = "person:maya", audio = false) {
  const asset = live.media.make(Buffer.from(`a private contribution ${randomUUID()}`), owner, audio ? "audio/wav" : "image/png", audio ? 1000 : null);
  await live.media.save(asset); return asset.entry.id;
}

describe("contributor-owned library (§2 rules 8, 10, 12–14)", () => {
  it("creates one moment with several permanent photos and one literal story through existing contribution paths", async () => {
    const live = await liveLibrary(), assetIds = [await photo(live), await photo(live)];
    const input = draft({ asset_ids: assetIds, latitude: 38.9351, longitude: -74.906 });
    const saved = await mutateFamilyLibrary(live, input);
    const view = await readFamilyLibrary(live, "person:maya"), moment = view.moments.find((m) => m.id === saved.moment_id)!;
    expect(moment).toMatchObject({ title: input.title, place: "Cape May", photoIds: assetIds, startAt: "1984-07-20", people: ["Maya"], latitude: 38.9351, revision: 1 });
    expect(view.stories.filter((s) => s.eventId === moment.id)).toEqual([expect.objectContaining({ text: input.text, author: "Maya", source: "written" })]);
    expect(view.photos.filter((p) => assetIds.includes(p.id))).toHaveLength(2);
    expect(assetIds.every((id) => live.media.isPermanent(id))).toBe(true);
    const accounts = (await live.graph.nodesOfType("EpisodicClaim")).filter((n) => n.props.text === input.text);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.prov).toMatchObject({ author: "person:maya", source_class: "family_contribution", patient_confirmed: false });
    expect((await live.graph.edgesOf(accounts[0]!.id)).filter((edge) => edge.type === "EVIDENCE_FOR" && edge.to === accounts[0]!.id)).toHaveLength(2);
    expect((await live.graph.getNode(saved.moment_id))?.type).toBe("Event");
    const policy = live.setup.current(); policy.topics.allow.push(saved.moment_id); live.setup.replace(policy);
    const rig = await bench();
    const ranked = await get_next_recall_topic({ person_id: policy.person_id, schedule_context: { now: rig.clock.iso() } }, { ...rig.ctx, graph: live.graph, setup: live.setup });
    expect(ranked.ranked.find((topic) => topic.topic_id === saved.moment_id)?.times_told).toBe(1);
  });

  it("never revives a blocked ABOUT topic under the original claim id or through its attached stories", async () => {
    const live = await liveLibrary(), originalId = "claim:wedding-in-new-jersey";
    const before = await readFamilyLibrary(live, "person:maya"), original = before.stories.find((story) => story.id === originalId)!;
    expect(original).toBeDefined();
    const asset = await photo(live);
    await mutateFamilyLibrary(live, { member: "person:maya", action: "story", request_id: randomUUID(), moment_id: original.eventId, text: "I packed the little picnic basket.", asset_id: asset });
    live.setup.revokeTopic("event:mayas-wedding");
    const hidden = await readFamilyLibrary(live, "person:maya"), serialized = JSON.stringify(hidden);
    expect(hidden.stories.some((story) => story.id === originalId || story.eventId === original.eventId)).toBe(false);
    expect(hidden.moments.some((moment) => moment.id === original.eventId)).toBe(false);
    expect(hidden.photos.some((item) => item.id === asset)).toBe(false);
    expect(serialized).not.toContain(original.text);
    expect(serialized).not.toContain("I packed the little picnic basket.");
    await expect(mutateFamilyLibrary(live, { member: "person:maya", action: "story", request_id: randomUUID(), moment_id: original.eventId, text: "Another account." })).rejects.toThrow("not available");
  });

  it("excludes an account when an explicit linked topic name contains a newly blocked term", async () => {
    const live = await liveLibrary(), asset = await photo(live), saved = await mutateFamilyLibrary(live, draft({ asset_ids: [asset] }));
    const claim = await live.graph.getNode(`claim:${saved.moment_id}`); if (!claim) throw new Error("missing claim");
    await live.graph.putNode({ id: "place:hidden-harbor", type: "Place", label: "Hidden Harbor", props: { aliases: [] }, prov: claim.prov });
    await live.graph.putEdge({ id: edgeId("ABOUT", claim.id, "place:hidden-harbor"), type: "ABOUT", from: claim.id, to: "place:hidden-harbor", props: {}, prov: claim.prov });
    const policy = live.setup.current(); policy.blocked_terms = ["Hidden Harbor"]; live.setup.replace(policy);
    const view = await readFamilyLibrary(live, "person:maya");
    expect(view.moments.some((moment) => moment.id === saved.moment_id)).toBe(false);
    expect(view.stories.some((story) => story.eventId === saved.moment_id)).toBe(false);
    expect(view.photos.some((item) => item.id === asset)).toBe(false);
  });

  it.each(["title", "people", "place", "description"] as const)("removes stories and photos along with blocked %s metadata", async (field) => {
    const live = await liveLibrary(), asset = await photo(live), saved = await mutateFamilyLibrary(live, draft({ asset_ids: [asset] }));
    const { asset_ids: _assets, text: _text, ...metadata } = draft();
    await mutateFamilyLibrary(live, { ...metadata, action: "edit", moment_id: saved.moment_id, [field]: field === "people" ? ["Hidden name"] : "Hidden name" });
    const policy = live.setup.current(); policy.blocked_terms = ["Hidden name"]; live.setup.replace(policy);
    const view = await readFamilyLibrary(live, "person:maya");
    expect(view.moments.some((moment) => moment.id === saved.moment_id)).toBe(false);
    expect(view.stories.some((story) => story.eventId === saved.moment_id)).toBe(false);
    expect(view.photos.some((item) => item.id === asset)).toBe(false);
    expect(JSON.stringify(view)).not.toContain("Hidden name");
  });

  it("imports a named place only when present in the original account and keeps collection edits separate", async () => {
    const live = await liveLibrary(), input = draft(), saved = await mutateFamilyLibrary(live, input);
    const originalTopic = await live.graph.getNode(saved.moment_id);
    const claimId = `claim:${saved.moment_id}`, links = (await live.graph.edgesOf(claimId)).filter((edge) => edge.type === "ABOUT" && edge.from === claimId);
    const places = await Promise.all(links.map((edge) => live.graph.getNode(edge.to)));
    expect(places.find((node) => node?.type === "Place" && node.label === input.place)?.prov).toMatchObject({ source_class: "family_contribution", author: "person:maya", patient_confirmed: false });
    const { asset_ids: _assets, text: _text, ...metadata } = draft({ title: "Collection title", place: "Princeton" });
    await mutateFamilyLibrary(live, { ...metadata, action: "edit", moment_id: saved.moment_id });
    expect(await live.graph.getNode(saved.moment_id)).toEqual(originalTopic);
    expect((await live.graph.edgesOf(claimId)).filter((edge) => edge.type === "ABOUT" && edge.from === claimId)).toEqual(links);
    const other = await mutateFamilyLibrary(live, draft({ place: "Unmentioned town", text: "I packed a basket." }));
    const otherLinks = (await live.graph.edgesOf(`claim:${other.moment_id}`)).filter((edge) => edge.type === "ABOUT");
    expect(await Promise.all(otherLinks.map(async (edge) => (await live.graph.getNode(edge.to))?.type))).not.toContain("Place");
  });

  it("projects existing own accounts without patient words, another contributor's account, or unreviewed labels", async () => {
    const live = await liveLibrary();
    await mutateFamilyLibrary(live, draft({ member: "person:priya", title: "Private picnic", text: "Priya's private account marker." }));
    const own = await mutateFamilyLibrary(live, draft());
    const claim = await live.graph.getNode(`claim:${own.moment_id}`); if (!claim) throw new Error("missing claim");
    const prov = { ...claim.prov, status: "inferred" as const };
    await live.graph.putNode({ id: "entity:library-secret-place", type: "Place", label: "Unreviewed hidden place", props: { aliases: [] }, prov });
    await live.graph.putEdge({ id: edgeId("ABOUT", claim.id, "entity:library-secret-place"), type: "ABOUT", from: claim.id, to: "entity:library-secret-place", props: {}, prov });
    let view = await readFamilyLibrary(live, "person:maya"), serialized = JSON.stringify(view);
    expect(view.stories.some((s) => s.id === "claim:maya-remembers-cape-may")).toBe(true);
    expect(serialized).not.toContain("Priya's private account marker");
    expect(serialized).not.toContain("Unreviewed hidden place");
    for (const patient of (await live.graph.nodesOfType("EpisodicClaim")).filter((n) => n.prov.patient_confirmed)) expect(view.stories.map((s) => s.id)).not.toContain(patient.id);
    await reviewKnowledge(live.graph, () => live.setup.current(), "person:maya", ["entity:library-secret-place"]);
    // The reviewed ABOUT edge is now eligible, while human-edited metadata still takes priority.
    const reviewed = await live.graph.getEdge(`reviewed:${edgeId("ABOUT", claim.id, "entity:library-secret-place")}`);
    expect(reviewed?.prov.status).toBe("family_confirmed");
    view = await readFamilyLibrary(live, "person:priya");
    expect(view.stories.some((s) => s.text === "Priya's private account marker.")).toBe(true);
    expect(view.stories.some((s) => s.text === draft().text)).toBe(false);
  });

  it("rejects cross-member edits, stories, uploaded media, and idempotency handles", async () => {
    const live = await liveLibrary(), original = draft(), saved = await mutateFamilyLibrary(live, original);
    const id = await photo(live, "person:priya");
    await expect(mutateFamilyLibrary(live, draft({ asset_ids: [id] }))).rejects.toThrow("your account");
    await expect(mutateFamilyLibrary(live, { ...draft({ member: "person:priya" }), action: "story", moment_id: saved.moment_id, asset_ids: undefined })).rejects.toThrow();
    await expect(mutateFamilyLibrary(live, { member: "person:priya", action: "story", request_id: randomUUID(), moment_id: saved.moment_id, text: "Another account." })).rejects.toThrow("not available");
    const { asset_ids: _assets, text: _text, ...edit } = draft({ member: "person:priya" });
    await expect(mutateFamilyLibrary(live, { ...edit, action: "edit", moment_id: saved.moment_id })).rejects.toThrow("not available");
    await expect(mutateFamilyLibrary(live, { ...original, member: "person:priya" })).rejects.toThrow("unavailable");
    expect(live.media.isPermanent(id)).toBe(false);
  });

  it("appends metadata revisions and stories without changing original evidence, and rejects stale edits", async () => {
    const live = await liveLibrary(), input = draft(), saved = await mutateFamilyLibrary(live, input);
    const original = await live.graph.getNode(`claim:${saved.moment_id}`);
    const { asset_ids: _assets, text: _text, ...fields } = draft();
    const edit = { ...fields, action: "edit", moment_id: saved.moment_id, title: "Picnic by the shore", description: "My notes from that summer.", expected_revision: 1 };
    expect(await mutateFamilyLibrary(live, edit)).toMatchObject({ revision: 2 });
    expect(await live.graph.getNode(`claim:${saved.moment_id}`)).toEqual(original);
    await expect(mutateFamilyLibrary(live, { ...edit, request_id: randomUUID() })).rejects.toThrow("changed");
    const audio = await photo(live, "person:maya", true);
    await mutateFamilyLibrary(live, { member: "person:maya", action: "story", request_id: randomUUID(), moment_id: saved.moment_id, text: "I remember packing the red blanket.", asset_id: audio });
    const view = await readFamilyLibrary(live, "person:maya");
    expect(view.moments.find((m) => m.id === saved.moment_id)).toMatchObject({ title: edit.title, description: edit.description, revision: 2 });
    expect(view.stories.filter((s) => s.eventId === saved.moment_id)).toHaveLength(2);
    expect(view.stories.find((s) => s.source === "voice")?.audioUrl).toContain(encodeURIComponent(audio));
    expect(live.media.isPermanent(audio)).toBe(true);
  });

  it("can edit a pre-existing contribution with revision zero", async () => {
    const live = await liveLibrary(), before = await readFamilyLibrary(live, "person:maya"), old = before.moments[0]!;
    expect(old.revision).toBe(0);
    const { asset_ids: _assets, text: _text, ...fields } = draft();
    await mutateFamilyLibrary(live, { ...fields, action: "edit", moment_id: old.id, expected_revision: 0 });
    expect((await readFamilyLibrary(live, "person:maya")).moments.find((m) => m.id === old.id)?.revision).toBe(1);
  });

  it("retries requests exactly once, including concurrent submissions, and refuses changed contents", async () => {
    const live = await liveLibrary(), input = draft();
    const responses = await Promise.all([mutateFamilyLibrary(live, input), mutateFamilyLibrary(live, input)]);
    expect(responses[0]).toEqual(responses[1]);
    expect((await live.graph.nodesOfType("EpisodicClaim")).filter((c) => c.props.text === input.text)).toHaveLength(1);
    await expect(mutateFamilyLibrary(live, { ...input, text: "Different words." })).rejects.toThrow("different contents");
  });

  it("rejects questions, blocked topics, duplicate photos, and coordinates without a named place before writes", async () => {
    const live = await liveLibrary(), asset = await photo(live), policy = live.setup.current();
    policy.blocked_terms = ["secret address"]; live.setup.replace(policy);
    const before = await live.graph.snapshot();
    for (const patch of [{ text: "What did Susan say?" }, { title: "What did Susan say" }, { text: "A secret address." }, { asset_ids: [asset, asset] }, { place: "", latitude: 5, longitude: 10 }, { latitude: 5 }, { latitude: 100, longitude: 10 }, { asset_ids: Array(21).fill(asset) }]) await expect(mutateFamilyLibrary(live, draft(patch))).rejects.toThrow();
    expect(await live.graph.snapshot()).toEqual(before);
    expect(live.media.isPermanent(asset)).toBe(false);
  });

  it("commits media and evidence together and rolls both back if the audit write fails", async () => {
    const live = await liveLibrary(), assets = [await photo(live), await photo(live)], before = await live.graph.snapshot();
    const put = live.graph.putNode.bind(live.graph);
    live.graph.putNode = async (node) => { if (node.id.startsWith("artifact:family-library:")) throw new Error("write interrupted"); await put(node); };
    await expect(mutateFamilyLibrary(live, draft({ asset_ids: assets }))).rejects.toThrow("write interrupted");
    expect(await live.graph.snapshot()).toEqual(before);
    expect(assets.every((id) => !live.media.isPermanent(id))).toBe(true);
  });

  it("enforces refreshed dashboard access and records the refused load", async () => {
    const live = await liveLibrary();
    live.refreshSetup = async () => live.setup.revokeDashboardAccess("person:maya", "2026-09-19T14:00:00.000Z");
    await expect(readFamilyLibrary(live, "person:maya")).rejects.toThrow("not available");
    await expect(mutateFamilyLibrary(live, draft())).rejects.toThrow("not available");
    expect((await live.graph.nodesOfType("DashboardAccessGrant")).some((n) => n.props.surface === "contribution_library" && n.props.action === "refused")).toBe(true);
  });

  it("refuses a mismatched member credential before opening the live graph", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("RECALL_OPERATOR_SECRET", "operator-key"); vi.stubEnv("RECALL_FAMILY_SECRET", "");
    vi.stubEnv("RECALL_FAMILY_CREDENTIALS", JSON.stringify({ "person:maya": "maya-key", "person:priya": "priya-key" }));
    const headers = { "x-recall-family": "priya-key", "content-type": "application/json" };
    expect((await GET(new Request("http://recall.test/api/family/library?member=person:maya", { headers }))).status).toBe(403);
    expect((await POST(new Request("http://recall.test/api/family/library", { method: "POST", headers, body: JSON.stringify(draft()) }))).status).toBe(403);
    expect(getLiveRecall).not.toHaveBeenCalled();
  });
});
