/**
 * Photo library -> observations in the graph. The start of the discovery loop:
 *
 *   photos -> recurring faces, places, times, themes -> candidate nodes
 *
 * What is written here is only ever an OBSERVATION: "this face recurs in 184
 * photos". It is never an identity ("this is Maya") and never a meaning ("her
 * daughter"). Those can only come from a person answering a question, through
 * lib/discovery/answers.ts. There is no path from this file to a fact.
 *
 * The analysis itself (face grouping, EXIF, scene themes) sits behind
 * `PhotoAnalyzer` and is not implemented here: it is a model concern with its
 * own consent surface. Whatever implements it is held to this contract, which
 * has no field for a name, an identity, a relationship, or a face embedding,
 * and rejects unknown fields - so an analyzer cannot smuggle any of those in.
 */
import { z } from "zod";
import { edgeId } from "@/lib/graph/seed";
import type { GraphStore } from "@/lib/graph/store";
import type { ClusterNode, GraphEdge, GraphNode, Provenance } from "@/lib/graph/types";
import { AssetResolutionError, type AssetIndex } from "@/lib/provenance/assets";
import type { AccessPolicy } from "@/lib/tools/policy";

const id = z.string().min(1);
export const CLUSTER_KINDS = ["face", "place", "time", "theme"] as const;
export type ClusterKind = (typeof CLUSTER_KINDS)[number];

export const libraryObservationsSchema = z.strictObject({
  /** Which analyzer and version produced this, for provenance. */
  analyzer: id,
  observed_at: z.iso.datetime(),
  photos: z.array(z.strictObject({ asset_id: id, taken_at: z.iso.datetime().nullable() })).min(1),
  clusters: z.array(
    z.strictObject({
      /** Opaque and stable. Not a name. */
      cluster_key: id,
      kind: z.enum(CLUSTER_KINDS),
      photo_asset_ids: z.array(id).min(1),
      /** How sure the analyzer is that these photos belong together. About the grouping, never about a person. */
      confidence: z.number().min(0).max(1),
    }),
  ),
});
export type LibraryObservations = z.infer<typeof libraryObservationsSchema>;

export interface PhotoAnalyzer {
  readonly label: string;
  analyze(photos: ReadonlyArray<{ asset_id: string; bytes: Uint8Array }>): Promise<LibraryObservations>;
}

export type DiscoveryRefusal = "discovery_disabled" | "not_granted" | "kind_not_permitted" | "invalid_observations" | "unknown_asset";

export class DiscoveryError extends Error {
  constructor(
    public readonly code: DiscoveryRefusal,
    detail: string,
  ) {
    super(`discovery refused (${code}): ${detail}`);
    this.name = "DiscoveryError";
  }
}

const OBSERVE_FLAG: Record<ClusterKind, keyof AccessPolicy["discovery"]["observe"]> = { face: "faces", place: "places", time: "times", theme: "themes" };
/** How an unnamed cluster is referred to until a person says what it is. Deliberately says nothing about who or what. */
const PLACEHOLDER: Record<ClusterKind, string> = { face: "Person", place: "Place", time: "Moment", theme: "Theme" };

export const clusterId = (kind: ClusterKind, key: string): string => `cluster:${kind}:${key}`;
export const libraryPhotoId = (assetId: string): string => `artifact:library:${assetId}`;

export interface IngestDeps {
  graph: GraphStore;
  assets: AssetIndex;
  policy: AccessPolicy;
  /** Who is starting this ingest. Must be her, or someone the joint setup says granted photo access. */
  granted_by: string;
}

export interface IngestResult {
  photos_added: number;
  clusters_added: number;
  cluster_ids: string[];
}

/** All checks run before any write: a refused ingest leaves nothing behind. */
export async function ingestLibrary(raw: unknown, deps: IngestDeps): Promise<IngestResult> {
  const { graph, assets, policy } = deps;
  const d = policy.discovery;
  if (!d.enabled) throw new DiscoveryError("discovery_disabled", "the joint setup has not turned discovery on");
  if (deps.granted_by !== policy.person_id && !d.photo_access_granted_by.includes(deps.granted_by)) {
    throw new DiscoveryError("not_granted", `${deps.granted_by} has not been recorded as granting photo access`);
  }
  const parsed = libraryObservationsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DiscoveryError("invalid_observations", parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "));
  }
  const obs = parsed.data;
  const known = new Set(obs.photos.map((p) => p.asset_id));
  for (const c of obs.clusters) {
    // An analyzer that groups faces when the family only agreed to places is a bug, not a bonus. Nothing is kept.
    if (!d.observe[OBSERVE_FLAG[c.kind]]) throw new DiscoveryError("kind_not_permitted", `the joint setup does not permit observing ${OBSERVE_FLAG[c.kind]}`);
    const stray = c.photo_asset_ids.find((a) => !known.has(a));
    if (stray) throw new DiscoveryError("invalid_observations", `cluster "${c.cluster_key}" cites photo "${stray}", which is not in this library`);
  }
  const hashes = new Map<string, string>();
  for (const p of obs.photos) {
    try {
      hashes.set(p.asset_id, assets.resolveSpan(p.asset_id, null).sha256);
    } catch (e) {
      if (e instanceof AssetResolutionError) throw new DiscoveryError("unknown_asset", e.message);
      throw e;
    }
  }

  const prov = (sourceId: string, assetId: string | null, observedAt: string, confidence: number): Provenance => ({
    source_id: sourceId,
    source_class: "photo_library",
    asset_id: assetId,
    media_hash: assetId ? hashes.get(assetId)! : null,
    span: null,
    observed_at: observedAt,
    author: deps.granted_by,
    extraction_method: assetId ? "forwarded_message" : "photo_analysis",
    confidence,
    audience_scope: [...policy.approved_audiences],
    expires_at: null,
    supersedes: [],
    contradicts: [],
    status: "observed",
    confirmations: [],
  });

  let photosAdded = 0;
  for (const p of obs.photos) {
    if (await graph.getNode(libraryPhotoId(p.asset_id))) continue;
    const node: GraphNode = {
      id: libraryPhotoId(p.asset_id),
      type: "Artifact",
      label: "Photo",
      props: { kind: "photo", text: null, alt: null },
      prov: prov(libraryPhotoId(p.asset_id), p.asset_id, p.taken_at ?? obs.observed_at, 1),
    };
    await graph.putNode(node);
    photosAdded++;
  }

  // Numbered by how often they recur, so "Person 1" is the most present face: the natural first anchor.
  const ordered = [...obs.clusters].sort((a, b) => b.photo_asset_ids.length - a.photo_asset_ids.length || (a.cluster_key < b.cluster_key ? -1 : 1));
  const counters = new Map<ClusterKind, number>();
  for (const existing of await graph.nodesOfType("Cluster")) counters.set(existing.props.kind, (counters.get(existing.props.kind) ?? 0) + 1);

  const added: string[] = [];
  for (const c of ordered) {
    const cid = clusterId(c.kind, c.cluster_key);
    if (await graph.getNode(cid)) continue;
    const n = (counters.get(c.kind) ?? 0) + 1;
    counters.set(c.kind, n);
    const firstPhoto = libraryPhotoId([...c.photo_asset_ids].sort()[0]!);
    const node: ClusterNode = {
      id: cid,
      type: "Cluster",
      label: `${PLACEHOLDER[c.kind]} ${n}`,
      props: { kind: c.kind, cluster_key: c.cluster_key, photo_count: c.photo_asset_ids.length },
      prov: { ...prov(firstPhoto, null, obs.observed_at, c.confidence), author: `analyzer:${obs.analyzer}` },
    };
    await graph.putNode(node);
    for (const assetId of [...c.photo_asset_ids].sort()) {
      const from = libraryPhotoId(assetId);
      const edge: GraphEdge = { id: edgeId("DEPICTS", from, cid), type: "DEPICTS", from, to: cid, props: {}, prov: { ...prov(from, assetId, obs.observed_at, c.confidence), author: `analyzer:${obs.analyzer}`, extraction_method: "photo_analysis" } };
      await graph.putEdge(edge);
    }
    added.push(cid);
  }
  return { photos_added: photosAdded, clusters_added: added.length, cluster_ids: added };
}
