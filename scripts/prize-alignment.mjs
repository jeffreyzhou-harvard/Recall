#!/usr/bin/env node

/**
 * Internal judge-alignment brief. This is deterministic: it never calls a
 * provider, sends project data anywhere, or invents sponsor evidence.
 */
const targets = [
  { id: "long-lake", name: "Long Lake", title: "Convince a Non-Believer", status: "ready", line: "A skeptic can watch one calm call turn uncertainty into a real, human memory conversation.", roundOne: "Show the patient call first: one familiar topic, one clear cue, and a visible next step.", roundTwo: "Explain the graduated cue ladder, exact-word confirmation, and why the patient is never graded.", proof: ["/revisit", "components/live/CallWaiting.tsx", "lib/orchestrator/run.ts"], avoid: "Do not call it a quiz, a companion, a diagnosis, or a memory score." },
  { id: "openai", name: "OpenAI", title: "OpenAI Challenge (5th Teammate)", status: "evidence-needed", line: "Codex materially reshaped the frontend and helped turn dementia-care research constraints into a provenance-aware knowledge graph; a direct OpenAI API feature still needs evidence before claiming this prize.", roundOne: "If the direct API feature is live, show it in the working demo and name the exact user-visible job it performs.", roundTwo: "Show two or three concrete Codex before/after examples: the frontend redesign, the Impeccable pass, and the research-grounded graph implementation; usage volume alone is not proof.", proof: ["AGENTS.md", "EVIDENCE.md", "DESIGN.md", ".agents/skills/impeccable/SKILL.md", "docs/knowledge-graph.md", "docs/backend-integration.md"], avoid: "Do not present Meta Muse or a generic AI claim as the OpenAI API requirement." },
  { id: "meta", name: "Meta", title: "Bringing People Closer Together with AI", status: "ready-with-proof-note", line: "Recall uses AI to help a person reach her own memories and gives family a reason to call her directly.", roundOne: "Show the patient call, then the caregiver’s quiet, count-level view and connected memory context.", roundTwo: "Explain that Muse Spark proposes graph-grounded cues while Recall’s gates decide what may be spoken or stored.", proof: ["lib/providers/muse/spark.ts", "lib/providers/muse/graph.ts", "app/revisit/page.tsx", "app/caregiver/page.tsx"], avoid: "Do not imply Recall answers for the patient, replaces family calls, or exposes raw words to caregivers." },
  { id: "dropbox", name: "Dropbox", title: "Turn Digital Chaos Into Something Useful", status: "ready", line: "Selected family photos and literal accounts become source-labeled moments, places, stories, and connections a family can use.", roundOne: "Show one upload becoming a moment, a place on the map, and a connected graph neighborhood.", roundTwo: "Explain contributor ownership, provenance, metadata limits, and why this stays a private collection rather than a biography database.", proof: ["components/archive/UploadFlow.tsx", "components/archive/MemoryMap.tsx", "components/archive/MemoryGraph.tsx", "server/family-library.ts"], avoid: "Do not claim Dropbox API integration, automatic face recognition, bulk camera-roll ingestion, or inferred identities." },
  { id: "deepgram", name: "Deepgram", title: "Build Something Worth Talking To", status: "ready-if-live-provider-is-demonstrated", line: "Deepgram supplies the final-turn word timings that let Recall listen patiently and preserve the person’s exact words.", roundOne: "Show a real browser call completing one spoken turn and the resulting literal transcript or confirmation step.", roundTwo: "Name the endpointing, final-turn handling, and timeout fallback; distinguish the live provider from the offline fixture route.", proof: ["lib/providers/deepgram.ts", "server/transcribe.ts", "server/web-call.ts", "docs/backend-integration.md"], avoid: "Do not use the offline /present fixture as proof that the Deepgram API was called." },
  { id: "ramp", name: "Ramp", title: "Save Time. Save Money.", status: "ready", line: "One focused contribution flow saves a caregiver from sorting scattered photos and notes by hand before a conversation.", roundOne: "Show the shortest path: choose photos, add one literal account, save once, and open the resulting collection.", roundTwo: "Explain the single-moment multi-photo write, idempotency, persisted SQLite data, and scoped access checks.", proof: ["components/archive/UploadFlow.tsx", "server/family-library.ts", "server/media.ts"], avoid: "Do not frame Recall as care-management software or promise automatic imports that are not live." },
  { id: "cognition-devin", name: "Cognition", title: "Best Use of Devin", status: "ready-with-artifact", line: "Devin acted as a consistency pass before each frontend push, catching cross-contributor bugs so the Recall UI stayed coherent.", roundOne: "Name the visible product outcome: one consistent patient and caregiver experience across merged frontend work.", roundTwo: "Show a Devin run note, review, or before/after diff that caught a bug before a push and explain the resulting polish.", proof: ["HackMIT 2026 Challenges.pdf", "the team’s Devin run history or review notes (to be attached)"], avoid: "Do not claim Devin use from ordinary editor work; show the pre-push bug-catching artifact." },
];

const required = ["long-lake", "openai", "meta", "dropbox", "deepgram", "ramp", "cognition-devin"];
const args = new Set(process.argv.slice(2));

function check() {
  const ids = targets.map((target) => target.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  const missing = required.filter((id) => !ids.includes(id));
  if (duplicates.length || missing.length || targets.length !== 7) {
    console.error(`Prize alignment failed: expected 7 unique targets; got ${targets.length}.`);
    if (duplicates.length) console.error(`Duplicate: ${duplicates.join(", ")}`);
    if (missing.length) console.error(`Missing: ${missing.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  console.log("Prize alignment OK: 7 targets (Long Lake, OpenAI, Meta, Dropbox, Deepgram, Ramp, Cognition/Devin).");
  console.log(`Direct API evidence needed: ${targets.filter((target) => target.status === "evidence-needed").map((target) => target.name).join(" and ")}.`);
  console.log(`Artifacts to attach: ${targets.filter((target) => target.status === "ready-with-artifact").map((target) => target.name).join(" and ")}.`);
}

function brief() {
  for (const target of targets) console.log(`${target.name} — ${target.line}\n  Round 1: ${target.roundOne}\n  Round 2: ${target.roundTwo}\n  Status: ${target.status}\n`);
}

function prompt() {
  console.log(`You are the internal HackMIT judge-brief editor for Recall. Use only the seven target records below. For each one, write a concise justification with: (1) challenge fit, (2) one visible demo proof, (3) one technical proof, and (4) one honest caveat if evidence is missing. Keep each justification under 55 words. Never invent an API call, sponsor integration, user outcome, or Devin artifact. Preserve Recall’s privacy boundaries: no diagnosis, no cognition score, no generated first-person words, no voice cloning, and no claim that Recall replaces family contact. Keep OpenAI marked evidence-needed until its direct API proof exists, and request the Devin pre-push artifact before final submission.\n\n${JSON.stringify(targets, null, 2)}`);
}

if (args.has("--brief")) brief();
else if (args.has("--prompt")) prompt();
else check();
