/** Contributor-owned projection and append-only edits. AGENTS.md §2 rules 8, 10, 12–14. */
import { z } from "zod";
import type { FamilyLibrary, Moment } from "@/lib/archive/types";
import { FamilyView } from "@/lib/family/projection";
import type { GraphStore } from "@/lib/graph/store";
import type { ArtifactNode, EpisodicClaimNode, GraphEdge, GraphNode, Provenance } from "@/lib/graph/types";
import { edgeId } from "@/lib/graph/seed";
import { contentHash } from "@/lib/provenance/hash";
import { SystemClock } from "@/lib/clock";
import { dashboardAccess, type AccessPolicy } from "@/lib/tools/policy";
import { opensAsAQuestion, receive_family_contribution } from "@/lib/tools/impl/family";
import { lintConduct, lintLines } from "@/lib/script/lint";
import { CALL_SCRIPT, FAMILY_COPY, RECORD_THRESHOLDS, SAFETY_THRESHOLDS } from "@/fixtures";
import type { LiveRecall } from "./recall-live";
import { importKnowledge } from "./knowledge-import";

export type LibraryLive = Pick<LiveRecall, "graph" | "setup" | "media" | "assets" | "refreshSetup">;
export class LibraryError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = "LibraryError"; }
}
const shortText = z.string().trim().max(80);
const metadataSchema = z.strictObject({
  title: shortText.min(1), people: z.array(shortText.min(1)).max(20), place: shortText.nullable(),
  date: z.iso.date().nullable(), latitude: z.number().min(-90).max(90).nullable(), longitude: z.number().min(-180).max(180).nullable(),
  description: z.string().max(2000).optional(), cover_id: z.string().max(160).nullable().optional(),
});
const identity = { member: z.string().min(1).max(160), request_id: z.string().uuid() };
export const libraryMutationSchema = z.discriminatedUnion("action", [
  metadataSchema.extend({ ...identity, action: z.literal("create"), asset_ids: z.array(z.string().min(1).max(160)).max(20), text: z.string().min(1).max(2000) }),
  metadataSchema.extend({ ...identity, action: z.literal("edit"), moment_id: z.string().min(1).max(240), expected_revision: z.number().int().nonnegative().optional(), coverId: z.string().max(160).nullable().optional() }),
  z.strictObject({ ...identity, action: z.literal("story"), moment_id: z.string().min(1).max(240), text: z.string().min(1).max(2000), asset_id: z.string().min(1).max(160).optional() }),
]);
type Metadata = z.infer<typeof metadataSchema>;
const recordSchema = z.strictObject({
  kind: z.literal("family_library_v1"), request_hash: z.string(), action: z.enum(["create", "edit", "story"]),
  moment_id: z.string(), claim_ids: z.array(z.string()), primary_claim_id: z.string().nullable(),
  revision: z.number().int().nonnegative(), metadata: metadataSchema.nullable(), photo_order: z.array(z.string()).optional(),
});
type LibraryRecord = z.infer<typeof recordSchema>;
const prefix = "artifact:family-library:";
const owned = (prov: Provenance, member: string, person: string) => prov.author === member && prov.source_class === "family_contribution" && prov.status === "family_confirmed" && !prov.patient_confirmed && prov.audience_scope.includes(person);
const mediaUrl = (member: string, asset: string) => `/api/family/media?member=${encodeURIComponent(member)}&asset=${encodeURIComponent(asset)}`;

function requireAccess(policy: AccessPolicy, member: string) {
  if (member === policy.person_id || !policy.approved_people.includes(member) || dashboardAccess(policy, member) === null) throw new LibraryError("Your contribution library is not available to this account.", 403);
}
function blocked(policy: AccessPolicy, text: string) { return policy.blocked_terms.some((term) => text.toLowerCase().includes(term.toLowerCase())); }
function validateMetadata(meta: Metadata, policy: AccessPolicy) {
  if ((meta.latitude === null) !== (meta.longitude === null) || meta.latitude !== null && !meta.place?.trim()) throw new LibraryError("Choose a named historical place before adding its map pin.");
  const labels = [meta.title, ...meta.people, ...(meta.place ? [meta.place] : [])];
  if (labels.some((text) => /[?!\n\r{}]/.test(text) || opensAsAQuestion(text, FAMILY_COPY.question_openers))) throw new LibraryError("Use short names for the title, people, and place.");
  if (/[.]/.test(meta.title) || meta.title.split(/\s+/).length > 8) throw new LibraryError("Use a short title of up to eight words.");
  if (labels.some((text) => lintLines([{ id: "library", text, surface: "call" }], CALL_SCRIPT.banned).length || lintConduct([{ id: "library", text, surface: "call" }], CALL_SCRIPT.conduct).length)) throw new LibraryError("Choose a title and names that describe the memory.");
  if (blocked(policy, [...labels, meta.description ?? ""].join(" "))) throw new LibraryError("This contribution contains a blocked topic.");
  if (meta.description && opensAsAQuestion(meta.description, FAMILY_COPY.question_openers)) throw new LibraryError("Contribute an account, rather than a question for the patient.");
}
function validateAccount(text: string, policy: AccessPolicy) {
  if (!text.trim()) throw new LibraryError("Add your own account of this memory.");
  if (opensAsAQuestion(text, FAMILY_COPY.question_openers)) throw new LibraryError("Contribute an account, rather than a question for the patient.");
  if (blocked(policy, text)) throw new LibraryError("This contribution contains a blocked topic.");
}
async function records(graph: GraphStore, member: string, person: string): Promise<LibraryRecord[]> {
  const out: LibraryRecord[] = [];
  for (const node of await graph.nodesOfType("Artifact")) {
    if (!node.id.startsWith(prefix) || node.props.kind !== "audit_log" || node.prov.author !== member || node.prov.source_class !== "session_audit" || !node.prov.audience_scope.includes(person)) continue;
    try { const parsed = recordSchema.safeParse(JSON.parse(node.props.text ?? "")); if (parsed.success) out.push(parsed.data); } catch { /* An unrelated audit record cannot become library data. */ }
  }
  return out;
}

/** Reads explicit owned accounts and reviewed labels; never traverses patient text or unreviewed hypotheses. */
async function project(live: LibraryLive, member: string): Promise<FamilyLibrary> {
  const graph = live.graph, policy = live.setup.current(); requireAccess(policy, member);
  const result: FamilyLibrary = { photos: [], moments: [], stories: [] };
  const history = await records(graph, member, policy.person_id);
  const assignments = new Map<string, string>(), hiddenStories = new Set<string>(), latest = new Map<string, LibraryRecord>();
  for (const item of history) {
    for (const id of item.claim_ids) { assignments.set(id, item.moment_id); if (item.primary_claim_id !== id) hiddenStories.add(id); }
    if (item.metadata && (!latest.has(item.moment_id) || latest.get(item.moment_id)!.revision < item.revision)) latest.set(item.moment_id, item);
  }
  const author = await graph.getNode(member), authorName = author?.type === "Person" ? author.props.display_name : "Your account";
  const moments = new Map<string, Moment>(), photos = new Map<string, FamilyLibrary["photos"][number]>();
  const claims = (await graph.nodesOfType("EpisodicClaim")).filter((c) => owned(c.prov, member, policy.person_id)).sort((a, b) => a.prov.observed_at.localeCompare(b.prov.observed_at) || a.id.localeCompare(b.id));
  const hiddenMoments = new Set(policy.topics.block);
  const entries: Array<{ claim: EpisodicClaimNode; artifact: ArtifactNode; edges: GraphEdge[]; links: GraphNode[]; momentId: string }> = [];
  for (const claim of claims) {
    const artifact = await graph.getNode(claim.prov.source_id);
    if (artifact?.type !== "Artifact" || !owned(artifact.prov, member, policy.person_id)) continue;
    const edges = await graph.edgesOf(claim.id), links: GraphNode[] = [];
    // A blocked topic excludes its account, rather than just its label. Otherwise a
    // hidden ABOUT target could fall back to claim.id and reveal the same story.
    let denied = blocked(policy, `${claim.label} ${claim.props.text}`) || policy.topics.block.includes(claim.id);
    for (const edge of edges) {
      if (edge.type !== "ABOUT" || edge.from !== claim.id) continue;
      if (policy.topics.block.includes(edge.to)) denied = true;
      if (!owned(edge.prov, member, policy.person_id)) continue;
      const node = await graph.getNode(edge.to);
      if (!node || !["Event", "Place", "Person"].includes(node.type)) continue;
      if (blocked(policy, `${node.label} ${node.type === "Person" ? node.props.display_name : ""}`)) denied = true;
      const setupPerson = node.type === "Person" && node.prov.source_class === "joint_setup" && (node.id === policy.person_id || policy.approved_people.includes(node.id));
      if (owned(node.prov, member, policy.person_id) || setupPerson) links.push(node);
    }
    const event = links.find((n) => n.type === "Event"), place = links.find((n) => n.type === "Place");
    const topic = event ?? place ?? links.find((n) => n.type === "Person");
    const momentId = assignments.get(claim.id) ?? topic?.id ?? claim.id;
    if (denied) { hiddenMoments.add(momentId); hiddenMoments.add(claim.id); }
    entries.push({ claim, artifact, edges, links, momentId });
  }
  // Decide exclusions before rendering any member of a group: later stories or
  // photos assigned to an older claim must not revive its hidden collection.
  for (const { claim, artifact, edges, links, momentId } of entries) {
    if (hiddenMoments.has(momentId)) continue;
    const event = links.find((n) => n.type === "Event"), place = links.find((n) => n.type === "Place");
    const topic = event ?? place ?? links.find((n) => n.type === "Person");
    let moment = moments.get(momentId);
    if (!moment) {
      moment = { id: momentId, title: topic?.label ?? (claim.label === "Family account" ? "A contributed memory" : claim.label), place: place?.label ?? "", photoIds: [], coverId: "", startAt: event?.type === "Event" ? event.props.date : null, endAt: event?.type === "Event" ? event.props.date : null, latitude: null, longitude: null, people: [], description: "", revision: 0 };
      moments.set(momentId, moment);
    }
    for (const node of links) if (node.type === "Person" && !moment.people.includes(node.props.display_name)) moment.people.push(node.props.display_name);
    const asset = claim.prov.asset_id ? live.media?.get(claim.prov.asset_id) : null;
    const ownAsset = asset?.owner === member && asset.entry.sha256 === claim.prov.media_hash ? asset : null;
    const photoSources = [artifact];
    for (const edge of edges) {
      if (edge.type !== "EVIDENCE_FOR" || edge.to !== claim.id || edge.from === artifact.id || !owned(edge.prov, member, policy.person_id)) continue;
      const evidence = await graph.getNode(edge.from);
      if (evidence?.type === "Artifact" && owned(evidence.prov, member, policy.person_id)) photoSources.push(evidence);
    }
    for (const evidence of photoSources) {
      if (evidence.props.kind !== "photo" || !evidence.prov.asset_id) continue;
      const photo = live.media?.get(evidence.prov.asset_id);
      if (!photo || photo.owner !== member || photo.entry.kind !== "image" || photo.entry.sha256 !== evidence.prov.media_hash) continue;
      const id = photo.entry.id;
      photos.set(id, { id, name: "Contributed photo", url: mediaUrl(member, id), capturedAt: null, contributor: authorName, addedAt: evidence.prov.observed_at });
      if (!moment.photoIds.includes(id)) moment.photoIds.push(id);
      moment.coverId ||= id;
    }
    if (!hiddenStories.has(claim.id)) result.stories.push({ id: claim.id, eventId: momentId, author: authorName, text: claim.props.text, createdAt: claim.prov.observed_at, source: ownAsset?.entry.kind === "audio" ? "voice" : "written", ...(ownAsset?.entry.kind === "audio" ? { audioUrl: mediaUrl(member, ownAsset.entry.id) } : {}) });
  }
  for (const moment of moments.values()) {
    const originalOrder = history.find((entry) => entry.action === "create" && entry.moment_id === moment.id)?.photo_order ?? [];
    moment.photoIds = [...originalOrder.filter((id) => moment.photoIds.includes(id)), ...moment.photoIds.filter((id) => !originalOrder.includes(id))];
    moment.coverId = moment.photoIds[0] ?? "";
    const edit = latest.get(moment.id);
    if (edit?.metadata) {
      const meta = edit.metadata;
      if (blocked(policy, [meta.title, meta.place ?? "", ...meta.people, meta.description ?? ""].join(" "))) continue;
      moment.title = meta.title; moment.people = [...meta.people]; moment.place = meta.place ?? "";
      moment.startAt = meta.date; moment.endAt = meta.date; moment.latitude = meta.latitude; moment.longitude = meta.longitude;
      moment.description = meta.description ?? ""; moment.revision = edit.revision;
      if (meta.cover_id && moment.photoIds.includes(meta.cover_id)) moment.coverId = meta.cover_id;
      for (const id of moment.photoIds) { const photo = photos.get(id); if (photo) photo.capturedAt = meta.date; }
    }
    result.moments.push(moment);
  }
  const visibleMoments = new Set(result.moments.map((moment) => moment.id));
  const visiblePhotos = new Set(result.moments.flatMap((moment) => moment.photoIds));
  result.photos = [...photos.values()].filter((photo) => visiblePhotos.has(photo.id));
  result.stories = result.stories.filter((story) => visibleMoments.has(story.eventId));
  result.moments.sort((a, b) => (b.startAt ?? "").localeCompare(a.startAt ?? "") || a.title.localeCompare(b.title));
  return result;
}

export async function readFamilyLibrary(live: LibraryLive, member: string): Promise<FamilyLibrary> {
  await live.refreshSetup();
  const read = async () => {
    const policy = live.setup.current(), view = new FamilyView(live.graph, policy.person_id);
    try { requireAccess(policy, member); } catch { await view.logAccess(member, "refused", "contribution_library", new Date().toISOString()); return null; }
    const result = await project(live, member);
    await view.logAccess(member, "viewed", "contribution_library", new Date().toISOString());
    return result;
  };
  const result = await (live.graph.atomic ? live.graph.atomic(read) : read());
  if (!result) throw new LibraryError("Your contribution library is not available to this account.", 403);
  return result;
}

/** Same contribution tool as tellRecallAMemory, inside this operation's atomic commit. */
async function contribute(live: LibraryLive, member: string, momentId: string | null, text: string, assetId?: string) {
  const attachment = assetId ? live.media?.get(assetId) : null;
  if (assetId && (!attachment || attachment.owner !== member || !["image", "audio"].includes(attachment.entry.kind))) throw new LibraryError("Choose media uploaded by your account.");
  const out = await receive_family_contribution({ contributor_id: member, claim: { who: "", what_happened: text, when_where: null, photo_asset_id: attachment?.entry.id ?? null, about_topic_id: momentId }, provenance: { medium: attachment ? attachment.entry.kind === "image" ? "photo" : "voice_note" : "text", received_at: new Date().toISOString() } }, { view: new FamilyView(live.graph, live.setup.current().person_id), assets: live.assets, setup: live.setup, clock: new SystemClock(), script: CALL_SCRIPT, copy: FAMILY_COPY, thresholds: RECORD_THRESHOLDS, safetyThresholds: SAFETY_THRESHOLDS });
  if (out.status !== "stored_as_family_claim") throw new LibraryError("This account could not be contributed.");
  if (attachment) live.media!.keep(attachment.entry.id);
  return `claim:${out.contribution_ref}`;
}

/** Extra photos are evidence of one telling, never duplicate accounts for topic ranking. */
async function attachPhoto(live: LibraryLive, member: string, claimId: string, momentId: string, assetId: string, artifactId: string) {
  const media = live.media?.get(assetId), claim = await live.graph.getNode(claimId), policy = live.setup.current();
  if (!media || media.owner !== member || media.entry.kind !== "image" || claim?.type !== "EpisodicClaim" || !owned(claim.prov, member, policy.person_id)) throw new LibraryError("Choose photos uploaded by your account.");
  const prov: Provenance = { ...claim.prov, source_id: artifactId, asset_id: assetId, media_hash: media.entry.sha256, observed_at: new Date().toISOString() };
  await live.graph.putNode({ id: artifactId, type: "Artifact", label: "Contributed photo", props: { kind: "photo", text: null, alt: null }, prov });
  for (const [type, to] of [["EVIDENCE_FOR", claimId], ["DEPICTS", momentId], ["CONTRIBUTED_BY", member], ["PERMITTED_IN", policy.policy_id]] as const) await live.graph.putEdge({ id: edgeId(type, artifactId, to), type, from: artifactId, to, props: {}, prov });
  live.media!.keep(assetId);
}

export async function mutateFamilyLibrary(live: LibraryLive, raw: unknown): Promise<{ moment_id: string; revision: number }> {
  const parsed = libraryMutationSchema.safeParse(raw);
  if (!parsed.success) throw new LibraryError("Review the memory fields and use up to 20 photos.");
  const input = parsed.data;
  await live.refreshSetup();
  requireAccess(live.setup.current(), input.member);
  const requestHash = await contentHash(input), receiptId = `${prefix}${input.request_id}`;
  const write = async () => {
    const policy = live.setup.current(), policyVersion = JSON.stringify(policy); requireAccess(policy, input.member);
    const prior = await live.graph.getNode(receiptId);
    if (prior) {
      if (prior.type !== "Artifact" || prior.prov.author !== input.member) throw new LibraryError("This request id is unavailable.", 409);
      const receipt = recordSchema.parse(JSON.parse(prior.props.text ?? "{}"));
      if (receipt.request_hash !== requestHash) throw new LibraryError("This request was already saved with different contents.", 409);
      return { moment_id: receipt.moment_id, revision: receipt.revision };
    }
    const meta: Metadata | null = input.action === "story" ? null : { title: input.title, people: [...new Set(input.people)], place: input.place, date: input.date, latitude: input.latitude, longitude: input.longitude, description: input.description, cover_id: input.cover_id !== undefined ? input.cover_id : input.action === "edit" ? input.coverId : undefined };
    if (meta) validateMetadata(meta, policy);
    if (input.action !== "edit") validateAccount(input.text, policy);
    const existing = input.action === "create" ? null : (await project(live, input.member)).moments.find((m) => m.id === input.moment_id);
    if (input.action !== "create" && !existing) throw new LibraryError("This memory is not available to your account.", 404);
    if (meta && existing) { meta.description ??= existing.description; if (meta.cover_id === undefined) meta.cover_id = existing.coverId || null; }
    if (input.action === "edit" && input.expected_revision !== undefined && existing!.revision !== input.expected_revision) throw new LibraryError("This memory changed. Reload it before saving your edit.", 409);
    if (input.action === "edit" && meta?.cover_id && !existing!.photoIds.includes(meta.cover_id)) throw new LibraryError("Choose a cover from this memory's photos.");
    if (input.action === "create") {
      if (new Set(input.asset_ids).size !== input.asset_ids.length) throw new LibraryError("Choose each photo once.");
      for (const id of input.asset_ids) { const media = live.media?.get(id); if (!media || media.owner !== input.member || media.entry.kind !== "image") throw new LibraryError("Choose photos uploaded by your account."); }
      if (meta?.cover_id && !input.asset_ids.includes(meta.cover_id)) throw new LibraryError("Choose a cover from this memory's photos.");
    }
    let momentId = existing?.id ?? "", primary: string | null = null;
    const claimIds: string[] = [];
    if (input.action === "create") {
      const first = input.asset_ids[0];
      const out = await importKnowledge(live, { request_id: input.request_id, contributor_id: input.member, reviewed: true, items: [{ kind: first ? "photo" : "history", label: input.title, text: input.text, ...(first ? { asset_id: first } : {}), ...(input.place && input.text.includes(input.place) ? { place: input.place } : {}) }] });
      momentId = out.topics[0]!.id; primary = `claim:${momentId}`; claimIds.push(primary);
      for (const [index, id] of input.asset_ids.slice(1).entries()) await attachPhoto(live, input.member, primary, momentId, id, `artifact:library-photo:${input.request_id}:${index}`);
    } else if (input.action === "story") {
      const node = await live.graph.getNode(momentId);
      const topicId = node && ["Event", "Place", "Person"].includes(node.type) ? momentId : null;
      primary = await contribute(live, input.member, topicId, input.text, input.asset_id); claimIds.push(primary);
    }
    const revision = input.action === "story" ? existing!.revision : (existing?.revision ?? 0) + 1;
    const record: LibraryRecord = { kind: "family_library_v1", request_hash: requestHash, action: input.action, moment_id: momentId, claim_ids: claimIds, primary_claim_id: primary, revision, metadata: meta, ...(input.action === "create" ? { photo_order: input.asset_ids } : {}) };
    const at = new Date().toISOString();
    await live.refreshSetup();
    if (JSON.stringify(live.setup.current()) !== policyVersion) throw new LibraryError("Joint setup changed. Review this contribution again.", 409);
    await live.graph.putNode({ id: receiptId, type: "Artifact", label: "Contributor library edit", props: { kind: "audit_log", text: JSON.stringify(record), alt: null }, prov: { source_id: receiptId, source_class: "session_audit", asset_id: null, media_hash: null, span: null, observed_at: at, author: input.member, extraction_method: "system_event", confidence: 1, audience_scope: [policy.person_id], expires_at: null, supersedes: [], contradicts: [], status: "reference", patient_confirmed: false, confirmations: [] } });
    requireAccess(live.setup.current(), input.member);
    return { moment_id: momentId, revision };
  };
  return live.graph.atomic ? live.graph.atomic(write) : write();
}
