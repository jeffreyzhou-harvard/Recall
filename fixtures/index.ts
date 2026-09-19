/**
 * The judged path's data, statically imported: no filesystem and no fetch, so
 * it bundles into the page and runs with the network off.
 *
 * That is all that lives here - seven data files:
 *
 *   graph/family.json          what Susan and her family have told Relay, with who said it and when,
 *                              and Relay's record of earlier calls
 *   policy/susan-setup.json    the joint setup: what she and her family agreed
 *   call-script.json           every fixed line Relay can say, with script ids, and the banned-phrase list
 *   family-copy.json           every fixed line the family side can show
 *   record-thresholds.json     every number the per-topic record uses
 *   safety-phrases.json        the fixed safety list and the fixed alert text
 *   transcripts/call-golden    the literal, time-aligned transcript of the prerecorded call
 *
 * Failure-branch data (a revoked topic, conflicting accounts, an unclear yes...) exists only to exercise
 * the gates and lives with the tests, not here.
 */
import manifestJson from "@/assets/manifest.json";
import { familyCopySchema, recordThresholdsSchema, type FamilyCopy, type RecordThresholds } from "@/lib/family/copy";
import type { SeedFile } from "@/lib/graph/seed";
import type { AssetManifest } from "@/lib/provenance/assets";
import type { CallTranscript } from "@/lib/providers/transcription";
import { safetyPhrasesSchema, type SafetyPhrases } from "@/lib/safety/phrases";
import { callScriptSchema, type CallScript } from "@/lib/script/call-script";
import type { ToolName } from "@/lib/tools";
import callScript from "./call-script.json";
import familyCopy from "./family-copy.json";
import family from "./graph/family.json";
import susanSetup from "./policy/susan-setup.json";
import recordThresholds from "./record-thresholds.json";
import safetyPhrases from "./safety-phrases.json";
import callGolden from "./transcripts/call-golden.json";

export const MANIFEST = manifestJson as AssetManifest;
export const FAMILY_SEED = family as SeedFile;
/** Validated by `policySchema` when a run is built, never trusted as typed. */
export const POLICY: unknown = susanSetup;
export const GOLDEN_TRANSCRIPT = callGolden as CallTranscript;
// Parsed once, here: a fixture that does not match its schema fails the moment anything imports it.
export const CALL_SCRIPT: CallScript = callScriptSchema.parse(callScript);
export const FAMILY_COPY: FamilyCopy = familyCopySchema.parse(familyCopy);
export const RECORD_THRESHOLDS: RecordThresholds = recordThresholdsSchema.parse(recordThresholds);
export const SAFETY_PHRASES: SafetyPhrases = safetyPhrasesSchema.parse(safetyPhrases);

/** Timing for the deterministic replay: 10:30 on a Thursday morning in New York, inside the agreed call window (mornings: EVIDENCE.md, section E). */
export const JUDGED_TIMING: {
  start_at: string;
  call_connect_delay_ms: number;
  tool_latency_ms: { default: number } & Partial<Record<ToolName, number>>;
} = {
  start_at: "2026-11-05T15:30:00.000Z",
  call_connect_delay_ms: 2000,
  tool_latency_ms: { default: 40, query_context_graph: 120, verify_claim_support: 90 },
};
