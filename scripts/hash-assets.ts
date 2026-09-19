/**
 * Re-hash every asset in assets/manifest.json and write the result back.
 *
 * /assets is append-only after hashing (AGENTS.md section 13). If a `final`
 * asset's bytes have changed, this script refuses to update the manifest
 * unless run with --allow-replace, because every content hash and receipt
 * that cited the old bytes is now stale. After a deliberate replace, run
 * `npm run verify`.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, readManifest, sha256File, wavDurationMs, writeManifest } from "./lib/asset-tools";

const allowReplace = process.argv.includes("--allow-replace");
const manifest = readManifest();
const refused: string[] = [];
let changed = 0;

for (const asset of manifest.assets) {
  const abs = join(ROOT, asset.path);
  if (!existsSync(abs)) {
    refused.push(`${asset.id}: file missing at ${asset.path}`);
    continue;
  }
  const { sha256, bytes } = sha256File(abs);
  if (sha256 !== asset.sha256) {
    if (asset.status === "final" && asset.sha256 !== "" && !allowReplace) {
      refused.push(`${asset.id}: final asset changed on disk (re-run with --allow-replace if this is deliberate)`);
      continue;
    }
    changed++;
    console.log(`hash  ${asset.id}: ${asset.sha256.slice(0, 12) || "(none)"} -> ${sha256.slice(0, 12)}`);
  }
  asset.sha256 = sha256;
  asset.bytes = bytes;
  if (asset.kind === "audio") {
    const duration = wavDurationMs(abs);
    if (duration !== null) asset.duration_ms = duration;
    else if (asset.duration_ms === null) {
      refused.push(`${asset.id}: not a PCM WAV, so set "duration_ms" by hand in the manifest`);
    }
  }
}

if (refused.length > 0) {
  console.error(`\nassets:hash refused:\n  - ${refused.join("\n  - ")}`);
  process.exit(1);
}
writeManifest(manifest);
console.log(`${manifest.assets.length} asset(s) hashed, ${changed} changed.`);
if (changed > 0) console.log("Hashes changed: run `npm run verify` to re-check every citation.");
