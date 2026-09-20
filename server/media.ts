/** Private immutable media. Transient call audio stays in memory until a confirmed graph artifact refers to it. */
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import type { AssetEntry, AssetIndex } from "@/lib/provenance/assets";
import type { SqliteGraphStore } from "./graph-store";
import { dataDirectory } from "./data-directory";
export function wavFromPcm(pcm: Uint8Array, rate = 16000): Buffer {
  const wav = Buffer.alloc(44 + pcm.byteLength); wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(pcm.byteLength, 40); wav.set(pcm, 44); return wav;
}
export function parseWav(wav: Buffer): { bytes: Buffer; duration: number } {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE" || wav.readUInt32LE(4) + 8 !== wav.length) throw new Error("Use a PCM WAV recording.");
  let pcm: Buffer | undefined, rate = 0;
  for (let at = 12; at + 8 <= wav.length;) {
    const kind = wav.toString("ascii", at, at + 4), n = wav.readUInt32LE(at + 4); at += 8;
    if (at + n > wav.length) throw new Error("Incomplete audio.");
    if (kind === "fmt ") {
      if (n < 16 || wav.readUInt16LE(at) !== 1 || wav.readUInt16LE(at + 2) !== 1 || wav.readUInt16LE(at + 14) !== 16) throw new Error("Use mono PCM16 audio.");
      rate = wav.readUInt32LE(at + 4);
    }
    if (kind === "data") { if (pcm) throw new Error("Ambiguous audio."); pcm = wav.subarray(at, at + n); }
    at += n + n % 2;
  }
  if (!pcm?.length || pcm.length % 2 || rate < 8000 || rate > 48000 || pcm.length / (2 * rate) > 90) throw new Error("Record up to 90 seconds of audio.");
  return { bytes: wavFromPcm(pcm, rate), duration: pcm.length * 1000 / (2 * rate) };
}
/** Strip optional metadata so a contributed photo cannot import location or device/contact metadata. */
export function cleanPhoto(bytes: Buffer): { bytes: Buffer; mime: string } {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    const chunks = [bytes.subarray(0, 8)]; let at = 8, ended = false;
    while (at + 12 <= bytes.length) {
      const size = bytes.readUInt32BE(at), kind = bytes.toString("ascii", at + 4, at + 8);
      if (size > bytes.length - at - 12) throw new Error("Incomplete photo.");
      if (kind === "IHDR" && (size !== 13 || bytes.readUInt32BE(at + 8) * bytes.readUInt32BE(at + 12) > 16000000)) throw new Error("Choose a smaller photo.");
      if (["IHDR", "PLTE", "IDAT", "tRNS", "IEND"].includes(kind)) chunks.push(bytes.subarray(at, at + size + 12));
      at += size + 12; if (kind === "IEND") { ended = true; break; }
    }
    if (!ended) throw new Error("Incomplete photo."); return { bytes: Buffer.concat(chunks), mime: "image/png" };
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    const chunks = [bytes.subarray(0, 2)]; let at = 2, frame = false, scan = false;
    while (at + 2 <= bytes.length && bytes[at] === 255) {
      while (bytes[at + 1] === 255) at++;
      const marker = bytes[at + 1]!;
      if (marker === 217) { if (!frame || !scan) break; chunks.push(bytes.subarray(at, at + 2)); return { bytes: Buffer.concat(chunks), mime: "image/jpeg" }; }
      if (at + 4 > bytes.length) break;
      const size = bytes.readUInt16BE(at + 2);
      if (size < 2 || at + 2 + size > bytes.length) break;
      if ([192, 193, 194].includes(marker)) {
        if (size < 8 || bytes.readUInt16BE(at + 5) * bytes.readUInt16BE(at + 7) > 16000000) throw new Error("Choose a smaller photo.");
        frame = true;
      }
      if (!(marker >= 224 && marker <= 239) && marker !== 254) chunks.push(bytes.subarray(at, at + size + 2));
      at += size + 2;
      if (marker === 218) {
        scan = true; const start = at;
        while (at < bytes.length) {
          if (bytes[at] !== 255) { at++; continue; }
          const next = bytes[at + 1];
          if (next === 0 || (next !== undefined && next >= 208 && next <= 215)) { at += 2; continue; }
          break;
        }
        chunks.push(bytes.subarray(start, at));
      }
    }
  }
  throw new Error("Choose a JPEG or PNG photo.");
}
export type Media = { entry: AssetEntry; bytes: Buffer; owner: string; mime: string };
export class MediaStore {
  private db: DatabaseSync;
  constructor(root: string, readonly household: string, private index: AssetIndex, private graph?: SqliteGraphStore) {
    const dir = dataDirectory(root); mkdirSync(dir, { recursive: true, mode: 0o700 }); const path = join(dir, "media.db"); this.db = graph?.mediaDatabase() ?? new DatabaseSync(path); if (!graph) chmodSync(path, 0o600);
    this.db.exec("PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, household TEXT NOT NULL, owner TEXT NOT NULL, mime TEXT NOT NULL, entry TEXT NOT NULL, bytes BLOB NOT NULL, expires INTEGER)");
    this.db.exec("CREATE TABLE IF NOT EXISTS confirmation_receipts (household TEXT NOT NULL, hash TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(household,hash))");
    for (const row of this.db.prepare("SELECT entry FROM media WHERE household=?").all(household)) index.register(JSON.parse(row.entry as string));
  }
  make(bytes: Buffer, owner: string, mime: string, duration: number | null): Media {
    const id = `media:${randomUUID()}`, entry: AssetEntry = { id, path: id, kind: mime.startsWith("image/") ? "image" : "audio", sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, duration_ms: duration, status: "final", description: "Contributed media" };
    this.index.register(entry); return { entry, bytes, owner, mime };
  }
  async save(media: Media, permanent = false) { const write = async () => { this.db.prepare("INSERT OR IGNORE INTO media VALUES (?, ?, ?, ?, ?, ?, ?)").run(media.entry.id, this.household, media.owner, media.mime, JSON.stringify(media.entry), media.bytes, permanent ? null : Date.now() + 3600000); }; if (this.graph) await this.graph.atomic(write); else await write(); }
  keep(id: string) { this.db.prepare("UPDATE media SET expires=NULL WHERE household=? AND id=?").run(this.household, id); }
  get(id: string): Media | null {
    const row = this.db.prepare("SELECT * FROM media WHERE household=? AND id=? AND (expires IS NULL OR expires>=?)").get(this.household, id, Date.now());
    return row ? { entry: JSON.parse(row.entry as string), bytes: Buffer.from(row.bytes as Uint8Array), owner: row.owner as string, mime: row.mime as string } : null;
  }
  isPermanent(id: string) { const row = this.db.prepare("SELECT expires FROM media WHERE household=? AND id=?").get(this.household, id); return row?.expires === null; }
  receipt(hash: string, data: unknown) { this.db.prepare("INSERT OR IGNORE INTO confirmation_receipts VALUES (?,?,?)").run(this.household, hash, JSON.stringify(data)); }
  reconcile(referenced: Set<string | null>, patientId?: string) {
    for (const id of referenced) if (id) this.keep(id);
    this.db.prepare("DELETE FROM media WHERE household=? AND expires IS NOT NULL AND (expires < ? OR owner=?)").run(this.household, Date.now(), patientId ?? "");
  }
  remove(id: string) { this.db.prepare("DELETE FROM media WHERE household=? AND id=?").run(this.household, id); }
  close() { if (!this.graph) this.db.close(); }
}
export async function limitedBody(request: Request, limit = 6000000): Promise<Buffer> {
  const reader = request.body?.getReader(); if (!reader) throw new Error("Missing recording.");
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw new Error("The file is too large."); chunks.push(value); } }
  catch (e) { await reader.cancel(); throw e; } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
