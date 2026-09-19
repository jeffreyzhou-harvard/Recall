/**
 * Generate deterministic stand-in media so the whole pipeline (hashing,
 * citations, provenance receipts, tests) can run before the real recordings
 * are cut.
 *
 * These are NOT demo media. Each audio file is a soft tick once a second; each
 * image says PLACEHOLDER on it. Every entry is marked `status: "placeholder"`
 * and `npm run verify:strict` fails until they are all replaced.
 *
 * It never overwrites a file that already exists, so it cannot clobber a real
 * recording. To replace a placeholder: drop the real file in, update `path`
 * and `status` in assets/manifest.json, then run `npm run assets:hash`.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AssetEntry } from "@/lib/provenance/assets";
import { ROOT, readManifest, sha256File, wavDurationMs, writeManifest } from "./lib/asset-tools";

const SAMPLE_RATE = 8000;

/** 8-bit mono PCM WAV: silence with a 120 ms, 330 Hz tick at the top of every second. */
function placeholderWav(durationMs: number): Buffer {
  const samples = Math.round((durationMs / 1000) * SAMPLE_RATE);
  const data = Buffer.alloc(samples, 128);
  for (let i = 0; i < samples; i++) {
    const intoSecond = i % SAMPLE_RATE;
    if (intoSecond < SAMPLE_RATE * 0.12) {
      data[i] = 128 + Math.round(18 * Math.sin((2 * Math.PI * 330 * intoSecond) / SAMPLE_RATE));
    }
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE, 28); // byte rate: 1 byte per sample
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function placeholderSvg(title: string): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" role="img">',
    `  <title>Placeholder: ${title}</title>`,
    '  <rect width="800" height="600" fill="#F6F1E8"/>',
    '  <rect x="24" y="24" width="752" height="552" rx="18" fill="none" stroke="#18342F" stroke-width="2" stroke-dasharray="10 8"/>',
    '  <text x="400" y="285" text-anchor="middle" font-family="sans-serif" font-size="34" fill="#18342F">Placeholder</text>',
    `  <text x="400" y="335" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#18342F">${title}</text>`,
    "</svg>",
    "",
  ].join("\n");
}

interface Spec {
  id: string;
  path: string;
  kind: AssetEntry["kind"];
  description: string;
  /** Audio only: how long the stand-in has to be for the transcript's timings to fit inside it. */
  duration_ms?: number;
  make: () => Buffer | string;
}

const SPECS: Spec[] = [
  {
    id: "photo-maya",
    path: "assets/images/photo-maya.svg",
    kind: "image",
    description: "The photo of Maya shown to Susan during onboarding (\"Who is this?\").",
    make: () => placeholderSvg("Photo of Maya, shown during onboarding"),
  },
  {
    id: "photo-cape-may",
    path: "assets/images/photo-cape-may.svg",
    kind: "image",
    description: "The family photograph at Cape May that Maya shared. A rung-3 cue, attributed to her.",
    make: () => placeholderSvg("Family photograph at Cape May, shared by Maya"),
  },
  {
    id: "clip-onboarding",
    path: "assets/audio/clip-onboarding.wav",
    kind: "audio",
    description: "Susan's onboarding voice recording: her own answers about her photos. Evidence for her seeded claims.",
    duration_ms: 13_000,
    make: () => placeholderWav(13_000),
  },
  {
    id: "call-golden",
    path: "assets/audio/call-golden.wav",
    kind: "audio",
    description: "The prerecorded phone call for the judged path, from Relay's greeting through Susan's two spoken yeses and the warm close.",
    duration_ms: 60_000,
    make: () => placeholderWav(60_000),
  },
];

const manifest = readManifest();
let created = 0;
for (const spec of SPECS) {
  const abs = join(ROOT, spec.path);
  const known = manifest.assets.find((a) => a.id === spec.id);
  if (known && known.status === "final") {
    console.log(`skip  ${spec.id}: already final (${known.path})`);
    continue;
  }
  // A stand-in whose length no longer fits the script is regenerated. A real (`final`) file is never touched: see above.
  const stale = existsSync(abs) && spec.duration_ms !== undefined && wavDurationMs(abs) !== spec.duration_ms;
  if (!existsSync(abs) || stale) {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, spec.make());
    created++;
    console.log(`wrote ${spec.path}`);
  }
  const { sha256, bytes } = sha256File(abs);
  const entry: AssetEntry = {
    id: spec.id,
    path: spec.path,
    kind: spec.kind,
    sha256,
    bytes,
    duration_ms: spec.kind === "audio" ? wavDurationMs(abs) : null,
    status: "placeholder",
    description: spec.description,
  };
  if (known) Object.assign(known, entry);
  else manifest.assets.push(entry);
}
writeManifest(manifest);
console.log(`\n${created} placeholder file(s) created; manifest has ${manifest.assets.length} asset(s).`);
console.log("These are stand-ins. `npm run verify:strict` fails until every one is replaced with real media.");
