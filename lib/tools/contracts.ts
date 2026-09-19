/**
 * The nineteen tool contracts (AGENTS.md section 6), numbered as the brief
 * numbers them.
 *
 * Each schema is the single source for three things: the TypeScript types,
 * runtime validation of every input and output, and the JSON Schema handed to
 * a model's tool interface. Objects are strict: an unknown field is an error,
 * so nothing unvalidated can ride through a tool call.
 *
 * The family-side tools (12, 14, 15, 16) and `confirm_share` (17) have no
 * output field that could hold a claim id, a citation, or a transcript: what a
 * contract cannot express, a tool cannot leak.
 *
 * Tool JSON schemas define the safety gates; changes need a second reviewer
 * (AGENTS.md section 13).
 */
import { z } from "zod";
import { SOURCE_CLASSES } from "@/lib/graph/types";
import { TURN_STATES } from "@/lib/state/machine";
import { DENIAL_REASONS, DETAIL_LEVELS } from "./policy";

const id = z.string().min(1);
const iso = z.iso.datetime();
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const span = z.strictObject({ start_ms: z.number().int().nonnegative(), end_ms: z.number().int().positive() });
const sourceClass = z.enum(SOURCE_CLASSES);
const rung = z.number().int().min(1).max(5);
const scriptLine = z.strictObject({ script_id: id, text: z.string().min(1) });

const citation = z.strictObject({
  node_id: id,
  source_id: id,
  source_class: sourceClass,
  asset_id: z.string().nullable(),
  media_hash: sha256.nullable(),
  span: span.nullable(),
  author: id,
  observed_at: iso,
  patient_confirmed: z.boolean(),
});

const word = z.strictObject({ w: z.string().min(1), start_ms: z.number().int(), end_ms: z.number().int() });
const audioWindow = z.strictObject({ asset_id: id, start_ms: z.number().int().nonnegative(), end_ms: z.number().int().positive() });
const trim = z.strictObject({ kind: z.enum(["silence", "disfluency"]), start_ms: z.number().int(), end_ms: z.number().int() });

/** Something in her turn that is about the call itself rather than the topic. Lexical, from the call script's phrase lists. */
export const CONDUCT_SIGNALS = ["stop_request", "identity_question"] as const;
export const RESPONSE_FORMATS = ["open", "forced_choice", "yes_no"] as const;
export const CUE_KINDS = ["person", "photo", "family_claim"] as const;
export const NOTE_LINE_KINDS = ["warm", "share", "gap", "difference", "pointer"] as const;
export const QUERY_CATEGORIES = ["event", "place", "person", "other"] as const;

export const contracts = {
  get_next_recall_topic: {
    description: "The topic due for a revisit: deterministic ranking by how long since it was last revisited, then by how often it has been told, then by when in her life it is from, then by whether the retrieval layer knows a cue that helps - within the joint setup's allow and block lists. The same memory comes round again, call after call. A model never free-picks a topic.",
    input: z.strictObject({ person_id: id, schedule_context: z.strictObject({ now: iso }) }),
    output: z.strictObject({
      topic: z
        .strictObject({
          topic_id: id,
          topic_type: z.string(),
          label: z.string(),
          spoken_as: z.string(),
          category: z.string(),
          family_sourced: z.boolean(),
          /** False for every autobiographical or identity memory: the last rung never states one outright (AGENTS.md §6.1). */
          reorientation_allowed: z.boolean(),
          last_revisited_at: iso.nullable(),
        })
        .nullable(),
      ranked: z.array(z.strictObject({ topic_id: id, rank: z.number().int(), last_revisited_at: iso.nullable(), times_told: z.number().int(), life_period: z.string().nullable(), has_effective_cue: z.boolean() })),
      excluded: z.array(z.strictObject({ topic_id: id, reason: z.string() })),
      decided_by: z.literal("deterministic_ranking"),
    }),
  },
  place_recall_call: {
    description: "The gate in front of every call: her, only her, only inside the agreed windows and frequency, only about an allowed topic, and only once a family member has attested that the number is saved in her phone and that Relay was introduced to her. A denial means the call is never placed.",
    input: z.strictObject({ person_id: id, topic_id: id, window: z.strictObject({ now: iso }) }),
    output: z.discriminatedUnion("decision", [
      z.strictObject({
        decision: z.literal("granted"),
        policy_token_id: id,
        policy_id: id,
        allowed_source_classes: z.array(sourceClass),
        expires_at: iso,
        speech: z.strictObject({ pace: z.string(), max_call_minutes: z.number() }),
        saved_contact_name: z.string().min(1),
      }),
      z.strictObject({ decision: z.literal("denied"), reason: z.enum(DENIAL_REASONS), detail: z.string() }),
    ]),
  },
  query_context_graph: {
    description: "Ranked candidate subgraph with citations for a topic, within max_hops, restricted to what the joint setup allows. Returns citations, not prose. Requires a valid policy token.",
    input: z.strictObject({ topic_id: id, max_hops: z.number().int().min(1).max(2).default(2), policy_token_id: id }),
    output: z.strictObject({
      candidates: z.array(
        z.strictObject({ root_id: id, root_type: z.string(), label: z.string(), hops: z.number().int(), path_node_ids: z.array(id), path_edge_ids: z.array(id), citations: z.array(citation), rank: z.number().int() }),
      ),
      relations: z.array(z.strictObject({ edge_id: id, from: id, to: id, relation: z.string(), said_as: z.string().nullable() })),
      excluded: z.array(z.strictObject({ node_id: id, reason: z.string() })),
    }),
  },
  verify_claim_support: {
    description: "Check direct evidence, contradictions, freshness, and speaker attribution for each id. Anything unsupported cannot be spoken. Each verified id comes back with who said it and whether she has confirmed it herself.",
    input: z.strictObject({ topic_id: id, claim_ids: z.array(id).min(1), policy_token_id: id }),
    output: z.strictObject({
      verified: z.array(z.strictObject({ claim_id: id, kind: z.enum(["node", "edge"]), speaker: id, patient_confirmed: z.boolean(), citations: z.array(citation).min(1) })),
      rejected: z.array(z.strictObject({ claim_id: id, reason: z.string() })),
      conflicts: z.array(z.strictObject({ a: id, b: id })),
    }),
  },
  assess_conversation_state: {
    description: "Classify one final turn as recalled, asked_repeat, no_answer, or new_detail_offered, with the evidence. Observable turn state only: never emotion, cognition, or any judgment of the person.",
    input: z.strictObject({ topic_id: id, audio_window: audioWindow, turn_history: z.array(z.strictObject({ turn_id: id, turn_state: z.enum(TURN_STATES) })) }),
    output: z.strictObject({
      turn_id: id,
      state: z.enum(TURN_STATES),
      /** True when the window held no speech of hers at all. */
      silent: z.boolean(),
      evidence: z.strictObject({
        transcript: z.string(),
        span: span,
        matched_rule: z.string(),
        /** Verified graph ids her words touched that Relay had not yet said in this call. */
        matched_ids: z.array(id),
        conduct_signal: z.enum(CONDUCT_SIGNALS).nullable(),
        /** What kind of prompt she was answering. Logged beside every reply: a forced choice and an open reply are not equally trustworthy (AGENTS.md §6.2). */
        response_format: z.enum(RESPONSE_FORMATS),
        response_latency_ms: z.number().int().nullable(),
      }),
    }),
  },
  select_scaffold: {
    description: "Choose the least support per the five-rung ladder: free recall, context, association, recognition, reorientation. One rung at a time, each at most once, never above rung 3 for a family-sourced unconfirmed topic, never rung 5 before 1-4, and never rung 5 at all for an autobiographical or identity memory. Records every rejected rung and why. The retrieval layer only ever picks which cue, never whether to climb.",
    input: z.strictObject({ topic_id: id, state: z.enum([...TURN_STATES, "opening"]), verified_ids: z.array(id), rungs_fired: z.array(rung) }),
    output: z.strictObject({
      rung: rung.nullable(),
      scaffold_id: z.string().nullable(),
      slot_ids: z.record(z.string(), id),
      citations: z.array(id),
      cue: z.strictObject({ kind: z.enum(CUE_KINDS), cue_id: id }).nullable(),
      family_sourced_limit: z.boolean(),
      rejected: z.array(z.strictObject({ rung, reason: z.string() })),
      retrieval_hints_used: z.array(z.strictObject({ cue_id: id, effective: z.number().int(), ineffective: z.number().int() })),
      decided_by: z.enum(["deterministic_ladder", "muse_spark"]),
    }),
  },
  render_prompt: {
    description: "Verbalize one reviewed line from the call script. Slots are filled only from the cited, verified graph values named in slot_ids, or from the joint setup. An attribution that does not match the claim's speaker fails closed. Spoken in Relay's own labeled voice; never produces speech as her.",
    input: z.strictObject({ topic_id: id, scaffold_id: id, slot_ids: z.record(z.string(), id), citations: z.array(id) }),
    output: z.strictObject({
      prompt_id: id,
      script_id: id,
      voice: z.literal("relay"),
      text: z.string().min(1),
      rung: rung.nullable(),
      segments: z.array(z.strictObject({ text: z.string(), kind: z.enum(["connective", "fact"]), citation_ids: z.array(id) })),
    }),
  },
  capture_contribution: {
    description: "Build the contribution from her exact words: literal transcript plus an edit-decision list limited to silence and disfluency trims. Rejects any interval containing Relay's speech or blocked content. Source audio is never modified.",
    input: z.strictObject({ topic_id: id, audio_intervals: z.array(audioWindow).min(1) }),
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
  confirm_and_store: {
    description: "Step `confirm`: after the exact captured line has been played back, record her yes, no, or unclear. Step `commit`: write it as a new claim with full provenance - refused unless she said yes to exactly this hash AND the share question has resolved, because commit comes last (section 5). Otherwise nothing is stored.",
    input: z.discriminatedUnion("step", [
      z.strictObject({ step: z.literal("confirm"), contribution_hash: sha256, audio_window: audioWindow }),
      z.strictObject({ step: z.literal("commit"), contribution_hash: sha256, policy_token_id: id }),
    ]),
    output: z.discriminatedUnion("step", [
      z.strictObject({
        step: z.literal("confirm"),
        confirmation_id: id,
        decision: z.enum(["yes", "no", "unclear"]),
        /** She asked to stop instead of answering. Nothing is kept, and the call ends (rule 12). */
        stop_requested: z.boolean(),
        /** A yes/no answer: the format most open to a yes that means no. Her own recording was played back first; that is the check. */
        response_format: z.literal("yes_no"),
        contribution_hash: sha256,
        audio: z.strictObject({ asset_id: id, span: span.nullable(), media_hash: sha256 }),
        recorded_at: iso,
        confirmation_hash: sha256,
      }),
      z.strictObject({
        step: z.literal("commit"),
        claim_id: id,
        contribution_id: id,
        contribution_hash: sha256,
        shared: z.boolean(),
        stored_at: iso,
        edges_written: z.array(id),
      }),
    ]),
  },
  record_retrieval_outcome: {
    description: "Write two independent records of what happened on this topic in this call: the retrieval layer (which cue was offered, and whether she reached the memory after it) and a TopicOutcome event. Read from the reducer's own record of the call, not from the caller. Neither is a score; neither is ever shown as one.",
    input: z.strictObject({ topic_id: id, scaffold_id: z.string().nullable(), state: z.enum([...TURN_STATES, "none"]) }),
    output: z.strictObject({
      /** Null when no rung fired, or the call was stopped or handed off: then only the fact of the call is kept. */
      topic_outcome_id: z.string().nullable(),
      retrieval_record_ids: z.array(id),
      first_rung_reached_unaided: rung.nullable(),
      highest_rung_used: rung.nullable(),
    }),
  },
  receive_family_contribution: {
    description: "The asynchronous capture path. A family member tells Relay a memory; it is stored exactly as typed, as THEIR claim, patient_confirmed false. Text that opens as a question is refused with the fixed hint. Returns nothing from the graph.",
    input: z.strictObject({
      contributor_id: id,
      claim: z.strictObject({ who: z.string().max(200), what_happened: z.string().min(1).max(2000), when_where: z.string().max(200).nullable(), photo_asset_id: z.string().nullable(), about_topic_id: z.string().nullable() }),
      provenance: z.strictObject({ medium: z.enum(["text", "voice_note", "photo"]), received_at: iso }),
    }),
    output: z.discriminatedUnion("status", [
      z.strictObject({ status: z.literal("stored_as_family_claim"), contribution_ref: id, patient_confirmed: z.literal(false), line: scriptLine }),
      z.strictObject({ status: z.literal("rejected_question"), line: scriptLine }),
      z.strictObject({ status: z.literal("refused"), reason: z.enum(["contributor_not_approved", "topic_not_known"]) }),
    ]),
  },
  handle_family_query: {
    description: "Deterministic redirect only (rule 10). Whatever is asked, the reply is the fixed redirect line, or the neutral nothing-yet line. It is built without reading graph content, and only a topic category and a time are logged - never the question.",
    input: z.strictObject({ question: z.string().max(2000), requester_id: id }),
    output: z.strictObject({
      status: z.literal("redirected"),
      line: scriptLine,
      /** Always empty. It is here so the guarantee is visible in the log and on the family-redirect card, not just asserted. */
      graph_content: z.array(z.never()).length(0),
      logged: z.strictObject({ category: z.enum(QUERY_CATEGORIES), at: iso }),
    }),
  },
  build_caregiver_receipt: {
    description: "Summarize one session's observable supports and outcomes. Per-session fields only: no comparison with any other call, no trend, no score, and never a reason inferred about her.",
    input: z.strictObject({ session_id: id }),
    output: z.strictObject({
      session_id: id,
      topic_label: z.string().nullable(),
      outcome: z.string(),
      lines: z.array(z.strictObject({ script_id: id, text: z.string(), citations: z.array(z.string()) })),
      rungs: z.array(z.strictObject({ rung, script_id: z.string(), response_latency_ms: z.number().int().nullable(), trace_seq: z.number().int() })),
      artifact_metrics: z.strictObject({ her_words_pct: z.literal(100), generated_first_person_words: z.literal(0), silence_trims: z.number().int() }).nullable(),
      stored: z.boolean(),
      shared: z.boolean(),
      safety_alert_sent: z.boolean(),
    }),
  },
  build_weekly_note: {
    description: "Assemble the Weekly Note for one approved member (section 6.4.2): at most one per 7 days, fixed section order, fixed lines, and her own words only if she confirmed sharing them. Reads only through the whitelist projection. Shown on the dashboard; never pushed.",
    input: z.strictObject({ member_id: id, week: z.strictObject({ now: iso }) }),
    output: z.strictObject({
      status: z.enum(["posted", "cap_reached", "nothing_to_post", "no_access"]),
      note: z
        .strictObject({
          posted_at: iso,
          lines: z.array(
            z.strictObject({
              kind: z.enum(NOTE_LINE_KINDS),
              script_id: id,
              text: z.string().min(1),
              /** Only on a `share` line: whose words these are, when she confirmed sharing them, and the hash of what she heard played back. */
              attribution: z.strictObject({ speaker_name: z.string(), share_confirmed_at: iso, content_hash: sha256 }).nullable(),
            }),
          ),
        })
        .nullable(),
    }),
  },
  get_topic_record: {
    description: "The per-topic record and any change lines (sections 6.4.3 and 6.4.4): topic names, counts, and dates only, under the fixed header. No total, no ordering by concern. Reads only TopicOutcome through the whitelist projection; cannot read claims or transcripts.",
    input: z.strictObject({ member_id: id }),
    output: z.strictObject({
      status: z.enum(["ok", "no_access"]),
      header: scriptLine.nullable(),
      topics: z.array(z.strictObject({ topic_name: z.string(), calls_counted: z.number().int(), last_call_on: z.iso.date().nullable(), lines: z.array(scriptLine) })),
      change_lines: z.array(scriptLine),
      summary_line: scriptLine.nullable(),
    }),
  },
  export_record_for_clinician: {
    description: "An approved member asks for a file of the same per-topic counts, dates, change lines, and fixed header, plus the fixed non-clinical note. Logged. Relay never sends it to anyone: it is handed back to the member who asked.",
    input: z.strictObject({ requester_id: id }),
    output: z.strictObject({
      status: z.enum(["exported", "refused"]),
      file: z.strictObject({ filename: z.string(), generated_at: iso, text: z.string().min(1) }).nullable(),
    }),
  },
  confirm_share: {
    description: "After the share question, record her yes, no, unclear, or no answer in time. Only on yes may the line ever appear in a Weekly Note. It never blocks storing. The output carries her decision and nothing she said.",
    input: z.strictObject({ contribution_hash: sha256, audio_window: audioWindow.nullable() }),
    output: z.strictObject({
      share_confirmation_id: id,
      decision: z.enum(["yes", "no", "unclear", "timeout"]),
      stop_requested: z.boolean(),
      response_format: z.literal("yes_no"),
      contribution_hash: sha256,
      recorded_at: iso,
      confirmation_hash: sha256,
    }),
  },
  check_safety_phrases: {
    description: "Deterministic lexical match of her final turn against the fixed safety list. Runs first on every final turn of hers, before anything else. Never a model judgment; never applied to Relay's own speech. Returns a category or none - not her words.",
    input: z.strictObject({ audio_window: audioWindow }),
    output: z.strictObject({ turn_id: z.string().nullable(), category: z.string().nullable() }),
  },
  send_safety_alert: {
    description: "Send the fixed alert text for the category, through the channel chosen in the joint setup, to the designated caregivers only. At most once per category per call. Category and time, never her words or audio. Logs a SafetyEvent.",
    input: z.strictObject({ category: id, caregiver_ids: z.array(id).min(1) }),
    output: z.strictObject({
      sent: z.array(z.strictObject({ alert_id: id, caregiver_id: id, channel: z.string(), script_id: id })),
      skipped: z.array(z.strictObject({ caregiver_id: id, reason: z.enum(["not_a_designated_caregiver", "already_alerted_this_call"]) })),
      safety_event_id: z.string().nullable(),
    }),
  },
} as const;

export type ToolName = keyof typeof contracts;
export const TOOL_NAMES = Object.keys(contracts) as ToolName[];
export type ToolInput<T extends ToolName> = z.input<(typeof contracts)[T]["input"]>;
export type ToolParsedInput<T extends ToolName> = z.output<(typeof contracts)[T]["input"]>;
export type ToolOutput<T extends ToolName> = z.output<(typeof contracts)[T]["output"]>;
export type DetailLevelName = (typeof DETAIL_LEVELS)[number];

/** The family flows. They never enter the call sequence, and they run on a context that has no graph in it. */
export const FAMILY_TOOLS = ["receive_family_contribution", "handle_family_query", "build_weekly_note", "get_topic_record", "export_record_for_clinician"] as const;
export type FamilyToolName = (typeof FAMILY_TOOLS)[number];
export type CallToolName = Exclude<ToolName, FamilyToolName>;
export const isFamilyTool = (tool: ToolName): tool is FamilyToolName => (FAMILY_TOOLS as readonly string[]).includes(tool);

/**
 * The enforceable order of a call (AGENTS.md section 6). Index in this list is the tool's step number.
 * `check_safety_phrases` runs first on every final turn of hers, ahead of everything from step 5 on.
 */
export const ENFORCED_SEQUENCE: readonly CallToolName[] = [
  "get_next_recall_topic",
  "place_recall_call",
  "query_context_graph",
  "verify_claim_support",
  "check_safety_phrases",
  "assess_conversation_state",
  "select_scaffold",
  "render_prompt",
  "capture_contribution",
  "confirm_and_store",
  "confirm_share",
  "record_retrieval_outcome",
  "build_caregiver_receipt",
  "send_safety_alert",
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
