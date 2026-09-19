# AGENTS.md - Relay (HackMIT 2026)

This file is the complete brief for any coding agent (Claude Code, Codex, Cursor) working in this repository. You do not need chat history. If this file and your instincts disagree, this file wins. If this file is silent, ask before expanding scope.

The end-to-end product flow - surfaces, gates, and every stop node - is drawn in `Rabbit_Product_Flow_Design_Spec.md` ("Rabbit" there is this product, Relay). The code is organized to match it; section 8 maps each node to where it lives.

## 1. Product thesis

Most dementia products help families care for the person. Relay helps the person keep caring for the family.

Relay is an adaptive participation layer for one live, current family interaction. A relative forwards a current question from the family group chat. Relay calls the person (Mom) on an ordinary phone, adaptively helps her stay on the thread without supplying an opinion, captures her exact words, gets her explicit assent, and delivers her verbatim contribution back into the family's existing thread with a full provenance receipt.

Demo thesis line: **Access changed. Authorship didn't.**

Relay is NOT a memory archive, a companion app, a reminiscence tool, or a simulated persona. Remento, Kin, KindredMind, and Memry already own those. The wedge is live contribution to a current family decision, while the person is here.

## 2. Non-negotiables (override every other instruction)

These rules exist because the user is a real person with reduced capacity to audit what is sent in her name. Violating any of them is a build-stopping bug.

1. **Zero generated first-person words.** Never write, polish, paraphrase, or synthesize text or speech as Mom. Outbound artifacts contain only her recorded words. The only permitted edit is silence/disfluency trimming, listed explicitly.
2. **No voice cloning.** Her audio is played back, never synthesized. If Relay speaks prompts, that voice is clearly labeled as Relay, never as her or a family member.
3. **Assent gates delivery.** Nothing publishes without her recorded yes to the exact artifact and exact audience. Any content or audience change invalidates assent. Unclear assent means nothing sends.
4. **No inferred clinical or emotional state.** The system never produces diagnosis, disease stage, mood, competence, or cognition scores. `assess_conversation_state` emits observable turn states only. The caregiver receipt describes what Relay made possible, never rates her.
5. **No autonomous outreach.** Relay only acts on a forwarded ask from an approved person. It never initiates contact with the family on her behalf.
6. **Evidence-bounded speech.** Relay may verbalize only facts with citations returned by `verify_claim_support`. No citations, no speech.
7. **Hard fail on missing gates.** If identity, policy, evidence, or assent is missing or mismatched, the flow stops. A safe narrowing ("I don't have enough context to answer that for you. I can ask Anika to clarify.") is a success state, not an error to route around.
8. **Data minimization.** Ingest only: the forwarded ask (text + one photo + asker identity), the one-time joint setup (approved people, call windows, topic allow/block lists, speech pace, max call length, review requirements), and from each call only the approved contribution, literal transcript, assent audio, and accessibility telemetry (response latency, thread-loss events, which scaffold fired). Delete unapproved call audio at call end. Never ingest full chat history, health records, location, unapproved contacts, or continuous audio. Never build a decline/analytics dashboard about her.
9. **No medical claims.** Frame Relay as cognitive-accessibility support for participation and family connection. No treatment, improvement, or monitoring claims anywhere: code, copy, demo, or write-up.

## 3. Competition targets

- **Track: Healthcare.** One track submission only (HackMIT allows at most one). Frame as participation/accessibility support with caregiver visibility. Do not medicalize.
- **Primary sponsor: Meta, "Bringing People Closer Together with AI."** Meta integration must be load-bearing: Muse Voice Transcribe produces the literal time-aligned transcript from Mom's real audio; Muse Spark makes only the scaffold decision from typed tool outputs and must cite graph node IDs in its response; Relay's policy check, graph query, assent, and publish actions are exposed as tools/connectors; publish hard-fails on policy mismatch or missing assent. Do NOT integrate the Facebook Graph API unless a real, user-consented path works; a mocked Facebook surface hurts credibility. Meta submission needs: working prototype, 2-3 minute demo video, public repo, short write-up naming the user, the connection benefit, and why AI is essential.
- **Secondary sponsor: Deepgram, "Build Something Worth Talking To."** Streaming STT for word timings, endpointing, and exact transcript spans. The state machine waits for a final turn before classifying answer or assent. Transcript spans and audio hashes feed the provenance receipt. Never use TTS for Mom.

**Do not build for:** ElevenLabs (pushes toward generated persona/voice, contradicts rules 1-2), Dropbox (pulls toward memory/photo organization = Remento collision), Elastic (garnish unless retrieval is genuinely rebuilt on it), OpenAI (dilutes the model story), Voloridge (public-dataset insight is not our data), Regeneron (clinical trials mismatch), any hardware challenge, Long Lake (pitch angle only, no build target).

Do not add a third sponsor. Do not invent sponsor APIs. If Muse credentials or docs are unavailable, stub behind the same tool interface with fixtures and label the stub in the demo. Confirm the max number of sponsor challenges with organizers before final submission; the current docs do not state a limit.

## 4. The 90-second golden path (judged demo, exact)

The demo scenario is fixed. Do not change the people, the question, or the answer.

- **0-8s**: Family group chat. Anika posts one photo showing kheer and halwa: "Mom, which should I make for Diwali?" Tap "Ask Mom with Relay."
- **8-20s**: Ordinary phone call, full-screen and warm. Relay: "Anika wants your help with Diwali dessert." Mom smiles, then asks, "Which thing again?" No red error, no diagnosis label, no transcript wall, no visible trace.
- **20-31s**: Quiet lower-third receipt shows the tool sequence: inspect live request -> resolve people/audience -> check policy -> retrieve only permitted current evidence. The graph returns only Anika's one current photo plus Mom's prior source-backed claim "cardamom goes in last" from an original voice clip. Relay says: "Kheer or halwa. Anika sent this photo."
- **31-46s**: Mom: "Make the kheer. Your grandfather always added cardamom last." Relay does not rewrite. It detects an answer and asks, "Want me to send that to Anika?" Playback is Mom's original audio. She says yes.
- **46-57s**: Her voice card lands in the existing family chat. Anika replies, "Kheer it is." The family changes course. End the human scene here.
- **57-70s**: Caregiver receipt, three observable outcomes: Social - "Mom answered Anika directly." Emotional - "one re-anchor, no correction or distress escalation." Intellectual - "she chose and added original family knowledge." Never score Mom.
- **70-82s**: Six-second counterfactual split replay. Left, without tools: the bot repeats a generic question, guesses context or offers the wrong dish, Mom says "I don't know," nothing sends. Right, with tools: exact current ask plus two permitted choices, contribution delivered. Label it as a prerecorded alternate path, never as a claim about the person.
- **82-90s**: Provenance receipt: original waveform, literal transcript, source links, 3 silence trims, 0 generated first-person words, assent audio + timestamp + content hash, delivered only to the original thread. Final line: "Access changed. Authorship didn't."

## 5. State machine (single source of truth)

One reducer drives every pane of the UI. All visual, audio, and trace effects key off the same transition data so the demo can never contradict itself.

```
idle -> ask_received -> policy_passed -> connected -> following
     -> lost -> reanchored -> contributed -> playback -> assented -> delivered
```

The call session nests as: `connected { brief -> ask -> support* -> capture -> confirm }`.

Deterministic failure transitions, no model judgment:

- `lost` twice -> graceful wrap-up; the ask is marked "no answer today"; the asker gets a neutral "not this time" with no health disclosure.
- Assent unclear -> discard or hold for next call; never send.
- Topic blocked by policy -> the call is never placed.
- Tool timeout mid-call -> fall to fixed script: restate the question once, then close kindly.
- Identity, evidence, or permission missing -> Relay says: "I don't have enough context to answer that for you. I can ask Anika to clarify."
- Graph claims conflict -> use only the current ask or ask the family; never pick a remembered fact.

## 6. Tool contracts

The model selects calls but cannot bypass gates. Retrieval, assent, and publish are enforced services, not decorative wrappers. Every call logs input/output JSON, latency, source IDs, policy decision, and state transition for the judge console (and exposes none of it to Mom).

1. `inspect_request(thread_id)` -> current ask, participants, artifacts, requested audience.
2. `resolve_identity_and_relationships(participants)` -> only verified bindings; a mismatch blocks the flow.
3. `get_access_policy(person, purpose, audience)` -> allowed source classes, forbidden claims, expiry. Denial blocks graph retrieval. Hard gate.
4. `query_context_graph(question, allowed_sources, max_hops=2)` -> ranked candidate subgraphs with citations, not prose.
5. `verify_claim_support(claim_ids)` -> checks direct evidence, contradictions, freshness, speaker attribution. Unsupported context cannot be spoken.
6. `assess_conversation_state(audio_window, turn_history)` -> `followed | asked_repeat | no_answer | answer_present`, plus evidence. Observable state only; never emotion or cognition.
7. `select_scaffold(state, verified_subgraph)` -> chooses the least support: repeat -> name asker -> show/restate the two current options -> one source-backed cue. Records rejected alternatives and why.
8. `render_prompt(scaffold_id, citations)` -> verbalizes only cited facts. Never fabricates Mom's first-person speech.
9. `capture_exact_contribution(audio_intervals)` -> literal transcript + edit-decision list limited to silence/disfluency trims. A deterministic check rejects any segment containing model speech or blocked content. Source audio stays immutable.
10. `request_assent(contribution_hash, audience)` -> plays the exact pending artifact, records yes/no/unclear as an audio artifact. Any content or audience change invalidates it.
11. `publish_contribution(hash, destination)` -> requires valid assent, matching destination, and policy token. Otherwise hard fail.
12. `build_caregiver_receipt(session_id)` -> summarizes supports and outcomes with citations. Never a clinical score.

Enforceable sequence: inspect request -> verify identities -> get policy -> query permitted graph -> verify evidence -> assess conversation state -> select least-helpful scaffold -> render only cited context -> capture exact contribution -> play back for assent -> publish only if assent/audience/hash still match -> build caregiver receipt.

## 7. Knowledge graph and provenance schema

Keep the graph compact and private. Do not import a large ontology or FHIR. This is not a clinical record.

**Node types (12):** Person, Relationship, CurrentAsk, Artifact (photo/audio/message), Topic, EpisodicClaim, Preference/Expertise, Event, AccessPolicy, Session, Contribution, Assent.

**Edges:** ASKED_BY, ADDRESSED_TO, MEMBER_OF_THREAD, DEPICTS, ABOUT, EVIDENCE_FOR, SPOKEN_BY, RELATED_TO, OCCURRED_AT, PERMITTED_IN, RELEVANT_TO, CONTRADICTS, DERIVED_FROM, INCLUDED_SPAN, APPROVED_BY, DELIVERED_TO.

**Every claim and edge carries:** source_id, exact span or media hash, observed_at, speaker/author, extraction method, confidence, audience scope, expiry, and supersedes/contradicts links. No inferred diagnosis, mood, competence, or relationship is ever stored as fact.

**Four layers:** (1) immutable raw evidence; (2) extracted claims with citations; (3) ephemeral session state; (4) contribution + assent + delivery audit. Public/open seed data covers only general entities (dishes, holidays, ingredients). Private family claims come only from consented family artifacts.

**Demo seed (20-30 hand-curated facts with real source clips):** Anika asks current question; question offers [kheer, halwa]; the one photo depicts both dishes; Mom previously_said cardamom-last claim; claim evidenced by old audio span; Mom relationship Anika; policy permits use of the recipe artifacts for this call; final contribution includes exact spans of the current recording; contribution approved_by assent audio; contribution delivered_to original thread.

**Open-source basis:** LadybugDB (`@ladybugdb/core`; embedded property graph, Cypher, MIT) for persistence. Graphology (MIT) for the animated judge view, not persistence. W3C PROV-O vocabulary for provenance concepts (attribute the spec). Schema.org vocabulary where useful (CC BY-SA 3.0; keep extensions in a separate Relay namespace with attribution). Wikidata (CC0) only for public entity IDs/aliases: Diwali, kheer, halwa, cardamom. Never import personal or health assertions.

## 8. Stack and repo layout

**Stack:** Next.js (App Router) + TypeScript + Tailwind + Framer Motion + Zustand (or a tiny reducer) + Lucide icons. LadybugDB for the graph. Deepgram streaming STT and Meta Muse calls behind the tool interfaces above. All media is local. No backend is required for the judged path. The family's thread is Telegram, through the Bot API over plain `fetch` (no SDK) - live only, never on the judged path; see section 17.

**Build tooling (dev only, never shipped to the judged path beyond zod):** zod (the single source for tool types, runtime validation, and the JSON Schemas handed to a model's tool interface), Vitest (the section 12 checks), tsx (runs `/scripts`). npm is the package manager; commit `package-lock.json`.

**Layout:**

```
/app                 routes; /present is the autoplay judged route
/components          SandboxShell, FamilyThread, CallStage, CueCard,
                     AgentTrace, AuthorshipRibbon, ContributionCard,
                     AssentGate, DemoControls
/lib/intake          request intake: the forwarded-ask contract (text + at most one
                     photo, nothing else), lexical interpretation, graph writes
/lib/bridge          the neutral seam to the family's existing thread; refuses any
                     message that is not a reply to a forward it received
/lib/bridge/telegram LIVE ONLY. Bot API client, update -> forwarded ask, bindings,
                     and the Telegram transport behind the shared guard
/server              LIVE ONLY. Composition of the live process (webhook + polling)
/lib/service         RelayService: forwardAsk() and runSession() - the one entry point
/lib/session         session recordings, replay to any moment, and the view selectors
                     for the three web surfaces (intake, live session, receipt)
/lib/state           the reducer and transition table (single source of truth)
/lib/tools           the 12 tool implementations + JSON schemas + gates
/lib/graph           LadybugDB schema, seed loader, citation queries
/lib/provenance      hashing, edit-decision list, PROV-style event log, receipts
/lib/orchestrator    walks the enforced tool sequence and feeds the reducer;
                     the call driver (fixture-backed on the judged path)
/lib/providers       transcription boundary (fixture now; Deepgram / Muse later)
/fixtures            the judged path's data only: family graph, policy, the forwarded
                     ask payload, the call transcript; plus harness.ts (plumbing)
/assets              prerecorded audio/video/images (immutable once cut)
/scripts             seed, hash, verify, and test runners
/tests               the section 12 acceptance checks (Vitest); all failure-branch
                     data lives in tests/fixtures.ts, never in /fixtures or /assets
```

Commands: `npm run check` (typecheck + tests + verify) must pass before any task is called done. `npm run verify:strict` is the pre-demo gate and fails while any placeholder media or placeholder word timing remains. `npm run assets:hash` after adding or replacing media; `npm run graph:seed` to rebuild the LadybugDB file under `.data/`.

Two graph stores sit behind one `GraphStore` interface: `MemoryGraphStore` (browser-safe; the judged path uses only this) and `LadybugGraphStore` (Node only; scripts, tests, live side demo). Never import `lib/graph/ladybug-store.ts` from anything the browser loads. A parity test holds the two to identical answers.

Flow spec to code: A/D request intake -> `lib/intake` via `RelayService.forwardAsk`; G identity and audience -> `resolve_identity_and_relationships`; H policy -> `get_access_policy`; I/J/K/L/M -> tools 4-11; X "stop safely, ask family to clarify" and Y/Z/W -> the reducer sets `family_notice` (`clarify` or `not_this_time`) and the orchestrator posts that fixed sentence through the bridge; B voice card and C support receipt -> `lib/bridge` (the receipt goes only to `support_receipt.recipients` in the policy, never to the thread); E and F -> `lib/session/view.ts`.

Mock data discipline: nothing under `/lib` may import from `/fixtures`, `/assets`, or `/tests` (a test enforces it). An ask is never hand-written as graph JSON: forward a payload and let intake build the nodes. New failure-branch data goes in `tests/fixtures.ts`, derived from the judged data where possible.

Rules: fixtures are data, not code branches; `/assets` media is never re-encoded after hashing; every citation in fixtures must resolve to a real span or hash in `/assets`.

## 9. Judged path vs live side demo

The 90-second judged path runs entirely on prerecorded call branches and deterministic fixture outputs. Telephony, ASR, model latency, and network access must never touch it. Preload every asset. The `/present` route hides controls and auto-advances; arrow keys step manually as a fallback.

A live model + live Deepgram/Muse path may exist as an optional side demo, behind a flag, never in the judged path. The counterfactual replay is prerecorded and labeled as such.

## 10. Visual direction and accessibility

Direction: **"The Living Thread"** - one desktop sandbox at 1440x900. A calm family room crossed with a film-editing table, not a caregiver portal. Lead with a human moment, reveal one state change at a time, and put technical UI on top of recognizable family media.

- **Left rail (28%):** the family thread. Neutral chat shell with recognizable bubbles (do not imitate a real messaging app brand). Anika's photo and question, plus a "Help Mom answer" action.
- **Center stage (48%):** "With Mom now." Large video/portrait loop, her name, and "Anika is asking about Diwali." One cue card at a time: the photo, asker portrait, then two large labeled choices. No transcript crawl while she speaks. A small "Phone call" badge so judges know she never operates this UI.
- **Right rail (24%):** "How Relay helped." Human-readable event cards (Ask verified; Thread unclear; Re-anchored; Voice approval received). Tool names as tiny monospace labels for judges.
- **Bottom:** one scrubber with six named chapters.
- **Authorship ribbon:** a thin coral line that starts at Anika's question, crosses center only when Mom speaks, and ends wrapped around the delivered contribution card. It never touches Relay's scaffold words.
- **Contribution card:** her name and timestamp, original waveform, literal transcript, provenance rows ("Source: live call", "Edited: 3 pauses trimmed, 0 words generated", "Approved by Mom's voice"), and a wax-seal-style approval mark, not a generic check.

**Design tokens:** warm paper `#F6F1E8`, ink `#18342F`, sage `#B9CEC3`, coral `#E4775B` (authorship), amber `#D5A64A` (uncertain thread), 18px card radius. Literary serif only for large emotional lines; legible sans for all controls. Do not use Remento's aqua/forest pairing as the dominant palette.

**Information hierarchy:** person and relationship -> current ask -> current cue or answer -> whether Relay is listening, helping, or waiting for approval -> provenance/trace. Never surface model confidence, clinical labels, or caregiver analytics in the primary view.

**Accessibility for Mom (hard requirements):** center stage only, one task, one familiar person named at all times; minimum 24px cue text and 44px controls; high contrast; no all-caps; no translucent text over video; one photo or two mutually exclusive choices, never a carousel; no countdowns, typing dots, diagnostic language, or moving traces visible to her; status in plain speech ("I'm listening," "Let's make this easier," "Would you like me to share that?"); stable placement of name, question, choices, approval controls; respect reduced-motion; crossfades and position continuity, no zooms or confetti.

## 11. Build order (24 hours)

- **0-2**: Lock the script. Record two phone-call branches and the family-chat assets. Define graph and policy fixtures.
- **2-5**: Next.js shell: family chat and call stage.
- **5-8**: LadybugDB schema + 20-30 seeded facts, artifact hashes and citations, policy query.
- **8-11**: Deterministic tool service with JSON schemas and the reducer state machine. Hard gates around retrieval, assent, publish.
- **11-14**: Audio playback, literal transcript fixture, edit-decision list, assent hash.
- **14-17**: Caregiver receipt and PROV-style event log. Graphology judge view.
- **17-19**: Counterfactual split replay with clear labeling.
- **19-21**: Autoplay `/present` route plus arrow-key manual mode. Preload all assets. Remove network dependencies.
- **21-23**: Test the success, denied-policy, conflicting-claim, unclear-assent, double-lost-thread, and tool-timeout branches. Verify every visible claim and citation.
- **23-24**: Rehearse. Cut anything that slows the emotional beat. Capture the backup video.

**Hour-18 checkpoint (kill criterion):** if the adaptive scaffold loop (assess -> reanchor -> capture -> assent -> deliver) is not demoable end to end by hour 18, cut scope in this order: (1) live side demo, (2) Graphology judge animation, (3) Meta Muse live calls (keep fixtures). Never demo the thin version: a phone call plus transcription is Remento with faster cadence and is not worth presenting.

## 12. Tests and acceptance criteria

Automated checks that must pass before the demo is called done:

1. **Golden path**: full reducer walk from `idle` to `delivered` with fixture inputs; every transition emits its trace event.
2. **Gate tests**: publish without assent fails; publish with mismatched hash fails; publish with mismatched audience fails; retrieval without policy token fails; `render_prompt` with uncited content fails.
3. **Branch tests**: denied policy (no call placed), conflicting claims (falls back to current ask only), unclear assent (nothing sends, audio discarded), two lost-thread signals (gentle wrap-up, neutral asker message), tool timeout (one fixed restatement, then close).
4. **Authorship invariants**: outbound artifact contains only Mom's audio spans; every edit appears in the edit-decision list; every spoken Relay line maps to citations; generated first-person word count is exactly 0.
5. **Provenance**: content hashes verify against `/assets`; every fixture citation resolves to a real span or hash; the receipt lists source, trims, assent, timestamp, hash, and destination.
6. **Determinism**: the judged path runs with the network disabled.
7. **Visual**: inspected at 1440x900; ribbon never touches scaffold words; contribution card renders seal, waveform, and provenance rows; reduced-motion mode swaps animations for crossfades.

End-card metrics the demo must be able to show: 100% her words in the artifact, number of scaffolds logged, 0 generated first-person words.

## 13. Branch and file ownership

- `main` is protected. Feature branches named `<owner>/<area>-<thing>` (e.g. `dev2/tools-gates`).
- Suggested ownership split so agents and people do not collide: `/components` + visual polish (frontend), `/lib/state` + `/lib/tools` (orchestration), `/lib/graph` + `/lib/provenance` + `/fixtures` (data), `/assets` + script recording (media).
- Changes to `/lib/state`, the tool JSON schemas, or policy fixtures require a second person's review: they define the safety gates.
- `/assets` is append-only after hashing. Replacing a hashed asset requires re-running the provenance verification script.
- Commit small and often; rebase before opening work that touches the reducer.

## 14. Non-goals (do not build, do not "just add")

- A companion app, daily check-in calls, reminders, or reminiscence prompts.
- A memory archive, life story book, or searchable family history.
- Speech-to-story rewriting or any polished narrative in her name.
- Voice cloning or a "what Mom would say" mode, including posthumous simulation.
- Diagnosis, staging, mood detection, cognition scoring, or caregiver decline dashboards.
- Face recognition, location features, health-record import, continuous recording.
- Facebook Graph API or any mocked social integration.
- Hardware, robotics, or sensors.
- A large ontology, FHIR, or any clinical data model.
- Bulk ingestion of the family chat. Forward-per-ask is the only intake.
- A third sponsor integration.

## 15. Quick checklist for agents

Before considering any task done, confirm:

- [ ] No generated first-person words, no voice cloning, no persona simulation.
- [ ] Every gate (identity, policy, evidence, assent) still hard-fails closed.
- [ ] The 90-second golden path still runs offline, deterministically, in order.
- [ ] Every spoken line has citations; every outbound word is hers.
- [ ] No medical, diagnostic, or scoring language anywhere.
- [ ] No new dependency, API, sponsor, or feature that this file does not name.

## 16. Design skill (Impeccable)

All interface work in this repo goes through the Impeccable design skill (https://github.com/pbakaus/impeccable, Apache 2.0), installed project-scoped for Claude Code (`.claude/skills/impeccable`), Codex (`.agents/skills/impeccable`), and Cursor (`.cursor/skills/impeccable`). It is a dev tool, not a product dependency, and it is not a sponsor integration.

- Before designing or restyling any surface, invoke the skill (`/impeccable ...`) rather than styling freehand. Start with `/impeccable init`, which interviews the team and writes `PRODUCT.md`; it has not been run yet. Visual work then establishes `DESIGN.md`.
- Section 10 of this file is the binding visual brief. The skill's own rule is "the brief wins": the pinned palette, the 18px radius, the serif/sans split, the 1440x900 sandbox, and every accessibility requirement for Mom override the skill's taste. The design tokens are already in `app/globals.css`.
- The non-negotiables in section 2 outrank any design suggestion. In particular: no transcript crawl, typing dots, countdowns, confidence readouts, or moving traces in anything Mom sees; the authorship ribbon never touches Relay's words.
- A hook runs the skill's detector after edits to UI files and once more when an agent stops. It reports; it does not block. Per-machine hook config (`.claude/settings.local.json`) is git-ignored, so each teammate runs `npx impeccable install --providers=claude,codex,cursor --scope=project` once. If that fails with "invalid zip data" (an upstream installer bug seen with engine 0.1.5), download `https://impeccable.style/api/download/bundle/universal` and re-run with `IMPECCABLE_BUNDLE_PATH=<that zip>`, then `chmod +x` the three `skills/impeccable/scripts/impeccable` launchers.
- Panes render the view selectors in `lib/session/view.ts` (`intakeView`, `liveSessionView`, `receiptView`) over a `SessionRecording`, at a moment in time. They decide nothing themselves, and the selectors have no field for confidence, scores, or clinical labels. Anything showing "what Relay said" reads `recording.spoken`, never `recording.prompts`: the fixed-script lines are rendered before every call and are usually never said.

## 17. Telegram (the family's thread, live only)

The product has two surfaces: a Telegram bot, which is the family's existing thread, and the Relay web app. Telegram is a real integration, not a mock, and it stays out of the judged path: `/present` runs on `MemoryThreadBridge`, and tests enforce that only `lib/bridge/telegram/api.ts` may make a network call and that nothing judged-path safe imports `lib/bridge/telegram` or `/server`. In the web UI the left rail is still a neutral chat shell; do not imitate Telegram's look (section 10).

- **Forwarding an ask** is replying to your own question with `/ask` (optionally saying what the photo shows: `/ask kheer and halwa`). You can only forward your own message.
- **Keep the bot's group privacy mode ON.** Telegram then delivers only commands addressed to the bot and the single message such a command replies to. The rest of the chat never reaches Relay, so rule 8 holds before our code runs. Relay subscribes to `message` updates only.
- **Bindings** (which chat is which thread, which Telegram account is which person) are personal data: they come from `RELAY_TELEGRAM_BINDINGS`, never from a committed file. A binding grants nothing; the identity gate and the policy still decide every run. An unbound chat gets no reply of any kind. An unbound sender in a bound chat gets the fixed "clarify" notice.
- **Everything Relay says on Telegram goes through `TelegramThreadBridge`,** which inherits the guard from `GuardedThreadBridge`: only replies to a received forward, only into its own thread, notices in their fixed wording. The one exception is fixed usage help, sent only as a reply to a `/help` or malformed `/ask` in a bound chat. The support receipt goes to the named relative's private chat, never the group.
- **The voice card's audio** is the kept spans cut byte-for-byte from the source recording (`lib/provenance/wav.ts`): no re-encoding. It is sent as a WAV document; transcoding to OGG/Opus would make it a voice bubble but is a re-encode, so decide that deliberately.
- **Modes** (`RELAY_CALL`): `none` is intake only, because there is no telephony yet and Relay does not pretend otherwise. `prerecorded` runs the session against the prerecorded golden call for the side demo; say so when showing it. If Telegram cannot be reached at delivery, the run ends `not_sent` and the failure is recorded in `recording.delivery_failures`.
- Operate it with `npm run telegram -- whoami | setup | discover | poll | webhook <https-url> | webhook:off`. The webhook requires `TELEGRAM_WEBHOOK_SECRET` and rejects any request without it.
