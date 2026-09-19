/**
 * Test-only data. None of this is on the judged path, so none of it lives in
 * /fixtures or /assets. Branch calls are derived from the golden transcript
 * rather than stored, so there is one recording's worth of words to maintain.
 */
import { DIWALI_FORWARD, GOLDEN_TRANSCRIPT, MANIFEST } from "@/fixtures";
import type { SeedFile } from "@/lib/graph/seed";
import type { AssetManifest } from "@/lib/provenance/assets";
import type { CallTranscript, Turn } from "@/lib/providers/transcription";

export const THREAD = "artifact:thread-family";
export const CALL = "call-golden";

export const goldenTurn = (id: string): Turn => {
  const turn = GOLDEN_TRANSCRIPT.turns.find((t) => t.turn_id === id);
  if (!turn) throw new Error(`no turn ${id}`);
  return structuredClone(turn);
};

export const diwaliForward = (change: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...(DIWALI_FORWARD as Record<string, unknown>),
  ...change,
});

/** An ask about a topic the joint setup blocked. The call must never be placed. */
export const BLOCKED_TOPIC_FORWARD = diwaliForward({
  forward_id: "fwd-house-money",
  text: "Mom, what should we do about the house money?",
  photos: [],
});

// --- derived calls ---------------------------------------------------------------

const line = (speaker: Turn["speaker"], id: string, start: number, end: number, text: string): Turn => {
  const words = text.split(" ");
  const step = (end - start) / words.length;
  return {
    turn_id: id,
    speaker,
    start_ms: start,
    end_ms: end,
    is_final: true,
    words: words.map((w, i) => ({ w, start_ms: Math.round(start + i * step), end_ms: Math.round(start + (i + 1) * step) - 10 })),
  };
};
const relayLine = (id: string, start: number, end: number, text: string): Turn => line("relay", id, start, end, text);
const herLine = (id: string, start: number, end: number, text: string): Turn => line("participant", id, start, end, text);
const silence = (id: string, start: number, end: number): Turn => ({ turn_id: id, speaker: "participant", start_ms: start, end_ms: end, is_final: true, words: [] });
const call = (turns: Turn[]): CallTranscript => ({ ...GOLDEN_TRANSCRIPT, note: "derived in tests", turns });

/** The golden call, except she gives no reply when asked to approve. */
export const unclearAssentCall = (): CallTranscript =>
  call([...["r1", "p1", "r2", "p2", "r3", "pb1"].map(goldenTurn), silence("p3", 36200, 37200)]);

/** The golden call, except her reply to "want me to send that?" is whatever `reply` says. */
export const assentReplyCall = (reply: string): CallTranscript =>
  call([...["r1", "p1", "r2", "p2", "r3", "pb1"].map(goldenTurn), herLine("p3", 36200, 37800, reply)]);

/** After the re-anchor there is no reply: a second lost-thread signal, then the gentle wrap-up line. */
export const doubleLostCall = (): CallTranscript =>
  call([...["r1", "p1", "r2"].map(goldenTurn), silence("p2", 16500, 19500), relayLine("r3", 21000, 25200, "That's alright. We can come back to this another time.")]);

/** A tool times out after the first lost-thread signal: the brief again, once, then the closing line. */
export const toolTimeoutCall = (): CallTranscript =>
  call([
    ...["r1", "p1"].map(goldenTurn),
    relayLine("r2", 9800, 13000, "Anika wants your help with Diwali dessert."),
    relayLine("r3", 15000, 17600, "Thank you. We'll talk again soon."),
  ]);

// --- seed overlays ---------------------------------------------------------------

const noteSource = (over: Partial<SeedFile["sources"][string]> = {}): SeedFile["sources"][string] => ({
  source_class: "prior_claim_with_source",
  asset_id: null,
  observed_at: "2026-03-02T18:00:00.000Z",
  author: "person:mom",
  extraction_method: "forwarded_message",
  confidence: 1,
  audience_scope: [THREAD],
  expires_at: null,
  ...over,
});

/** A synthetic manifest entry: tests need a hash to cite, not a file to play. */
export const manifestWith = (...assets: Array<{ id: string; duration_ms: number }>): AssetManifest => ({
  ...MANIFEST,
  assets: [
    ...MANIFEST.assets,
    ...assets.map(({ id, duration_ms }, i) => ({
      id,
      path: `(test only) ${id}`,
      kind: "audio" as const,
      sha256: String(i + 1).repeat(64).slice(0, 64),
      bytes: 1,
      duration_ms,
      status: "placeholder" as const,
      description: "synthetic test asset",
    })),
  ],
});

/** A second source-backed claim that contradicts the first. Relay must use neither. */
export const CONFLICTING_CLAIMS: SeedFile = {
  version: 1,
  description: "test: contradicting claim",
  sources: { "artifact:clip-alt": noteSource({ asset_id: "clip-alt", extraction_method: "literal_transcript", observed_at: "2024-10-30T21:40:00.000Z" }) },
  nodes: [
    { id: "artifact:clip-alt", type: "Artifact", label: "Another clip about kheer", props: { kind: "audio", text: null, alt: null }, source: "artifact:clip-alt" },
    { id: "claim:cardamom-first", type: "EpisodicClaim", label: "cardamom goes in first", props: { text: "cardamom goes in first" }, source: "artifact:clip-alt", span: { start_ms: 1200, end_ms: 3400 }, contradicts: ["claim:cardamom-last"] },
  ],
  edges: [
    { type: "SPOKEN_BY", from: "claim:cardamom-first", to: "person:mom", source: "artifact:clip-alt" },
    { type: "EVIDENCE_FOR", from: "artifact:clip-alt", to: "claim:cardamom-first", source: "artifact:clip-alt" },
    { type: "ABOUT", from: "claim:cardamom-first", to: "topic:kheer", source: "artifact:clip-alt" },
    { type: "CONTRADICTS", from: "claim:cardamom-first", to: "claim:cardamom-last", source: "artifact:clip-alt" },
    { type: "PERMITTED_IN", from: "artifact:clip-alt", to: "policy:mom-default", source: "artifact:clip-alt" },
  ],
};
export const CONFLICT_MANIFEST = manifestWith({ id: "clip-alt", duration_ms: 5000 });

const note = (id: string, text: string, topic: string, permitted: boolean): Pick<SeedFile, "nodes" | "edges"> => ({
  nodes: [
    { id: `artifact:note-${id}`, type: "Artifact", label: `note ${id}`, props: { kind: "message", text, alt: null }, source: `artifact:note-${id}` },
    { id: `claim:${id}`, type: "EpisodicClaim", label: text, props: { text }, source: `artifact:note-${id}` },
  ],
  edges: [
    { type: "EVIDENCE_FOR", from: `artifact:note-${id}`, to: `claim:${id}`, source: `artifact:note-${id}` },
    { type: "ABOUT", from: `claim:${id}`, to: topic, source: `artifact:note-${id}` },
    ...(permitted ? [{ type: "PERMITTED_IN" as const, from: `artifact:note-${id}`, to: "policy:mom-default", source: `artifact:note-${id}` }] : []),
  ],
});
const controls = [note("expired", "use the wide pan for kheer", "topic:kheer", true), note("other-audience", "halwa needs patience", "topic:halwa", true), note("unpermitted", "kheer is better cold", "topic:kheer", false)];

/** Three claims two hops from the ask that must never be retrieved: expired, wrong audience, artifact not permitted. */
export const NEGATIVE_CONTROLS: SeedFile = {
  version: 1,
  description: "test: negative controls",
  sources: {
    "artifact:note-expired": noteSource({ expires_at: "2026-02-10T18:00:00.000Z" }),
    "artifact:note-other-audience": noteSource({ audience_scope: ["person:anika"] }),
    "artifact:note-unpermitted": noteSource(),
  },
  nodes: controls.flatMap((c) => c.nodes),
  edges: controls.flatMap((c) => c.edges),
};
