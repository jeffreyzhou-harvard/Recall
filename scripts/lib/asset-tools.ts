/** Shared helpers for the asset scripts. Node only. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AssetManifest } from "@/lib/provenance/assets";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MANIFEST_PATH = join(ROOT, "assets", "manifest.json");

export function sha256File(absPath: string): { sha256: string; bytes: number } {
  const buf = readFileSync(absPath);
  return { sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.byteLength };
}

/** Duration of a PCM WAV file from its header, or null when the file is not a WAV we can read. */
export function wavDurationMs(absPath: string): number | null {
  const buf = readFileSync(absPath);
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return null;
  let offset = 12;
  let byteRate: number | null = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") byteRate = buf.readUInt32LE(offset + 16);
    if (id === "data") return byteRate ? Math.round((size / byteRate) * 1000) : null;
    offset += 8 + size + (size % 2);
  }
  return null;
}

export function readManifest(): AssetManifest {
  if (!existsSync(MANIFEST_PATH)) return { version: 1, generated_by: "npm run assets:hash", assets: [] };
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as AssetManifest;
}

export function writeManifest(manifest: AssetManifest): void {
  manifest.assets.sort((a, b) => (a.id < b.id ? -1 : 1));
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}
