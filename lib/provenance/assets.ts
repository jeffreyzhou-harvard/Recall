/**
 * The asset manifest is the single source of truth for media hashes. Only
 * `npm run assets:hash` writes it. Fixtures refer to media by `asset_id`; the
 * hash is joined from here at load time so it can never drift from the file
 * on disk without `npm run verify` noticing.
 *
 * /assets is append-only after hashing. Replacing a hashed asset means
 * re-running the verification script (AGENTS.md section 13).
 */
import type { MediaSpan } from "@/lib/graph/types";

export type AssetKind = "audio" | "image" | "video";

/**
 * `placeholder` marks a generated stand-in that exists so the pipeline can be
 * exercised before the real recordings are cut. `npm run verify:strict` - the
 * pre-demo check - fails while any placeholder remains.
 */
export type AssetStatus = "placeholder" | "final";

export interface AssetEntry {
  id: string;
  path: string;
  kind: AssetKind;
  sha256: string;
  bytes: number;
  /** Present for audio and video; spans are validated against it. */
  duration_ms: number | null;
  status: AssetStatus;
  description: string;
}

export interface AssetManifest {
  version: 1;
  generated_by: string;
  assets: AssetEntry[];
}

export class AssetResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetResolutionError";
  }
}

export class AssetIndex {
  private readonly byId = new Map<string, AssetEntry>();

  constructor(manifest: AssetManifest) {
    for (const asset of manifest.assets) {
      if (this.byId.has(asset.id)) throw new AssetResolutionError(`duplicate asset id "${asset.id}"`);
      this.byId.set(asset.id, asset);
    }
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  get(id: string): AssetEntry {
    const asset = this.byId.get(id);
    if (!asset) throw new AssetResolutionError(`asset "${id}" is not in the manifest`);
    return asset;
  }

  all(): AssetEntry[] {
    return [...this.byId.values()];
  }

  placeholders(): AssetEntry[] {
    return this.all().filter((a) => a.status === "placeholder");
  }

  /**
   * A citation resolves only if the asset exists and, when it names a span,
   * the span lies inside the recording. Throws otherwise: an unresolvable
   * citation is never silently dropped.
   */
  resolveSpan(assetId: string, span: MediaSpan | null): AssetEntry {
    const asset = this.get(assetId);
    if (span === null) return asset;
    if (asset.duration_ms === null) {
      throw new AssetResolutionError(`asset "${assetId}" has no duration, so it cannot back a time span`);
    }
    if (span.start_ms < 0 || span.end_ms <= span.start_ms || span.end_ms > asset.duration_ms) {
      throw new AssetResolutionError(
        `span ${span.start_ms}-${span.end_ms}ms is outside asset "${assetId}" (0-${asset.duration_ms}ms)`,
      );
    }
    return asset;
  }
}
