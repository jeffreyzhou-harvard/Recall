/**
 * What a tool implementation can reach. Everything is injected, so the judged
 * path (fixtures, in-memory graph, fixture clock) and the live side demo run
 * the exact same tool code.
 *
 * There are two contexts on purpose. A call tool gets the graph. A family tool
 * gets a `FamilyView` - a whitelist projection - and NOTHING that can read a
 * claim, a transcript, or a citation (AGENTS.md section 6, tools 14-17). The
 * leak guarantee is this type, not a filter that could fail.
 */
import type { Clock } from "@/lib/clock";
import type { FamilyCopy, RecordThresholds, SafetyThresholds } from "@/lib/family/copy";
import type { FamilyView } from "@/lib/family/projection";
import type { CandidateSubgraph, RelationFact } from "@/lib/graph/retrieval";
import type { GraphStore } from "@/lib/graph/store";
import type { AssetIndex } from "@/lib/provenance/assets";
import type { ProvLog } from "@/lib/provenance/prov-log";
import type { TranscriptionProvider } from "@/lib/providers/transcription";
import type { AlertChannel } from "@/lib/safety/alert";
import type { SafetyPhrases } from "@/lib/safety/phrases";
import type { CallScript } from "@/lib/script/call-script";
import type { MachineState } from "@/lib/state/reducer";
import type { ToolOutput } from "./contracts";
import type { GateKeeper, VerifiedEvidence } from "./gates";
import type { SetupStore } from "./policy";

/**
 * Accessibility telemetry, and only that (rule 8): how long a reply took, and which rung fired.
 * Nothing here describes her; it describes how well Recall's support fit.
 */
export interface AccessibilityTelemetry {
  response_latencies_ms: number[];
  rungs_fired: Array<{ rung: number; script_id: string; latency_after_ms: number | null }>;
}

/** Layer 3: ephemeral session state. Discarded at call end except what she confirmed. */
export interface SessionRecord {
  session_id: string;
  call_asset_id: string | null;
  started_at: string | null;
  topic: NonNullable<ToolOutput<"get_next_recall_topic">["topic"]> | null;
  policy_token_id: string | null;
  candidates: CandidateSubgraph[];
  relations: RelationFact[];
  verified: VerifiedEvidence[];
  /** Everything rendered, including fixed lines prepared before the call that may never be needed. */
  prompts: Array<ToolOutput<"render_prompt">>;
  /** What Recall actually said, in order. This - not `prompts` - is what any "what Recall said" view must read. */
  spoken: Array<{ prompt_id: string; script_id: string; rung: number | null; text: string; at: string }>;
  assessments: Array<ToolOutput<"assess_conversation_state">>;
  contribution: ToolOutput<"capture_contribution"> | null;
  store_confirmation: Extract<ToolOutput<"confirm_and_store">, { step: "confirm" }> | null;
  share_confirmation: ToolOutput<"confirm_share"> | null;
  stored: Extract<ToolOutput<"confirm_and_store">, { step: "commit" }> | null;
  telemetry: AccessibilityTelemetry;
  /** Category only. Never her words (rule 8). */
  safety_category: string | null;
  safety_alert_sent: boolean;
  /** What the last recognition rung offered, so her reply can be read against it. Set by `select_scaffold`. */
  last_recognition: { correct_edge_id: string; other_edge_id: string } | null;
  /** Set when unconfirmed call audio was dropped at call end. */
  unconfirmed_audio_discarded: boolean;
}

export function newSession(sessionId: string): SessionRecord {
  return {
    session_id: sessionId,
    call_asset_id: null,
    started_at: null,
    topic: null,
    policy_token_id: null,
    candidates: [],
    relations: [],
    verified: [],
    prompts: [],
    spoken: [],
    assessments: [],
    contribution: null,
    store_confirmation: null,
    share_confirmation: null,
    stored: null,
    telemetry: { response_latencies_ms: [], rungs_fired: [] },
    safety_category: null,
    safety_alert_sent: false,
    last_recognition: null,
    unconfirmed_audio_discarded: false,
  };
}

/** What `select_scaffold` shows an advisor: the rung the ladder already decided on, and the only cues on offer for it. */
export interface ScaffoldAdvice {
  rung: number;
  what_she_said: string;
  /** Each with the verified ids it would cite. The advisor may choose among these and nothing else. */
  eligible: Array<{ scaffold_id: string; cue_id: string; citations: string[]; what_it_does: string }>;
}
export interface ScaffoldChoice {
  cue_id: string;
  citations: string[];
}
/**
 * Optional, live only (Muse Spark). It never decides whether to climb, or to which rung - the ladder does
 * that. It may pick WHICH cue when the retrieval layer has no preference. Its pick is re-checked; anything
 * not on offer falls back to the deterministic choice.
 */
export type ScaffoldAdvisor = (advice: ScaffoldAdvice) => Promise<ScaffoldChoice>;

export interface ToolContext {
  graph: GraphStore;
  setup: SetupStore;
  assets: AssetIndex;
  clock: Clock;
  gate: GateKeeper;
  transcription: TranscriptionProvider;
  session: SessionRecord;
  prov: ProvLog;
  script: CallScript;
  /** The receipt's fixed lines live with the rest of the family-side copy. */
  copy: FamilyCopy;
  safetyPhrases: SafetyPhrases;
  safetyThresholds: SafetyThresholds;
  /** The one way anything is ever sent to family: a fixed-text safety alert to the designated caregivers (rule 15). */
  alerts: AlertChannel;
  /** The reducer's state so far. Read-only. */
  machine: () => MachineState;
  scaffoldAdvisor?: ScaffoldAdvisor;
}

/** Everything a family-side tool can touch. There is no graph here, by design. */
export interface FamilyToolContext {
  view: FamilyView;
  /** To hash a photo a family member attaches. Media only: there are no words in here. */
  assets: AssetIndex;
  setup: SetupStore;
  clock: Clock;
  script: CallScript;
  copy: FamilyCopy;
  thresholds: RecordThresholds;
  safetyThresholds: SafetyThresholds;
}
