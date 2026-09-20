/** Incremental, source-backed graph enrichment. Model output is a proposal, never a memory. */
import { z } from "zod";
import { SystemClock, type Clock } from "@/lib/clock";
import { contentHash } from "@/lib/provenance/hash";
import { assertRelation, RELATION_NAMES } from "@/lib/graph/relations";
import type { GraphStore } from "@/lib/graph/store";
import { SPEAKABLE_AS_FACT, type GraphNode, type GraphEdge, type Provenance, type EpisodicClaimNode } from "@/lib/graph/types";
import type { AccessPolicy } from "@/lib/tools/policy";

const entityTypes = ["Person", "Place", "Event"] as const;
const span = { start: z.number().int().nonnegative(), end: z.number().int().positive() };
export const extractionSchema = z.strictObject({
  entities: z.array(z.strictObject({ key: z.string().min(1).max(80), type: z.enum(entityTypes), name: z.string().min(1).max(100), ...span })).max(24),
  relations: z.array(z.strictObject({ from: z.string(), to: z.string(), relation: z.enum(RELATION_NAMES), quote: z.string().min(1).max(500), ...span })).max(24),
});
export type Extraction = z.infer<typeof extractionSchema>;
export interface Episode { claim_id: string; source_id: string; author: string; text: string; known: Array<{ id: string; type: typeof entityTypes[number]; name: string }> }
export interface GraphExtractor { readonly name: string; extract(episode: Episode): Promise<Extraction> }
export const UPDATE_VERSION = "v1";
export const updateId = (claimId: string) => `artifact:knowledge:${UPDATE_VERSION}:${claimId}`;
const names = (n: GraphNode) => n.type === "Person" ? [n.props.display_name] : [n.label, ...("aliases" in n.props ? n.props.aliases : [])];
const normalize = (s: string) => s.normalize("NFKC").trim().toLocaleLowerCase("en-US");
function literalSpan(text: string, name: string): { start: number; end: number } | null {
  if (!name.length) return null;
  for (let start = text.indexOf(name); start >= 0; start = text.indexOf(name, start + 1)) {
    const end = start + name.length;
    if (!/[\p{L}\p{N}]/u.test(text[start - 1] ?? "") && !/[\p{L}\p{N}]/u.test(text[end] ?? "")) return { start, end };
  }
  return null;
}
export function usable(prov: Provenance, policy: AccessPolicy, now: string) {
  return SPEAKABLE_AS_FACT.has(prov.status) && policy.allowed_source_classes.includes(prov.source_class)
    && prov.audience_scope.includes(policy.person_id) && (!prov.expires_at || prov.expires_at > now)
    && (prov.author === policy.person_id || policy.approved_people.includes(prov.author));
}

/** Without a provider, only exact, unambiguous mentions of already known entities are linked. */
export class LiteralGraphExtractor implements GraphExtractor {
  readonly name = "literal-known-entities";
  async extract(episode: Episode): Promise<Extraction> {
    const found = episode.known.flatMap((n) => { const s = literalSpan(episode.text, n.name); return s ? [{ key: n.id, type: n.type, name: n.name, ...s }] : []; });
    return { entities: [...new Map(found.map((n) => [n.key, n])).values()].slice(0, 24), relations: [] };
  }
}

/** A later human naming can make earlier literal mentions useful. It never changes the earlier claim. */
export async function relinkKnownMentions(graph: GraphStore, policy: AccessPolicy, now: string) {
  const known = (await Promise.all(entityTypes.map((type) => graph.nodesOfType(type)))).flat().filter((n) => usable(n.prov, policy, now));
  for (const claim of await graph.nodesOfType("EpisodicClaim")) {
    if (!["recall_call", "family_contribution"].includes(claim.prov.source_class) || !usable(claim.prov, policy, now)) continue;
    const edges = await graph.edgesOf(claim.id);
    if (!edges.some((e) => e.type === "EVIDENCE_FOR" && e.from === claim.prov.source_id) || edges.some((e) => e.type === "CONTRADICTS" || e.type === "ABOUT" && policy.topics.block.includes(e.to))) continue;
    if (policy.blocked_terms.some((term) => claim.props.text.toLowerCase().includes(term.toLowerCase()))) continue;
    if (claim.prov.source_class === "recall_call") {
      const from = edges.find((e) => e.type === "DERIVED_FROM" && e.to.startsWith("contribution:"));
      const contribution = from ? await graph.getNode(from.to) : null;
      if (contribution?.type !== "Contribution" || !contribution.prov.patient_confirmed || contribution.props.literal_transcript !== claim.props.text) continue;
    }
    for (const node of known) {
      if (edges.some((e) => e.type === "ABOUT" && e.to === node.id && e.prov.status !== "inferred")) continue;
      const name = names(node).find((name) => literalSpan(claim.props.text, name));
      if (!name || known.filter((n) => n.type === node.type && names(n).some((s) => normalize(s) === normalize(name))).length !== 1) continue;
      const at = literalSpan(claim.props.text, name)!;
      const id = `knowledge:linked:${claim.id}:${node.id}`;
      if (!await graph.getEdge(id)) await graph.putEdge({ id, type: "ABOUT", from: claim.id, to: node.id, props: { start: at.start, end: at.end, mention_only: true }, prov: { ...claim.prov, extraction_method: "answer_interpretation" } });
    }
  }
}

export class KnowledgeUpdater {
  private queue: Promise<unknown> = Promise.resolve();
  private retryAfter = new Map<string, number>();
  constructor(private readonly graph: GraphStore, private readonly policy: () => AccessPolicy, private readonly extractor: GraphExtractor = new LiteralGraphExtractor(), private readonly refresh: () => Promise<void> = async () => {}, private readonly clock: Clock = new SystemClock()) {}

  /** Operator diagnostics: queue state only, no claims, transcripts, identities, or patient analytics. */
  async status() {
    const pending = await this.pendingClaims();
    return { organizer: this.extractor.name, waiting: pending.length, retrying: pending.some((c) => this.retryAfter.has(c.id)) };
  }

  private async pendingClaims() {
    const policy = this.policy(), now = this.clock.iso(), pending: EpisodicClaimNode[] = [];
    for (const claim of await this.graph.nodesOfType("EpisodicClaim")) {
      if (!["recall_call", "family_contribution"].includes(claim.prov.source_class) || !usable(claim.prov, policy, now) || await this.graph.getNode(updateId(claim.id))) continue;
      if (policy.blocked_terms.some((term) => claim.props.text.toLowerCase().includes(term.toLowerCase()))) continue;
      if ((await this.graph.edgesOf(claim.id)).some((e) => e.type === "CONTRADICTS" || (e.type === "ABOUT" && policy.topics.block.includes(e.to)))) continue;
      if (claim.prov.source_class === "recall_call" && (!claim.prov.patient_confirmed || claim.prov.author !== policy.person_id)) continue;
      pending.push(claim);
    }
    return pending.sort((a, b) => a.prov.observed_at.localeCompare(b.prov.observed_at) || a.id.localeCompare(b.id));
  }

  /** Claims are the durable work queue. A failed provider leaves the episode pending for a later tick. */
  process(limit = 8): Promise<{ processed: number; pending: number; failed: number }> {
    const next = this.queue.then(async () => {
      let processed = 0, failed = 0;
      await this.refresh();
      // Deterministic linking is independent of provider availability and also revisits older accounts.
      const relink = () => relinkKnownMentions(this.graph, this.policy(), this.clock.iso());
      if (this.graph.atomic) await this.graph.atomic(relink); else await relink();
      const pending = await this.pendingClaims();
      for (const claim of pending.filter((c) => (this.retryAfter.get(c.id) ?? 0) <= this.clock.now()).slice(0, limit)) {
        try { if (await this.enrich(claim)) { processed++; this.retryAfter.delete(claim.id); } }
        catch { failed++; this.retryAfter.set(claim.id, this.clock.now() + 60_000); /* No provider response, transcript, or proposal reaches logs. */ }
      }
      return { processed, pending: pending.length - processed, failed };
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async enrich(claim: EpisodicClaimNode): Promise<boolean> {
    const graph = this.graph, policy = this.policy(), version = JSON.stringify(policy);
    // Provider calls run outside the transaction. Keep the exact evidence and identity set they
    // read, then compare it again inside the commit so concurrent reviews cannot stale the proposal.
    const readBasis = async () => ({
      claim: await graph.getNode(claim.id), source: await graph.getNode(claim.prov.source_id),
      edges: await graph.edgesOf(claim.id),
      entities: (await Promise.all(entityTypes.map((type) => graph.nodesOfType(type)))).flat(),
    });
    const basis = graph.atomic ? await graph.atomic(readBasis) : await readBasis();
    const basisVersion = JSON.stringify(basis);
    if (JSON.stringify(basis.claim) !== JSON.stringify(claim) || basis.edges.some((e) => e.type === "CONTRADICTS")) throw new Error("Evidence changed");
    const source = basis.source;
    if (source?.type !== "Artifact" || !(await graph.edgesOf(claim.id)).some((e) => e.type === "EVIDENCE_FOR" && e.from === source.id)) throw new Error("Missing source");
    if (claim.prov.source_class === "recall_call") {
      const derived = (await graph.edgesOf(claim.id)).find((e) => e.type === "DERIVED_FROM" && e.to.startsWith("contribution:"));
      const contribution = derived ? await graph.getNode(derived.to) : null;
      if (contribution?.type !== "Contribution" || contribution.props.literal_transcript !== claim.props.text || !contribution.prov.patient_confirmed) throw new Error("Missing committed contribution");
    }
    const entities = basis.entities;
    const known = entities.filter((n) => usable(n.prov, policy, this.clock.iso())).flatMap((n) => names(n).filter((name) => literalSpan(claim.props.text, name)).map((name) => ({ id: n.id, type: n.type as typeof entityTypes[number], name })));
    const episode: Episode = { claim_id: claim.id, source_id: source.id, author: claim.prov.author, text: claim.props.text, known };
    const proposal = extractionSchema.parse(await this.extractor.extract(episode));
    const nodes: GraphNode[] = [], edges: GraphEdge[] = [], resolved = new Map<string, GraphNode>();
    const derivedProv = (inferred: boolean): Provenance => ({ ...structuredClone(claim.prov), extraction_method: "answer_interpretation", ...(inferred ? { status: "inferred", patient_confirmed: false } : {}) });
    for (const entity of proposal.entities) {
      if (resolved.has(entity.key) || entity.end <= entity.start || episode.text.slice(entity.start, entity.end) !== entity.name || /[\p{L}\p{N}]/u.test(episode.text[entity.start - 1] ?? "") || /[\p{L}\p{N}]/u.test(episode.text[entity.end] ?? "")) throw new Error("Ungrounded entity");
      // A same-name collision never merges two people. Type assignments for new names remain proposals.
      const matches = entities.filter((n) => n.type === entity.type && usable(n.prov, policy, this.clock.iso()) && names(n).some((name) => normalize(name) === normalize(entity.name)));
      if (matches.length > 1) continue;
      const id = `entity:${await contentHash({ claim: claim.id, type: entity.type, name: normalize(entity.name) })}`;
      const n = matches[0] ?? nodes.find((n) => n.id === id) ?? ({ id, type: entity.type, label: entity.name, props: entity.type === "Person" ? { display_name: entity.name, role: "known" } : entity.type === "Place" ? { aliases: [] } : { date: null, wikidata_id: null }, prov: derivedProv(true) } as GraphNode);
      if (!matches.length && !nodes.some((v) => v.id === n.id)) nodes.push(n);
      resolved.set(entity.key, n);
      if (!(await graph.edgesOf(claim.id)).some((e) => e.type === "ABOUT" && e.to === n.id && e.prov.status !== "inferred")) edges.push({ id: `knowledge:mention:${claim.id}:${n.id}`, type: "ABOUT", from: claim.id, to: n.id, props: { start: entity.start, end: entity.end, mention_only: true }, prov: derivedProv(!matches.length) });
    }
    for (const relation of proposal.relations) {
      const from = resolved.get(relation.from), to = resolved.get(relation.to);
      if (!from || !to || from.id === to.id || episode.text.slice(relation.start, relation.end) !== relation.quote || relation.end <= relation.start || !literalSpan(relation.quote, from.label) || !literalSpan(relation.quote, to.label)) throw new Error("Ungrounded relation");
      assertRelation(relation.relation, from.type, to.type);
      // Literal names do not prove direction, identity or meaning. Semantic relations stay inferred.
      edges.push({ id: `knowledge:relation:${claim.id}:${from.id}:${relation.relation}:${to.id}`, type: "RELATED_TO", from: from.id, to: to.id, props: { relation: relation.relation, said_as: null, quote_start: relation.start, quote_end: relation.end }, prov: derivedProv(true) });
    }
    await this.refresh();
    const write = async () => {
      if (JSON.stringify(this.policy()) !== version || !usable(claim.prov, this.policy(), this.clock.iso())) throw new Error("Policy changed");
      if (await graph.getNode(updateId(claim.id))) return false;
      if (JSON.stringify(await readBasis()) !== basisVersion) throw new Error("Evidence changed during extraction");
      for (const node of nodes) if (!await graph.getNode(node.id)) await graph.putNode(node);
      for (const edge of edges) if (!await graph.getEdge(edge.id)) await graph.putEdge(edge);
      await graph.putNode({ id: updateId(claim.id), type: "Artifact", label: "Graph update receipt", props: { kind: "audit_log", text: JSON.stringify({ version: UPDATE_VERSION, claim_id: claim.id, extractor: this.extractor.name, nodes: nodes.length, edges: edges.length }), alt: null }, prov: { ...derivedProv(false), source_class: "session_audit", status: "reference", patient_confirmed: false, author: "system:recall", extraction_method: "system_event", asset_id: null, media_hash: null, span: null } });
      return true;
    };
    return graph.atomic ? graph.atomic(write) : write();
  }
}
