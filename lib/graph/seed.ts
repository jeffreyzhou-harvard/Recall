/**
 * Seed loading and validation.
 *
 * Seed files are data (AGENTS.md section 8: "fixtures are data, not code
 * branches"). A scenario is the base seed plus zero or more overlays; there
 * is no scenario-specific code anywhere in the loader.
 *
 * Provenance is declared once per source under `sources` and joined onto
 * every node and edge that cites that source, so all facts drawn from one
 * artifact are guaranteed to carry identical provenance.
 */
import { z } from "zod";
import { AssetIndex } from "@/lib/provenance/assets";
import {
  EDGE_SIGNATURES,
  EDGE_TYPES,
  EPISTEMIC_STATUSES,
  EXTRACTION_METHODS,
  NODE_TYPES,
  SOURCE_CLASSES,
  initialStatus,
  type EdgeType,
  type GraphData,
  type GraphEdge,
  type GraphNode,
  type NodeType,
  type Provenance,
} from "./types";

const spanSchema = z.object({ start_ms: z.number().int().nonnegative(), end_ms: z.number().int().positive() });

const sourceSchema = z.object({
  source_class: z.enum(SOURCE_CLASSES),
  asset_id: z.string().nullable(),
  observed_at: z.iso.datetime(),
  author: z.string().min(1),
  extraction_method: z.enum(EXTRACTION_METHODS),
  confidence: z.number().min(0).max(1),
  audience_scope: z.array(z.string()),
  expires_at: z.iso.datetime().nullable(),
  /** How facts from this source are known. Defaults from the source class; a seed may only lower it, e.g. to `inferred`. */
  status: z.enum(EPISTEMIC_STATUSES).optional(),
});
export type SeedSource = z.infer<typeof sourceSchema>;

/** Per-type `props` shapes. Unknown keys are rejected, so nothing rides along unvalidated. */
const propsSchemas: Record<NodeType, z.ZodType> = {
  Person: z.strictObject({
    display_name: z.string().min(1),
    role: z.enum(["participant", "asker", "known"]),
    subject_pronoun: z.string().min(1).optional(),
  }),
  Relationship: z.strictObject({ kind: z.string().min(1), verified: z.boolean() }),
  CurrentAsk: z.strictObject({
    forward_id: z.string().min(1),
    thread_id: z.string().min(1),
    text: z.string().min(1),
    option_topic_ids: z.array(z.string()),
    requested_audience: z.string().min(1),
    received_at: z.iso.datetime(),
  }),
  Artifact: z.strictObject({
    kind: z.enum(["photo", "audio", "message", "thread", "setup_record", "answer"]),
    text: z.string().nullable(),
    alt: z.string().nullable(),
  }),
  Topic: z.strictObject({ wikidata_id: z.string().regex(/^Q\d+$/).nullable(), aliases: z.array(z.string()) }),
  EpisodicClaim: z.strictObject({ text: z.string().min(1) }),
  PreferenceExpertise: z.strictObject({ text: z.string().min(1) }),
  Event: z.strictObject({ wikidata_id: z.string().regex(/^Q\d+$/).nullable(), date: z.iso.date().nullable() }),
  AccessPolicy: z.strictObject({ policy_ref: z.string().min(1) }),
  Session: z.strictObject({ ask_id: z.string(), started_at: z.iso.datetime(), ended_at: z.iso.datetime().nullable() }),
  Contribution: z.strictObject({
    content_hash: z.string(),
    literal_transcript: z.string(),
    generated_first_person_words: z.literal(0),
  }),
  Assent: z.strictObject({
    decision: z.enum(["yes", "no", "unclear"]),
    contribution_hash: z.string(),
    audience: z.string(),
  }),
  Place: z.strictObject({ aliases: z.array(z.string()) }),
  Activity: z.strictObject({ aliases: z.array(z.string()) }),
  Story: z.strictObject({ text: z.string().min(1) }),
  Cluster: z.strictObject({ kind: z.enum(["face", "place", "time", "theme"]), cluster_key: z.string().min(1), photo_count: z.number().int().nonnegative() }),
};

const seedNodeSchema = z.strictObject({
  id: z.string().min(1),
  type: z.enum(NODE_TYPES),
  label: z.string().min(1),
  props: z.record(z.string(), z.unknown()),
  source: z.string().min(1),
  span: spanSchema.optional(),
  supersedes: z.array(z.string()).optional(),
  contradicts: z.array(z.string()).optional(),
});

const seedEdgeSchema = z.strictObject({
  type: z.enum(EDGE_TYPES),
  from: z.string().min(1),
  to: z.string().min(1),
  source: z.string().min(1),
  span: spanSchema.optional(),
  props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

export const seedFileSchema = z.strictObject({
  version: z.literal(1),
  description: z.string(),
  sources: z.record(z.string(), sourceSchema),
  nodes: z.array(seedNodeSchema),
  edges: z.array(seedEdgeSchema),
});
export type SeedFile = z.infer<typeof seedFileSchema>;

export class SeedValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`graph seed is invalid:\n  - ${problems.join("\n  - ")}`);
    this.name = "SeedValidationError";
  }
}

/**
 * Rule 4: no inferred clinical or emotional state is ever stored as fact.
 * This is a lexical tripwire over every key and string in the seed. It is
 * deliberately blunt - a false positive costs a rewording, a false negative
 * puts a clinical label in a family's graph.
 */
const CLINICAL_TERMS =
  /\b(diagnos\w*|dementia|alzheimer\w*|cognit\w*|competen\w*|mood|disease stage|decline|impairment|symptom\w*|score[sd]?)\b/i;

function clinicalHits(value: unknown, path: string, out: string[]): void {
  if (typeof value === "string") {
    if (CLINICAL_TERMS.test(value)) out.push(`${path}: clinical or state language is not storable ("${value}")`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => clinicalHits(v, `${path}[${i}]`, out));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (CLINICAL_TERMS.test(k)) out.push(`${path}.${k}: clinical or state field name is not storable`);
      clinicalHits(v, `${path}.${k}`, out);
    }
  }
}

export function edgeId(type: EdgeType, from: string, to: string): string {
  return `${type}:${from}->${to}`;
}

/** Merge a base seed with overlays. Append-only: an id collision is an error, never a silent replace. */
export function mergeSeeds(base: SeedFile, ...overlays: SeedFile[]): SeedFile {
  const merged: SeedFile = {
    version: 1,
    description: [base.description, ...overlays.map((o) => o.description)].join(" + "),
    sources: { ...base.sources },
    nodes: [...base.nodes],
    edges: [...base.edges],
  };
  for (const overlay of overlays) {
    for (const [key, source] of Object.entries(overlay.sources)) {
      if (key in merged.sources) throw new SeedValidationError([`overlay redefines source "${key}"`]);
      merged.sources[key] = source;
    }
    merged.nodes.push(...overlay.nodes);
    merged.edges.push(...overlay.edges);
  }
  return merged;
}

/**
 * Validate a seed and expand it into graph data with full provenance on every
 * node and edge. Collects every problem before throwing, so one run of
 * `npm run verify` reports the whole list.
 */
export function buildGraph(raw: unknown, assets: AssetIndex): GraphData {
  const parsed = seedFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SeedValidationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const seed = parsed.data;
  const problems: string[] = [];
  clinicalHits(seed.nodes, "nodes", problems);
  clinicalHits(seed.edges, "edges", problems);

  const nodeTypes = new Map<string, NodeType>();
  for (const n of seed.nodes) {
    if (nodeTypes.has(n.id)) problems.push(`duplicate node id "${n.id}"`);
    nodeTypes.set(n.id, n.type);
  }

  const provFor = (
    sourceKey: string,
    where: string,
    extra: { span?: { start_ms: number; end_ms: number }; supersedes?: string[]; contradicts?: string[] },
  ): Provenance | null => {
    const source = seed.sources[sourceKey];
    if (!source) {
      problems.push(`${where}: cites undeclared source "${sourceKey}"`);
      return null;
    }
    if (source.source_class !== "public_reference" && nodeTypes.get(sourceKey) !== "Artifact") {
      problems.push(`${where}: source "${sourceKey}" must be an Artifact node (layer 1 raw evidence)`);
    }
    let mediaHash: string | null = null;
    if (source.asset_id !== null) {
      try {
        mediaHash = assets.resolveSpan(source.asset_id, extra.span ?? null).sha256;
      } catch (e) {
        problems.push(`${where}: ${(e as Error).message}`);
      }
    } else if (extra.span) {
      problems.push(`${where}: has a media span but source "${sourceKey}" has no asset`);
    }
    for (const id of source.audience_scope) {
      if (!nodeTypes.has(id)) problems.push(`${where}: audience_scope names unknown node "${id}"`);
    }
    return {
      source_id: sourceKey,
      source_class: source.source_class,
      asset_id: source.asset_id,
      media_hash: mediaHash,
      span: extra.span ?? null,
      observed_at: source.observed_at,
      author: source.author,
      extraction_method: source.extraction_method,
      confidence: source.confidence,
      audience_scope: [...source.audience_scope],
      expires_at: source.expires_at,
      supersedes: extra.supersedes ?? [],
      contradicts: extra.contradicts ?? [],
      status: source.status ?? initialStatus(source.source_class),
      confirmations: [],
    };
  };

  const nodes: GraphNode[] = [];
  for (const n of seed.nodes) {
    const where = `node "${n.id}"`;
    const props = propsSchemas[n.type].safeParse(n.props);
    if (!props.success) {
      for (const issue of props.error.issues) problems.push(`${where}: props.${issue.path.join(".")}: ${issue.message}`);
    }
    for (const ref of [...(n.supersedes ?? []), ...(n.contradicts ?? [])]) {
      if (!nodeTypes.has(ref)) problems.push(`${where}: supersedes/contradicts unknown node "${ref}"`);
    }
    const prov = provFor(n.source, where, n);
    if (prov && props.success) {
      nodes.push({ id: n.id, type: n.type, label: n.label, props: props.data, prov } as GraphNode);
    }
  }

  const edges: GraphEdge[] = [];
  const edgeIds = new Set<string>();
  for (const e of seed.edges) {
    const id = edgeId(e.type, e.from, e.to);
    const where = `edge "${id}"`;
    if (edgeIds.has(id)) problems.push(`duplicate ${where}`);
    edgeIds.add(id);
    const fromType = nodeTypes.get(e.from);
    const toType = nodeTypes.get(e.to);
    if (!fromType) problems.push(`${where}: unknown "from" node`);
    if (!toType) problems.push(`${where}: unknown "to" node`);
    if (fromType && toType && !EDGE_SIGNATURES[e.type].some(([f, t]) => f === fromType && t === toType)) {
      problems.push(`${where}: ${e.type} may not connect ${fromType} -> ${toType}`);
    }
    const prov = provFor(e.source, where, e);
    if (prov) edges.push({ id, type: e.type, from: e.from, to: e.to, props: e.props ?? {}, prov });
  }

  // verify_claim_support reads CONTRADICTS edges, so a contradiction noted only in provenance would go unheard.
  for (const n of seed.nodes) {
    for (const other of n.contradicts ?? []) {
      if (!edgeIds.has(edgeId("CONTRADICTS", n.id, other))) {
        problems.push(`node "${n.id}": contradicts "${other}" but no CONTRADICTS edge links them`);
      }
    }
  }

  if (problems.length > 0) throw new SeedValidationError([...new Set(problems)]);
  return { nodes, edges };
}
