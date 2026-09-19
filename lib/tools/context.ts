/**
 * What a tool implementation can reach. Everything is injected, so the judged
 * path (fixtures, in-memory graph, fixture clock) and the live side demo run
 * the exact same tool code.
 */
import type { ThreadBridge } from "@/lib/bridge/thread-bridge";
import type { Clock } from "@/lib/clock";
import type { CandidateSubgraph } from "@/lib/graph/retrieval";
import type { GraphStore } from "@/lib/graph/store";
import type { AssetIndex } from "@/lib/provenance/assets";
import type { ProvLog } from "@/lib/provenance/prov-log";
import type { TranscriptionProvider } from "@/lib/providers/transcription";
import type { MachineState } from "@/lib/state/reducer";
import type { PromptKind, ScaffoldId, ToolOutput } from "./contracts";
import type { GateKeeper } from "./gates";
import type { AccessPolicy } from "./policy";

/**
 * Accessibility telemetry, and only that (rule 8): how long a reply took,
 * how often the thread was lost, which scaffold fired. Nothing here describes
 * her; it describes how well Relay's support fit.
 */
export interface AccessibilityTelemetry {
  response_latencies_ms: number[];
  thread_loss_events: number;
  scaffolds_fired: ScaffoldId[];
}

/** Layer 3: ephemeral session state. Discarded at call end except what she approved. */
export interface SessionRecord {
  session_id: string;
  call_asset_id: string | null;
  ask: ToolOutput<"inspect_request"> | null;
  policy_token_id: string | null;
  candidates: CandidateSubgraph[];
  /** Everything rendered, including fixed-script lines prepared before the call that may never be needed. */
  prompts: Array<ToolOutput<"render_prompt">>;
  /** What Relay actually said, in order. This - not `prompts` - is what any "what Relay said" view must read. */
  spoken: Array<{ prompt_id: string; kind: PromptKind; text: string; at: string }>;
  assessments: Array<ToolOutput<"assess_conversation_state">>;
  contribution: ToolOutput<"capture_exact_contribution"> | null;
  assent: ToolOutput<"request_assent"> | null;
  delivery: ToolOutput<"publish_contribution"> | null;
  telemetry: AccessibilityTelemetry;
  /** Set when unapproved call audio was dropped at call end. */
  unapproved_audio_discarded: boolean;
}

export function newSession(sessionId: string): SessionRecord {
  return {
    session_id: sessionId,
    call_asset_id: null,
    ask: null,
    policy_token_id: null,
    candidates: [],
    prompts: [],
    spoken: [],
    assessments: [],
    contribution: null,
    assent: null,
    delivery: null,
    telemetry: { response_latencies_ms: [], thread_loss_events: 0, scaffolds_fired: [] },
    unapproved_audio_discarded: false,
  };
}

export interface ToolContext {
  graph: GraphStore;
  policy: AccessPolicy;
  assets: AssetIndex;
  clock: Clock;
  gate: GateKeeper;
  transcription: TranscriptionProvider;
  session: SessionRecord;
  prov: ProvLog;
  /** The only way anything reaches the family. Refuses any message that is not a reply to a received forward. */
  bridge: ThreadBridge;
  /** The reducer's state so far. Read-only view for the caregiver receipt. */
  machine: () => MachineState;
}
