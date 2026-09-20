# Recall prize alignment

This is the short judge briefing for the seven submissions listed in the Plume project. Use the same order in every conversation: show the working human moment, name the sponsor fit, then give one technical proof. The first round should understand the product in under 20 seconds. The deeper round should see one concrete implementation detail and one honest boundary.

The product sentence is: **Recall helps a person reach her own memories through a gentle, graduated voice conversation, then gives family a private reason to call her directly.**

| Target | What to say | What to show | Evidence status |
| --- | --- | --- | --- |
| Long Lake — Convince a Non-Believer | “A skeptic can watch one calm call turn uncertainty into a real memory conversation.” | Patient call first, then the caregiver view. | Ready |
| OpenAI — 5th Teammate | “Codex materially reshaped the frontend and helped turn dementia-care research constraints into a provenance-aware knowledge graph; the direct OpenAI API feature must be shown before we claim this.” | The actual API feature plus two or three concrete Codex before/afters: frontend redesign, Impeccable pass, and research-grounded graph implementation. | Evidence needed |
| Meta — Bringing People Closer | “AI helps her reach her own memories and gives family a reason to call her directly.” | Call → quiet caregiver record → connected context. | Ready with provider proof |
| Dropbox — Turn Digital Chaos Useful | “Selected photos and literal accounts become source-labeled moments, places, stories, and connections.” | Upload → moment → map → graph neighborhood. | Ready |
| Deepgram — Worth Talking To | “Deepgram supplies final-turn timings so Recall can wait, listen, and preserve exact words.” | A real browser turn and its literal transcript/confirmation. | Ready if live provider is demonstrated |
| Ramp — Save Time / Money | “One focused contribution flow replaces manual sorting before a family conversation.” | Choose photos → add account → save once → collection. | Ready |
| Cognition — Best Use of Devin | “Devin caught consistency bugs before each frontend push, helping keep one coherent patient and caregiver experience across contributors.” | Devin review/run evidence plus the before/after diff. | Ready once artifact is attached |

## Two-round talk track

**Round 1:** “This is Recall. It calls a person with dementia and gently helps her reach a familiar memory in her own words. The family contributes context, but the system routes them back to one another instead of answering for her.” Then show the live call beat and the caregiver collection/graph beat.

**Round 2:** Explain the exact sponsor proof for that judge. Show the provider boundary, the graph provenance, the confirmation gate, or the contribution write. If a requirement is not yet demonstrable, say so plainly and name the artifact still needed.

## Guardrails for every teammate

- Say **“graduated recall support”** or **“gentle memory conversation,”** not a quiz, test, diagnosis, or memory score.
- Do not call Recall a companion, digital replica, or family Q&A database.
- Do not claim automatic face recognition, Dropbox integration, bulk camera-roll ingestion, or OpenAI API usage without direct evidence. For Cognition, attach Devin’s pre-push bug-catching evidence.
- The patient’s words remain hers. Family sees only the permitted count-level record and any line she explicitly chose to share.
- The attached graph image is a visual reference for the caregiver surface; it is not evidence of a generated or inferred family relationship.
- For OpenAI, show Codex’s role directly: architecture, implementation, tests, and the Impeccable design workflow. Keep that separate from the still-required direct OpenAI API proof.
- The strongest Codex story is material change: the frontend was substantially reshaped, and research constraints became graph provenance and guardrails. Bring the relevant diffs and research/design notes.
- The team’s heavy Codex use is context, not the proof. Pick two or three representative changes that clearly show what Codex enabled and what improved.

## Evidence map

- Patient call: `/revisit`, `components/live/CallWaiting.tsx`, `server/web-call.ts`.
- Deepgram boundary: `lib/providers/deepgram.ts`, `server/transcribe.ts`.
- Meta/Muse boundary: `lib/providers/muse/spark.ts`, `lib/providers/muse/graph.ts`, `server/recall-live.ts`.
- Photo collection: `components/archive/UploadFlow.tsx`, `components/archive/MemoryMap.tsx`, `components/archive/MemoryGraph.tsx`, `server/family-library.ts`.
- Privacy and current product rules: `AGENTS.md`, `SPECS.md`, `docs/backend-integration.md`.

Run `npm run prizes:check` before the team sync. Run `npm run prizes:brief` for the compact spoken version, or `npm run prizes:prompt` to give an AI the bounded source record for a fresh, evidence-checked draft.
