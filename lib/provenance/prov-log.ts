/**
 * PROV-style event log. Concepts and relation names follow the W3C PROV-O
 * vocabulary (https://www.w3.org/TR/prov-o/): entities, activities, agents,
 * and the relations between them. This is a compact JSON rendering, not an
 * RDF serialization.
 *
 * Records are hash-chained when the log is sealed, so a receipt can show that
 * the audit trail it points at has not been edited after the fact.
 */
import { contentHash } from "./hash";

export type ProvRelation =
  | "wasGeneratedBy"
  | "used"
  | "wasAttributedTo"
  | "wasAssociatedWith"
  | "wasDerivedFrom"
  | "wasInformedBy";

export type ProvAttrs = Record<string, string | number | boolean | null | string[]>;

export type ProvRecord =
  | { kind: "entity"; id: string; type: string; at: string; attrs: ProvAttrs }
  | { kind: "activity"; id: string; type: string; at: string; attrs: ProvAttrs }
  | { kind: "agent"; id: string; type: "person" | "software"; at: string; attrs: ProvAttrs }
  | { kind: "relation"; relation: ProvRelation; from: string; to: string; at: string };

export interface SealedProvLog {
  records: Array<ProvRecord & { seq: number; hash: string }>;
  /** Hash of the final record. Changing any earlier record changes this. */
  head: string;
}

export class ProvLog {
  private readonly records: ProvRecord[] = [];
  private readonly ids = new Set<string>();

  private add(record: ProvRecord): void {
    this.records.push(record);
  }

  entity(id: string, type: string, at: string, attrs: ProvAttrs = {}): void {
    if (this.ids.has(id)) return;
    this.ids.add(id);
    this.add({ kind: "entity", id, type, at, attrs });
  }

  activity(id: string, type: string, at: string, attrs: ProvAttrs = {}): void {
    if (this.ids.has(id)) return;
    this.ids.add(id);
    this.add({ kind: "activity", id, type, at, attrs });
  }

  agent(id: string, type: "person" | "software", at: string, attrs: ProvAttrs = {}): void {
    if (this.ids.has(id)) return;
    this.ids.add(id);
    this.add({ kind: "agent", id, type, at, attrs });
  }

  relate(relation: ProvRelation, from: string, to: string, at: string): void {
    this.add({ kind: "relation", relation, from, to, at });
  }

  get length(): number {
    return this.records.length;
  }

  async seal(): Promise<SealedProvLog> {
    let prev = "";
    const sealed: SealedProvLog["records"] = [];
    for (const [i, record] of this.records.entries()) {
      const hash = await contentHash({ prev, record });
      sealed.push({ ...record, seq: i + 1, hash });
      prev = hash;
    }
    return { records: sealed, head: prev };
  }
}

/** Recompute the chain. False if any record was altered, removed, or reordered. */
export async function verifySealed(log: SealedProvLog): Promise<boolean> {
  let prev = "";
  for (const sealed of log.records) {
    const { seq: _seq, hash, ...record } = sealed;
    if ((await contentHash({ prev, record })) !== hash) return false;
    prev = hash;
  }
  return prev === log.head;
}
