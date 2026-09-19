/**
 * The judged path's data, statically imported: no filesystem and no fetch, so
 * it bundles into the page and runs with the network off.
 *
 * That is all that lives here - four data files:
 *
 *   graph/family.json          the people, the joint setup, public topic names, one source-backed claim
 *   policy/mom-default.json    what the family agreed
 *   asks/diwali.json           the forwarded ask, exactly as a bridge would hand it to intake
 *   transcripts/call-golden    the literal, time-aligned transcript of the prerecorded call
 *
 * The ask's graph nodes are not written by hand: intake builds them from the
 * forwarded payload, the same way it would for a real forward. Failure-branch
 * data (blocked topics, conflicting claims, unclear assent...) exists only to
 * exercise the gates and lives with the tests, not here.
 */
import manifestJson from "@/assets/manifest.json";
import type { SeedFile } from "@/lib/graph/seed";
import type { AssetManifest } from "@/lib/provenance/assets";
import type { CallTranscript } from "@/lib/providers/transcription";
import type { ToolName } from "@/lib/tools";
import diwaliAsk from "./asks/diwali.json";
import family from "./graph/family.json";
import momDefault from "./policy/mom-default.json";
import callGolden from "./transcripts/call-golden.json";

export const MANIFEST = manifestJson as AssetManifest;
export const FAMILY_SEED = family as SeedFile;
/** Validated by `policySchema` when a run is built, never trusted as typed. */
export const POLICY: unknown = momDefault;
/** Validated by `forwardedAskSchema` at intake, never trusted as typed. */
export const DIWALI_FORWARD: unknown = diwaliAsk;
export const GOLDEN_TRANSCRIPT = callGolden as CallTranscript;

/** Timing for the deterministic replay. The clock starts a few minutes after the forward arrives. */
export const JUDGED_TIMING: {
  start_at: string;
  call_connect_delay_ms: number;
  tool_latency_ms: { default: number } & Partial<Record<ToolName, number>>;
} = {
  start_at: "2026-11-05T17:30:00.000Z",
  call_connect_delay_ms: 2000,
  tool_latency_ms: { default: 40, query_context_graph: 120, verify_claim_support: 90 },
};
