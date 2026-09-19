/**
 * The twelve tool contracts (AGENTS.md section 6).
 *
 * Each schema is the single source for three things: the TypeScript types,
 * runtime validation of every input and output, and the JSON Schema handed to
 * a model's tool interface. Objects are strict: an unknown field is an error,
 * so nothing unvalidated can ride through a tool call.
 *
 * Tool JSON schemas define the safety gates; changes need a second reviewer
 * (AGENTS.md section 13).
 */
import { z } from "zod";
import { SOURCE_CLASSES } from "@/lib/graph/types";
import { TURN_STATES } from "@/lib/state/machine";
import { DENIAL_REASONS } from "./policy";

const id = z.string().min(1);
const iso = z.iso.datetime();
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const span = z.strictObject({ start_ms: z.number().int().nonnegative(), end_ms: z.number().int().positive() });
const sourceClass = z.enum(SOURCE_CLASSES);

const citation = z.strictObject({
  node_id: id,
  source_id: id,
  source_class: sourceClass,
  asset_id: z.string().nullable(),
  media_hash: sha256.nullable(),
  span: span.nullable(),
  author: id,
  observed_at: iso,
});

const word = z.strictObject({ w: z.string().min(1), start_ms: z.number().int(), end_ms: z.number().int() });
const audioWindow = z.strictObject({ asset_id: id, start_ms: z.number().int().nonnegative(), end_ms: z.number().int().positive() });

export const SCAFFOLD_IDS = ["repeat", "name_asker", "restate_options", "source_backed_cue"] as const;
export type ScaffoldId = (typeof SCAFFOLD_IDS)[number];

/** Everything Relay can say. Each is a fixed template; only cited facts fill the slots. */
export const PROMPT_KINDS = [
  "brief",
  ...SCAFFOLD_IDS,
  "confirm_send",
  "narrowing",
  "wrap_up",
  "close_kindly",
] as const;
export type PromptKind = (typeof PROMPT_KINDS)[number];

export const REPAIR_TARGETS = ["whole", "asker", "referent"] as const;

const trim = z.strictObject({ kind: z.enum(["silence", "disfluency"]), start_ms: z.number().int(), end_ms: z.number().int() });

export const contracts = {
  inspect_request: {
    description: "Read the one forwarded ask for a thread: its text, participants, artifacts, and requested audience. Never reads thread history.",
    input: z.strictObject({ thread_id: id }),
    output: z.strictObject({
      ask_id: id,
      forward_id: id,
      thread_id: id,
      text: z.string(),
      asker_id: id,
      addressee_id: id,
      participants: z.array(id),
      artifacts: z.array(z.strictObject({ artifact_id: id, kind: z.string(), alt: z.string().nullable(), asset_id: z.string().nullable() })),
      option_topic_ids: z.array(id),
      topic_ids: z.array(id),
      event_ids: z.array(id),
      requested_audience: id,
      received_at: iso,
      expires_at: iso.nullable(),
    }),
  },
  resolve_identity_and_relationships: {
    description: "Return only verified identity bindings and relationships for the ask's participants, and confirm the requested audience is the thread the ask came from. Any mismatch blocks the flow.",
    input: z.strictObject({ ask_id: id, participants: z.array(id).min(1) }),
    output: z.strictObject({
      verified: z.boolean(),
      bindings: z.array(z.strictObject({ person_id: id, display_name: z.string(), role: z.string(), verified_by: id })),
      relationships: z.array(z.strictObject({ relationship_id: id, kind: z.string(), between: z.array(id).length(2), verified_by: id })),
      mismatches: z.array(z.strictObject({ participant: z.string(), reason: z.string() })),
    }),
  },
  get_access_policy: {
    description: "Evaluate the joint-setup policy for this person, purpose, and audience. A denial blocks graph retrieval and the call is never placed.",
    input: z.strictObject({ ask_id: id, person: id, purpose: z.string().min(1), audience: id }),
    output: z.discriminatedUnion("decision", [
      z.strictObject({
        decision: z.literal("granted"),
        policy_token_id: id,
        policy_id: id,
        allowed_source_classes: z.array(sourceClass),
        forbidden_claims: z.array(z.string()),
        expires_at: iso,
        speech: z.strictObject({ pace: z.string(), max_call_minutes: z.number() }),
      }),
      z.strictObject({ decision: z.literal("denied"), reason: z.enum(DENIAL_REASONS), detail: z.string() }),
    ]),
  },
  query_context_graph: {
    description: "Ranked candidate subgraphs with citations for the ask, within max_hops, restricted to allowed sources. Returns citations, not prose. Requires a valid policy token.",
    input: z.strictObject({
      ask_id: id,
      question: z.string(),
      allowed_sources: z.array(sourceClass).min(1),
      max_hops: z.number().int().min(1).max(2).default(2),
      policy_token_id: id,
    }),
    output: z.strictObject({
      candidates: z.array(
        z.strictObject({
          root_id: id,
          root_type: z.string(),
          label: z.string(),
          hops: z.number().int(),
          path_node_ids: z.array(id),
          path_edge_ids: z.array(id),
          citations: z.array(citation),
          rank: z.number().int(),
        }),
      ),
      excluded: z.array(z.strictObject({ node_id: id, reason: z.string() })),
    }),
  },
  verify_claim_support: {
    description: "Check direct evidence, contradictions, freshness, and speaker attribution for each id. Anything unsupported cannot be spoken.",
    input: z.strictObject({ ask_id: id, claim_ids: z.array(id).min(1), policy_token_id: id }),
    output: z.strictObject({
      verified: z.array(z.strictObject({ claim_id: id, citations: z.array(citation).min(1) })),
      rejected: z.array(z.strictObject({ claim_id: id, reason: z.string() })),
      conflicts: z.array(z.strictObject({ a: id, b: id })),
      evidence_mode: z.enum(["full", "current_ask_only"]),
    }),
  },
  assess_conversation_state: {
    description: "Classify one final turn as followed, asked_repeat, no_answer, or answer_present, with the evidence. Observable turn state only: never emotion, cognition, or any judgment of the person.",
    input: z.strictObject({
      ask_id: id,
      audio_window: audioWindow,
      turn_history: z.array(z.strictObject({ turn_id: id, turn_state: z.enum(TURN_STATES) })),
    }),
    output: z.strictObject({
      turn_id: id,
      state: z.enum(TURN_STATES),
      evidence: z.strictObject({
        transcript: z.string(),
        span: span,
        matched_rule: z.string(),
        repair_target: z.enum(REPAIR_TARGETS).nullable(),
        mentioned_option_ids: z.array(id),
        response_latency_ms: z.number().int().nullable(),
      }),
    }),
  },
  select_scaffold: {
    description: "Choose the least support that addresses the observed gap: repeat, name the asker, restate the current options, then one source-backed cue. Records every rejected alternative and why.",
    input: z.strictObject({
      ask_id: id,
      state: z.enum(TURN_STATES),
      repair_target: z.enum(REPAIR_TARGETS).nullable(),
      verified_ids: z.array(id),
      scaffolds_used: z.array(z.enum(SCAFFOLD_IDS)),
    }),
    output: z.strictObject({
      scaffold_id: z.enum(SCAFFOLD_IDS).nullable(),
      citations: z.array(id),
      rejected: z.array(z.strictObject({ scaffold_id: z.enum(SCAFFOLD_IDS), reason: z.string() })),
      decided_by: z.enum(["deterministic_ladder", "muse_spark"]),
    }),
  },
  render_prompt: {
    description: "Verbalize a fixed template using only cited, verified facts. Spoken in Relay's own labeled voice. Never produces speech as the participant.",
    input: z.strictObject({ ask_id: id, scaffold_id: z.enum(PROMPT_KINDS), citations: z.array(id) }),
    output: z.strictObject({
      prompt_id: id,
      kind: z.enum(PROMPT_KINDS),
      voice: z.literal("relay"),
      text: z.string().min(1),
      segments: z.array(z.strictObject({ text: z.string(), kind: z.enum(["connective", "fact"]), citation_ids: z.array(id) })),
      /** A span of her own original recording to play, for the source-backed cue. Played back, never synthesized. */
      play_original: z.strictObject({ asset_id: id, span: span, media_hash: sha256 }).nullable(),
    }),
  },
  capture_exact_contribution: {
    description: "Build the contribution from her exact words: literal transcript plus an edit-decision list limited to silence and disfluency trims. Rejects any interval containing Relay's speech or blocked content. Source audio is never modified.",
    input: z.strictObject({ ask_id: id, audio_intervals: z.array(audioWindow).min(1) }),
    output: z.strictObject({
      contribution_id: id,
      content_hash: sha256,
      speaker_id: id,
      literal_transcript: z.string().min(1),
      words: z.array(word),
      source: z.strictObject({ asset_id: id, sha256: sha256 }),
      intervals: z.array(span),
      trims: z.array(trim),
      kept: z.array(span),
      silence_trims: z.number().int(),
      disfluency_trims: z.number().int(),
      generated_first_person_words: z.literal(0),
      her_words_pct: z.literal(100),
    }),
  },
  request_assent: {
    description: "Play back the exact pending artifact and record her yes, no, or unclear as an audio artifact. Any later change to content or audience invalidates it.",
    input: z.strictObject({ ask_id: id, contribution_hash: sha256, audience: id, audio_window: audioWindow }),
    output: z.strictObject({
      assent_id: id,
      decision: z.enum(["yes", "no", "unclear"]),
      contribution_hash: sha256,
      audience: id,
      transcript: z.string(),
      audio: z.strictObject({ asset_id: id, span: span.nullable(), media_hash: sha256 }),
      recorded_at: iso,
      assent_hash: sha256,
    }),
  },
  publish_contribution: {
    description: "Deliver the contribution to the original thread. Hard-fails unless there is a recorded yes for exactly this hash and destination and a valid policy token.",
    input: z.strictObject({ ask_id: id, hash: sha256, destination: id, policy_token_id: id }),
    output: z.strictObject({
      delivery_id: id,
      contribution_hash: sha256,
      assent_id: id,
      delivered_to: id,
      delivered_at: iso,
    }),
  },
  build_caregiver_receipt: {
    description: "Summarize what Relay made possible in this session, with citations. Describes supports and outcomes. Never a score, rating, or clinical statement about the person.",
    input: z.strictObject({ session_id: id }),
    output: z.strictObject({
      session_id: id,
      outcome: z.string(),
      lines: z.array(
        z.strictObject({
          dimension: z.enum(["social", "emotional", "intellectual"]),
          text: z.string(),
          citations: z.array(z.string()),
        }),
      ),
      supports: z.array(z.strictObject({ scaffold_id: z.string(), trace_seq: z.number().int() })),
      artifact_metrics: z
        .strictObject({
          her_words_pct: z.literal(100),
          generated_first_person_words: z.literal(0),
          silence_trims: z.number().int(),
        })
        .nullable(),
      scaffolds_logged: z.number().int(),
      /** The fixed notice the family's thread gets when nothing was delivered. Null after a delivery. */
      family_notice: z.strictObject({ notice: z.enum(["clarify", "not_this_time"]), text: z.string() }).nullable(),
    }),
  },
} as const;

export type ToolName = keyof typeof contracts;
export const TOOL_NAMES = Object.keys(contracts) as ToolName[];
export type ToolInput<T extends ToolName> = z.input<(typeof contracts)[T]["input"]>;
export type ToolParsedInput<T extends ToolName> = z.output<(typeof contracts)[T]["input"]>;
export type ToolOutput<T extends ToolName> = z.output<(typeof contracts)[T]["output"]>;

/** The enforceable order (AGENTS.md section 6). Index in this list is the tool's step number. */
export const ENFORCED_SEQUENCE: readonly ToolName[] = [
  "inspect_request",
  "resolve_identity_and_relationships",
  "get_access_policy",
  "query_context_graph",
  "verify_claim_support",
  "assess_conversation_state",
  "select_scaffold",
  "render_prompt",
  "capture_exact_contribution",
  "request_assent",
  "publish_contribution",
  "build_caregiver_receipt",
];

/** JSON Schema tool definitions, in the shape model tool interfaces expect. */
export function toolDefinitions(): Array<{ name: ToolName; description: string; input_schema: unknown; output_schema: unknown }> {
  return TOOL_NAMES.map((name) => ({
    name,
    description: contracts[name].description,
    input_schema: z.toJSONSchema(contracts[name].input, { io: "input" }),
    output_schema: z.toJSONSchema(contracts[name].output),
  }));
}
