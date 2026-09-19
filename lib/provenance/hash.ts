/**
 * Content hashing. WebCrypto only, so the same code runs in the browser (the
 * judged path) and in Node (scripts and tests). No dependency, no network.
 */

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (const b of bytes) out += HEX[b];
  return out;
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer: a view over a larger or shared buffer would
  // otherwise hash bytes that are not part of `bytes`.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return toHex(await crypto.subtle.digest("SHA-256", copy.buffer));
}

export async function sha256Text(text: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(text));
}

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * Canonical JSON: object keys sorted, no whitespace, `undefined` rejected.
 * Two structurally equal values always serialize - and therefore hash - the
 * same way, regardless of the order their keys were written in.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new Error("canonicalJson: non-finite number");
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      const parts: string[] = [];
      for (const k of keys) {
        if (obj[k] === undefined) throw new Error(`canonicalJson: undefined at key "${k}"`);
        parts.push(`${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
      }
      return `{${parts.join(",")}}`;
    }
    default:
      throw new Error(`canonicalJson: unsupported type ${typeof value}`);
  }
}

/** sha256 over the canonical JSON form. This is what a "content hash" means in Recall. */
export async function contentHash(value: unknown): Promise<string> {
  return sha256Text(canonicalJson(value));
}
