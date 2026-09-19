# AGENTS.md - Relay (HackMIT 2026)

This file is the complete brief for any coding agent (Claude Code, Codex, Cursor) working in this repository. You do not need chat history. If this file and your instincts disagree, this file wins. If this file is silent, ask before expanding scope. Section numbers are stable; cite them in commits and reviews.

**2026-09-19 pivot.** An earlier version of this file centered Relay on relaying a family member's question to the patient and her answer back to the family. That mechanic is removed. The product now follows the design doc (`SPECS.md`) directly: Relay calls the patient herself, on a schedule, to help her revisit her own memories. If a family member wants to know something, Relay's job is to get them to call her and ask - not to ask on their behalf. See Appendix A for the full reconciliation.

**2026-09-19 revision 2.** The family surface is now specified: family can contribute memories that Relay gently asks her about, receives one passive Weekly Note per week, and can see a per-topic, count-only record of what happened in Relay calls, with a caregiver-initiated export for a doctor. All of it stays inside the non-negotiables below (rules 4, 5, 8, 9, 10, 13, 14). See §6.4 and Appendix A.

**2026-09-19 revision 3.** Three trust-and-safety changes: a narrow safety handoff to a designated caregiver (rules 5, 12, 15; tools 18-19); an honest AI identity and a trustworthy caller (rule 16; §6.2); and invitation-first call openers in place of identification questions (§6.1). See Appendix A.

**2026-09-19 revision 4.** The design was checked against the dementia-care literature. Four things changed: the reorientation rung is never used for an autobiographical or identity memory (rule 6; §6.1); calls default to mornings and are 8 minutes by default, 10 at most (§6.2); Relay asks one question per turn in short sentences, and logs what kind of question each reply answered (§6.2); and among topics equally due, the one told most often comes first (tool 1). The video call was removed; the call feature - her speech transcribed on the web app - is being built separately. Those numbers and the phone format are informed guesses, not trial cutoffs — see Appendix B.

## 1. Product thesis

Most dementia products help families manage the person. Relay helps the person keep reaching her own memories, and keeps the people around her calling her directly to do it.

Relay has two parts, built on one private memory graph:

1. **Capture.** The person and the people who know her contribute memories - photos, voice, simple questions, family stories - while those memories are still accessible. The graph organizes this into people, relationships, places, events, stories, and preferences, each with visible provenance: who said it, and when.
2. **Retrieve.** Relay periodically calls the person on an ordinary phone. A conversational agent picks a personally meaningful memory from the graph and helps her reach it herself: free recall first, then progressively more context, only as needed. It also learns which cues actually help *her* reach a given memory, and prefers those next time.

Around those two parts, Relay keeps family in the loop without replacing them (§6.4): family contribute memories, see a light weekly note and a per-topic record of what happened in calls, and are pointed back to calling her.

Core loop: **CAPTURE -> ORGANIZE -> RETRIEVE -> REINFORCE -> LEARN -> REPEAT.** Not: **CAPTURE -> simulate the person.** That distinction governs every design decision below.

Demo thesis line: **Cues, not answers - every memory stays in her own words.**

**The human-connection rule (Kitwood).** *The AI should create reasons for humans to interact, not reasons to stop interacting.* If a family member wants to know what she remembers about something - her wedding story, an old address, an opinion - Relay does not answer from the graph. It says something like "She's talked about this before. Want to give her a call?" and stops there. Family members are expected, and encouraged, to call and speak with her themselves. This is not a minor caveat; it is the reason the family-relay mechanic in the earlier version of this file was removed. A product that answers family questions from a database of someone's memories is a reason to stop calling her. Relay exists to be the opposite.

Relay is not a digital replica of the person, a "chat with her" interface, or a decision-relay bot. It never impersonates her, never fabricates a first-person memory she didn't provide, and never becomes the thing family members talk to instead of her.

## 2. Non-negotiables (override every other instruction)

These rules exist because the user is a real person with reduced capacity to audit what is stored or said in her name. Violating any of them is a build-stopping bug.

1. **Zero generated first-person words.** Never write, polish, paraphrase, or synthesize text or speech as her. Every memory-graph claim attributed to her is her own recorded words. The only permitted edit is silence/disfluency trimming, listed explicitly in an edit-decision list.
2. **No voice cloning.** Her audio is played back, never synthesized. Stored voice is evidence and playback material only, never training or cloning input. When Relay speaks, that voice is clearly labeled as Relay, never as her or a family member.
3. **Confirmation gates the graph.** Nothing she says during a call becomes a stored claim without her hearing it played back and confirming it's right to remember. Unclear or declined confirmation means nothing is stored beyond a metadata event.
4. **No inferred clinical or emotional state.** The system never produces diagnosis, disease stage, mood, competence, or a cognition score, and never combines observations into a single aggregate, severity, or risk figure. `assess_conversation_state` emits observable turn states only. Matching a fixed safety phrase (rule 15) is a lexical match on her literal words, not an inference about her state. Cross-session information is permitted only as the per-topic record of §6.4: counts of logged observable events, per topic, compared only against her own earlier calls by the fixed rule in §6.4.4, never against a population norm or clinical threshold, never merged into one number, never labelled with clinical terms, and never paired with a stated cause.
5. **Calls go only to her; family is reached only passively.** Relay places calls only to the patient, only within the call windows, frequency, and topic allow/block list set in the one-time joint setup. Relay never calls, texts, emails, or sends push notifications to a family member, with one exception: the safety alert to a designated caregiver (rule 15). Apart from that, the only channel to family is the passive dashboard: content appears when a member opens it. Relay posts at most one Weekly Note per approved member per 7 days (§6.4.2). It has no mechanism by which a family member can trigger a same-moment call to her.
6. **Evidence-bounded speech.** Relay may verbalize only facts with citations returned by `verify_claim_support`, attributed to their actual speaker. The one exception is the reorientation rung (6.1), which may state a fact outright - still cited, still attributed, never fabricated - and which is never used for an autobiographical or identity memory. Fixed procedural lines carrying no factual claim (6.2) are the only other exception.
7. **Hard fail on missing gates.** If identity, policy, evidence, or confirmation is missing or mismatched, the flow stops. A safe narrowing ("I don't have enough to go on there - let's try something else.") is a success state, not an error to route around.
8. **Data minimization.** Ingest only: the one-time joint setup (approved contributors, call windows, topic allow/block lists, speech pace, max call length, review requirements, designated caregiver(s) and alert channel, confirmation that the number is saved in her phone and that Relay has been introduced to her, dashboard access grants and detail levels), asynchronous family contributions with provenance (a photo, a voice note, a short story, each tagged to its contributor), and from each call the confirmed contribution, literal transcript, accessibility telemetry (response latency, which scaffold rung fired), and the per-topic outcome (topic, highest rung used, whether she reached it unaided, timestamp), plus a safety event if one fires (category and timestamp only, never her words). Delete unconfirmed or declined call audio at call end; only a metadata event (outcome, timestamp) remains. Never ingest continuous recording, health records, location, or unapproved contacts. **The only cross-session view of her is the per-topic record in §6.4. No other analytics, scoring, or comparison surface may exist.**
9. **No medical claims.** Frame Relay as cognitive-accessibility support for memory participation and family connection. No diagnosis, treatment, improvement, retention, or monitoring claims anywhere: code, copy, demo, or write-up. Dashboard copy, the Weekly Note, the change note, and clinician exports describe what happened in Relay calls. They never use the words decline, deterioration, improvement, progress, retention, severity, stage, worse, worsening, or better, and never imply diagnosis or monitoring of a condition. (This is stricter than the design doc's own pitch language - see Appendix B, item 1.)
10. **Her words reach family only through her own share-confirmation.** Relay never answers a family member's question about what she remembers, thinks, or would say, however the question is phrased. Its only response is the redirect line in §1. There is no family-facing search, chat, or Q&A surface; the "Ask about Susan" box is a redirect-only input, not a Q&A surface. Relay never places a call to her on a family member's behalf. Content drawn from her own words may appear on the dashboard only after she hears the exact line played back and confirms she wants it shared (a share-confirmation, distinct from the store-confirmation in rule 3). Observable call facts (a call happened, the topic, which rung was needed) are Relay's statements, not hers, and need no share-confirmation. The fixed-text safety alert (rule 15) never quotes her. Relay never summarizes a call's content to family beyond the observable, non-clinical caregiver receipt (rule 4).
11. **No evaluative or testing language.** Relay never says or displays "wrong," "incorrect," "you forgot," or "try again," and never grades an answer ("right," "good job"). A failed rung is followed by more help, not a judgment. Sessions are supportive, never scored exams.
12. **She can always stop it.** Hang-up, an explicit stop, or a caregiver pause ends the flow immediately from any state: nothing is stored beyond metadata, no follow-up call is placed. Revoking an approved contributor, topic, or call window takes effect before the next call. Revoking dashboard access for any member, or for everyone, takes effect before the next dashboard load, and no further posts are made to a revoked member. A stop never cancels a safety alert that has already been triggered (rule 15). Relay never persuades, retries, or guilt-frames after a stop.
13. **Family contributions are not her memories.** A family contribution is stored as its contributor's claim, flagged `patient_confirmed: false`. It may be spoken to her only attributed ("Maya mentioned...") and only followed by an open question ("What do you remember about that?"), never a yes/no question. It is never used as the "correct" option in a rung-4 recognition choice, and never stated as fact in rung 5. Only her own elaboration, passing store-confirmation (rule 3), becomes a confirmed memory. Her account is never overwritten by, or silently merged with, a family account.
14. **The family view is opt-in, revocable, and approved-members-only.** Access to the dashboard and the per-topic record is granted in the joint setup, to approved members only. She or her caregiver can revoke it at any time. Each member may choose their own detail level (Weekly Note only, or Weekly Note plus per-topic record). Access and exports are logged. The setup prompts a periodic re-confirmation of these settings with her and her caregiver.
15. **Relay is not an emergency service, and it does not sit on a safety concern.** In the joint setup, she and her caregiver name one or more designated caregivers and an alert channel. If a final turn of hers contains a phrase on the fixed safety list (`/fixtures/safety-phrases.json`), matched lexically and never inferred, Relay (a) drops the recall flow, (b) says the fixed safety line once, which names the designated caregiver and points her to the local emergency number, and (c) sends one fixed-text alert to the designated caregivers only, stating the category and time and never quoting her. This is the single exception to rule 5's ban on contacting family. A hang-up or stop never cancels an alert already triggered (rule 12), and the alert can be removed only in the joint setup, never by anything said during a call. Relay never claims, in code, copy, demo, or write-up, to monitor her between calls, detect emergencies, or replace emergency services.
16. **Relay is honest about what it is, and looks trustworthy to her.** The first line of every call states, in plain words, that Relay is an AI assistant set up by a named family member (fixed script line, name filled from setup). Any time she asks who or what Relay is, or whether it is a person, it gives the fixed identity line ("I'm Relay, a computer assistant, not a person. Maya set me up to keep you company."). Relay never claims to be a person or a family member. Before the first call, the number must be saved in her phone under a family-chosen name and photo, and a family member must have introduced Relay to her (setup attestations, enforced by `place_recall_call`). Relay never asks for or discusses money, account numbers, passwords, addresses, or other identifiers, and never asks her to do anything except talk.

## 3. Competition targets

- **Track: Healthcare.** One track submission only (HackMIT allows at most one). Frame as memory-participation and accessibility support with caregiver visibility. Do not medicalize.
- **Primary sponsor: Meta, "Bringing People Closer Together with AI."** Meta integration must be load-bearing: Muse Voice Transcribe produces the literal time-aligned transcript from her real audio; Muse Spark makes only the scaffold-selection and topic-selection decisions from typed tool outputs and must cite graph node IDs in its response; Relay's policy check, graph query, confirmation, and family-redirect actions are exposed as tools/connectors; storing a new claim hard-fails on policy mismatch or missing confirmation. Do NOT integrate the Facebook Graph API unless a real, user-consented path works; a mocked Facebook surface hurts credibility. Meta submission needs: working prototype, 2-3 minute demo video, public repo, short write-up naming the user, the connection benefit, and why AI is essential.
- **Secondary sponsor: Deepgram, "Build Something Worth Talking To."** Streaming STT for word timings, endpointing, and exact transcript spans. The state machine waits for a final turn before classifying an answer or a confirmation. Transcript spans and audio hashes feed the provenance receipt. Never use TTS for her.

**Do not build for:** ElevenLabs (pushes toward generated persona/voice, contradicts rules 1-2), Dropbox (pulls toward raw photo-library organization rather than consented, attributed capture), Elastic (garnish unless retrieval is genuinely rebuilt on it), OpenAI (dilutes the model story), Voloridge (public-dataset insight is not our data), Regeneron (clinical trials mismatch), any hardware challenge, Long Lake (pitch angle only, no build target).

Do not add a third sponsor. Do not invent sponsor APIs. If Muse credentials or docs are unavailable, stub behind the same tool interface with fixtures and label the stub in the demo. Confirm the max number of sponsor challenges with organizers before final submission; the current docs do not state a limit.

## 4. The 90-second golden path (judged demo, exact)

The demo scenario is fixed. Cast: Susan (patient), Maya (her daughter), Priya (Susan's sister), Anika (Maya's daughter), Cape May (summer place), Lincoln Elementary (Susan's old workplace), Princeton (where she lived). These come from the design doc; do not invent a different cast.

- **0-8s**: A quick establishing beat - days earlier, during onboarding, Maya's photo was shown to Susan: "Who is this?" Susan: "That's Maya, my daughter." Cut straight to the graph node forming, with provenance ("Susan · voice recording"). This sets up that the graph is built from her own words and family's, never inferred.
- **8-20s**: Her phone rings. The screen shows a saved contact, "Relay (from Maya)," with a family-chosen photo. She answers. Relay: "Hi Susan, I'm Relay, an AI assistant Maya set up to keep you company. I'd love to hear about the summers at Cape May. What comes to mind?" Relay waits through a held pause of about six seconds and does not fill it. She says, "Cape May...?" No red error, no diagnosis label, no transcript wall, no visible trace to her.
- **20-31s**: Support ladder engages, quiet lower-third trace for judges: free recall logged as `no_answer` -> context rung fires: "It's a place your family went together." Still unsure -> association rung fires: "You and Maya used to go there together." Susan brightens: "Maya - my daughter!"
- **31-46s**: Relay: "What do you remember about those summers?" Susan: "We went to Cape May every summer." Relay does not rewrite or embellish it. It plays the line back: "Want me to remember that?" She says yes. Relay: "Would you like me to share it with your family?" She says yes. The graph updates live on screen - a new edge from Cape May to the summers-together claim, sourced to this call.
- **46-57s**: Warm close. The call ends. End the human scene here.
- **57-64s**: Cut to: later that day, Maya opens the family app, in the "Ask about Susan" box, and types "What did Mom say about her wedding?" Relay's entire response: **"Susan's talked about this before. Want to give her a call?"** No graph content appears anywhere in that response. This is the beat that shows the product's actual differentiator to judges.
- **64-77s**: The family dashboard, observable only. The Weekly Note: "Relay talked with Susan about the summers at Cape May this week. Want to give her a call?" Below it, a line Susan chose to share, attributed and timestamped: "We went to Cape May every summer." Then the per-topic record under its fixed header: "Cape May summers - recalled after one contextual cue (Maya) in this call." "Cape May summers - recalled unaided in 6 of 8 recent calls." The caregiver receipt beside it: "No correction, no distress." Never a total, never a score, never a color-coded verdict.
- **77-90s**: Provenance receipt: original waveform, literal transcript, 2 silence trims, 0 generated first-person words, store-confirmation and share-confirmation timestamps + content hash, the retrieval-layer update ("Maya logged as an effective cue for Cape May summers"). Final line: "Cues, not answers - every memory stays in her own words."

**Ladder annotation (why the path looks the way it does).** Free recall is tried and logged as a genuine miss before any cue is given - Relay never opens with a hint. Context alone isn't enough, so association fires next; recognition and reorientation never fire because association succeeds, which is the point: the ladder stops climbing the moment she reaches the memory herself. Do not "improve" the path by skipping straight to a cue, and do not have the reorientation rung fire when a lower rung would have worked - that violates least-support-first (§6.1).

**Receipt wording note.** "No correction, no distress" must be derivable from logged observable events (no correction line spoken, no distress-signal event), never an inference about her. See Appendix B, item 2.

**Side route, not in the 90 seconds.** The seed also holds a Lincoln Elementary history that triggers a topic-level change line (§6.4.4), for judge Q&A. It does not trigger the summary line, which needs three topics. A second prerecorded branch, the safety handoff (rule 15), is also kept for judge Q&A: she says a phrase on the safety list, Relay speaks the fixed safety line, and a fixed-text alert appears on the designated caregiver's screen with a "Call Susan" button. It is not part of the 90 seconds.

## 5. State machine (single source of truth)

One reducer drives every pane of the UI. All visual, audio, and trace effects key off the same transition data so the demo can never contradict itself.

```
idle -> scheduled -> policy_passed -> connected -> topic_selected -> asking
     -> lost -> reanchored -> recalled -> confirming -> confirmed -> stored
```

The call session nests as: `connected { greet -> select_topic -> ladder* -> capture -> confirm }`. The `confirm` step asks two questions in order, before anything is committed: the store question ("Want me to remember that?") and, only if she said yes to it, the share question ("Would you like me to share it with your family?"). A yes to the store question is required; the share answer (yes, no, unclear, or timeout) sets a `shared` flag and never blocks storing. Commit happens at `confirmed -> stored`, after both questions resolve. Because commit comes last, a stop at the share question leaves nothing stored (rule 12).

Separately, the family flows run as their own short-lived flows, entirely outside this reducer, and never touch `connected` state: `handle_family_query` runs `query_received -> redirected` and never reads graph content into its output; `contribution_received -> stored_as_family_claim`; `note_due -> posted`; `record_viewed`; `export_requested -> exported`.

**Terminal exits.** Five absorbing states besides `stored`: `blocked`, `no_answer_today`, `not_stored`, `stopped`, `safety_handoff`. Nothing leaves a terminal state.

Deterministic failure transitions, no model judgment:

| Trigger | Transition | Data effect |
| ----- | ----- | ----- |
| Policy denies the topic, window, or caller isn't her | -> `blocked`; the call is never placed | nothing ingested |
| First quiet window on a rung | stay; Relay says the backchannel ("Take your time.") and waits | nothing stored |
| Second quiet window on the same rung | -> `lost` and the next rung, or `no_answer_today` if it is the second escalated silence | unconfirmed audio deleted at call end |
| Store confirmation = no or unclear | -> `not_stored`; kind close | contribution and unconfirmed audio deleted; metadata event only |
| Share confirmation = no, unclear, or timeout | proceeds to `stored`; `shared = false` | contribution stored; nothing posted to family |
| Stop: hang-up, explicit stop, or caregiver pause, from any non-terminal state | -> `stopped`; no follow-up call | same as above |
| Tool timeout mid-call | fixed script: restate the current question once, then close kindly -> `no_answer_today` | same as above |
| Identity, evidence, or policy missing or mismatched | flow stops; Relay falls back to the narrowing line (rule 7) | nothing further ingested |
| Graph claims conflict | speak neither; ask the open question again, or move on | conflicting claims stay unspoken, linked by `CONTRADICTS` |
| Family query received, at any time, independent of call state | -> `redirected`; the fixed redirect line only | only a topic-category + timestamp event logged, never the question text (rule 8) |
| Weekly Note cap already reached for a member | nothing posted | none |
| Dashboard access revoked for a member | no view, no post, before the next load | access event logged |
| Final turn of hers matches the safety list, at any point in a call (checked before any other processing of that turn) | -> `safety_handoff`; recall flow dropped; fixed safety line spoken once; one fixed alert to the designated caregivers | safety event (category + timestamp) only; audio deleted at call end |
| Hang-up in the same turn as a safety match | the safety match takes priority; the alert is sent | same |
| She asks who or what Relay is, or whether it is a person | fixed identity line, then the flow continues or closes | none |

Reducer invariants: one transition table; an unknown (state, event) pair throws and logs; terminal states are absorbing; `stopped` is reachable from every non-terminal state, except that a safety match in the same turn outranks it; the safety check runs on every final turn of hers before any other processing; every transition emits exactly one trace event carrying its tool-call IDs. The max call length from setup is enforced by the reducer, and expiry triggers the kind close. Every terminal state still yields a caregiver-receipt entry stating observable facts only, never a reason inferred about her.

## 6. Tool contracts

The model selects calls but cannot bypass gates. Retrieval, confirmation, and storage are enforced services, not decorative wrappers. Every call logs input/output JSON, latency, source IDs, policy decision, and state transition for the judge console (and exposes none of it to her).

1. `get_next_recall_topic(person_id, schedule_context)` -> the person/place/event/preference node due for revisit, ranked by freshness - so the same memory comes round again, call after call - then by how often it has been told, then by when in her life it is from where a person has said (ages 6–30, then recent, then the years between), then by the retrieval layer (6.3), constrained by the topic allow/block list. Deterministic ranking; the model does not free-pick a topic. Family-sourced, unconfirmed nodes are eligible (6.4.1). Default topics are Place, Event, and story nodes; a Person node is a topic only if the caregiver enables that in setup (6.1).
2. `place_recall_call(person_id, window)` -> initiates the call only within her approved windows. Hard gate; it also requires the setup attestations that the number is saved in her phone under a family-chosen name and photo and that Relay has been introduced to her (rule 16).
3. `query_context_graph(topic, max_hops=2)` -> ranked candidate subgraph with citations, not prose.
4. `verify_claim_support(claim_ids)` -> checks direct evidence, contradictions, freshness, speaker attribution. Unsupported context cannot be spoken.
5. `assess_conversation_state(audio_window, turn_history)` -> `recalled | asked_repeat | no_answer | new_detail_offered`, plus evidence. Observable state only; never emotion or cognition.
6. `select_scaffold(state, verified_subgraph, retrieval_hints)` -> chooses the least support per the ladder in 6.1. Records rejected lower rungs and why. Enforces the family-sourced limit (rungs 1-3 only).
7. `render_prompt(scaffold_id, citations)` -> verbalizes only cited facts or fixed procedural lines (6.2). Never fabricates her first-person speech.
8. `capture_contribution(audio_intervals)` -> literal transcript + edit-decision list limited to silence/disfluency trims. A deterministic check rejects any segment containing model speech or blocked content. Source audio stays immutable.
9. `confirm_and_store(contribution_hash)` -> plays the exact captured line back, records yes/no/unclear. On yes, commits it as a new claim/edge with full provenance (speaker, source, timestamp). Otherwise nothing is stored (rule 3).
10. `record_retrieval_outcome(topic_id, scaffold_id, state)` -> writes two independent records: the retrieval layer (6.3), and a `TopicOutcome` event (6.4.3). Neither is exposed as a score.
11. `receive_family_contribution(claim, contributor_id, provenance)` -> the asynchronous capture path: a family member adds a photo, voice note, or story outside a call, tagged with their identity, medium, and timestamp. Stored as that contributor's claim with `patient_confirmed: false`; never silently promoted to a fact about her (§7, rule 13).
12. `handle_family_query(question, requester_id)` -> deterministic redirect only (rule 10). The returned text is always the fixed redirect line or a neutral "nothing to point you to yet"; it is built without ever reading graph content into the response, so there is no path by which a claim can leak into it.
13. `build_caregiver_receipt(session_id)` -> summarizes one session's observable supports and outcomes with citations. No cross-session comparison, trend, or clinical score (rule 4). The per-topic record (6.4.3) is a separate surface.
14. `build_weekly_note(member_id, week)` -> assembles the Weekly Note per 6.4.2. Enforces the 7-day cap, the section order, and the whitelist projection.
15. `get_topic_record(member_id)` -> returns the per-topic record and any change lines (6.4.3, 6.4.4). Reads only `TopicOutcome` through a whitelist projection (topic name, counts, dates); cannot read claims or transcripts.
16. `export_record_for_clinician(requester_id)` -> approved-member-initiated export of the same per-topic content plus the fixed non-clinical note. Logged. Relay never sends it to anyone.
17. `confirm_share(contribution_hash)` -> plays the exact line back, records yes/no/unclear. Only on yes may the line appear in a Weekly Note.
18. `check_safety_phrases(final_turn)` -> deterministic lexical match of her final turn against `/fixtures/safety-phrases.json`; returns a category or none. Runs first on every final turn of hers, before any other processing. Never a model judgment, never applied to Relay's own speech. Expect false positives; a neutral alert is the cost of avoiding false negatives.
19. `send_safety_alert(category, caregiver_ids)` -> sends the fixed alert text for the category, through the channel chosen in setup, to the designated caregivers only. At most once per category per call. Contains the category and time, never her words or audio. Logs a `SafetyEvent`. Not a Weekly Note and not subject to its cap.

**Tools 14-17 read through a whitelist projection of allowed fields, never the raw graph**, so the leak guarantee is structural, not a filter that could fail.

Enforceable sequence for a call (tool 18 runs first on every final turn of hers, ahead of everything below): pick topic -> place call within window -> query permitted graph -> verify evidence -> assess conversation state -> select least-helpful scaffold -> render only cited context -> capture contribution -> play back for store-confirmation -> if yes, ask for share-confirmation -> commit only if store-confirmed -> record retrieval outcome and topic outcome -> build caregiver receipt. Family flows (`handle_family_query`, `receive_family_contribution`, `build_weekly_note`, `get_topic_record`, `export_record_for_clinician`) never enter this sequence.

### 6.1 Support ladder (least support first)

`select_scaffold` climbs this ladder and never skips upward for speed, and never starts above rung 1 even when the retrieval layer already knows a good cue (6.3).

| Rung | Support | Example |
| ----- | ----- | ----- |
| 1 | **Free recall**: an open invitation naming the topic, no cue | "I'd love to hear about the summers at Cape May. What comes to mind?" |
| 2 | **Context**: names the category only (a relationship, or the kind of place or event) | "It's a place your family went together." |
| 3 | **Association**: one cue tied to a shared place, event, or preference | "You and Maya used to go there together." |
| 4 | **Recognition**: a forced choice between the correct answer and a genuinely plausible alternative, order not hinting at the answer | "Did you go to Cape May with your sister or your daughter?" |
| 5 | **Reorientation**: offers a fact directly - for **procedural or functional information only**, framed as offering and never as correcting. **Never used for an autobiographical or identity memory**: for those the ladder ends at rung 4 and the call closes kindly | "This button plays your message." (Relay has no procedural topics today, so its script has no rung-5 line at all.) |

Rules:

- Climb one rung at a time; never jump straight to reorientation. Log every rung tried, in order, with its outcome.
- **Relay never states an autobiographical or identity memory outright.** Errorless learning, the evidence usually cited for a "state the fact" rung, covers new procedural learning, not a fact she already knows and cannot reach; and repeated correction is the documented harm in reality orientation. A topic category in `call-script.json` declares `memory_kind`; only a `procedural` one may carry a reorientation line, and the script schema, `select_scaffold`, and the reducer each refuse it otherwise. If rung 4 does not reach it, Relay closes kindly and the memory comes round again on a later call.
- **Invitations, not identification questions.** Rung-1 prompts are open invitations ("I'd love to hear about...", "What comes to mind when you think of..."). Relay never opens with "Who is...?", "Do you remember...?", or any identification or yes/no test. Place, event, and story nodes are the default topics. A person node is a topic only if the caregiver enables that in setup, and is then opened as an invitation ("I'd love to hear about Maya").
- Each rung fires at most once per topic per call. A failed rung is never repeated; the next one is tried, or the call moves on.
- Rungs 1-4 never state the answer outright (rung 4 offers it only among plausible choices). Rung 5 is the sole exception (rule 6) and exists because silence at that point is worse than a kind, attributed answer - it is still never phrased as a correction ("no, actually...") and it is never reached before rungs 1-4 have each been tried in order.
- **Recognition-neutrality:** a rung-4 alternative must be a genuinely plausible relationship or fact, never an absurd distractor that telegraphs the right answer, and the presentation order must not itself hint at which is correct.
- **A recognition pick is not a memory.** After rung 4, Relay asks one open follow-up. Only the elaboration goes through capture. Silence, "I don't know," or a repeat of the offered choice with no new content stores nothing. The raw pick is never a claim.
- **Person first.** When a rung-2 or rung-3 cue can be a person/relationship or a place/photo/event detail, the person is offered first. The retrieval layer only chooses among cues of the same kind.
- **Family-sourced, unconfirmed claims (rule 13):** the ladder for these stops at rung 3. The rung-3 cue is attributed to the contributor ("Maya mentioned a trip to Cape May...") and followed by an open question. Rungs 4 and 5 are disabled for them, because a forced choice or a stated fact could plant a false memory. If rung 3 doesn't reach it, Relay moves on with the kind close and the item stays in the graph.
- This is not a recall test. If she answers correctly at rung 1, the call simply continues; nothing is scored, timed, or compared to a prior session in front of her.
- Every rung outcome is logged as an observable event: which rung fired and the response latency after it.

### 6.2 Call conduct (Relay's voice)

- **Identity.** Caller ID and the saved contact name Relay and show a family-chosen photo. The first line of every call says in plain words that Relay is an AI assistant set up by a named family member, then invites her to talk about the topic warmly, never diagnostically (see the golden-path opener). If she ever asks who or what Relay is, or whether it is a person, it gives the fixed identity line (rule 16) and then continues or closes, as she wishes.
- **What Relay never asks.** Money, account numbers, passwords, addresses, or any other identifier, and it never asks her to do anything except talk.
- **Pace and shape.** One idea and one question at a time, plain words. No jargon, no lists read aloud. Simplify by shortening sentences and cutting subordinate clauses, not by slowing down: it is syntactic complexity, not speech rate, that costs comprehension. The lint enforces at most one question per line and at most 16 words per sentence, from `call-script.json`.
- **When, and for how long.** The joint setup defaults to morning call windows, and a call is 8 minutes by default and never more than 10. A family may widen the windows; the setup schema will not accept a longer call.
- **What a yes is worth.** Relay logs the kind of prompt beside every reply (`open`, `forced_choice`, `yes_no`), because a yes/no answer is the format most open to a yes that means no. A memory is never stored on a bare yes: she has just heard her own words played back.
- **Held silence.** The first quiet window on a rung is not a miss. Relay says the backchannel line (`BACKCHANNEL-WAIT`) and waits again. Only the next quiet window on that rung is a `no_answer` that climbs or wraps up. A spoken "I don't know" still climbs at once.
- **Fixed procedural lines.** Every line that carries no factual claim (greeting, topic-intro template, each ladder-rung template, store-confirmation request, share-confirmation request, thanks, kind close, narrowing line, restate-once fallback, backchannel, family-redirect line, identity line, safety line) lives in `/fixtures/call-script.json` with a stable script ID. Template slots are filled only from graph node values. Every other Relay line must carry citations (rule 6).
- **Live-model voice.** The judged path never generates a line. The live side-demo model is bound by `/fixtures/call-persona.md` and the few-shot bank in `/fixtures/question-bank.json` (see `lib/script/persona.ts`). It still cannot skip a gate, invent her words, name a mood, or speak a line that is not a reviewed script ID or a cited fact. Facilitator techniques live in `/fixtures/reminiscence-techniques.md`; they are subordinate to this file.
- **Attribution.** "You told me..." only when the claim's speaker is her. A claim by anyone else is phrased with its author ("Maya mentioned..."). A mismatch fails closed.
- **Language.** The banned-phrase lint (§12, test 8) covers rule 11 plus diagnostic and emotional-state words. The starter banned list lives in the script fixture and grows, never shrinks.
- **Closing.** Always kind. A close after no answer never frames the outcome as a failure.

### 6.3 The retrieval layer (personalization)

Alongside the memory graph, Relay keeps a second, thinner layer: which rung and which specific cue actually got her to a memory, per topic node - the design doc's "Maya: useful cue Cape May; ineffective cue wedding year."

- **What it stores:** per topic node, per cue candidate - a rung id, an effectiveness count, and a last-used timestamp. Nothing else.
- **What it's for:** when rung 3 or 4 needs to pick which candidate cue to offer, person/relationship cues are already in front (6.1). This layer only orders cues of the same kind: it prefers one it marks effective for her. It never decides *whether* to climb the ladder, and it never promotes a photo over a person.
- **What it is never:** a trend line, a decline indicator, a score, or anything shown to family. The retrieval layer is never displayed. Family-visible information comes only from the separate per-topic record (6.4.3).
- **Controls:** editable and deletable by her caregiver at any time from setup; deleting it resets Relay to person-first climbing with no preference among cues of the same kind. Deleting it does not delete the per-topic record, and vice versa; they are independent stores.

### 6.4 The family surface

Family are part of the loop, but passively and lightly. Every element below lives on the family side, is never shown to her, and reads through the whitelist projection (§6, tools 14-17).

**6.4.1 Family contributions ("Tell Relay about a memory").**

- A separate, clearly labelled, one-way form: "Tell Relay about a memory you share with Susan." It cannot return anything from the graph. Fields: who, what happened (a few sentences), roughly when/where (optional), optional photo. Stored via `receive_family_contribution` with contributor, medium, timestamp, and `patient_confirmed: false`.
- If text entered here begins as a question, the form rejects it with a short hint: "This box is for telling Relay something you remember. To find out what Susan remembers, give her a call." This keeps the redirect-only "Ask about Susan" box (rule 10) and the contribution form from being confused.
- Topic selection may pick a family-sourced claim like any other node. The ladder still starts at rung 1 (a cue-free open question). The attributed cue arrives at rung 3. See 6.1 for the rung 1-3 limit.
- If she elaborates, the elaboration goes through capture and store-confirmation like any other contribution. Her account and the family member's stay separate, linked claims. If they differ, they are linked by `CONTRADICTS`, neither is spoken, and the difference may appear as a difference prompt in the Weekly Note (6.4.2). Relay never says which account is right.

**6.4.2 The Weekly Note (the only thing Relay posts).**

At most one per approved member per 7 days, assembled by `build_weekly_note`, shown only on the dashboard (no push, text, or email). It may contain, in this order, each only if applicable:

1. **A warm line, topic-only and observable.** Example: "Relay talked with Susan about the summers at Cape May this week. Want to give her a call?" Not "She was thinking of you" - that claims her inner state (rule 4).
2. **A consented share** (at most one): a line she chose to share after playback (rule 10), attributed to her, with timestamp and provenance.
3. **One gap or difference prompt** (at most one): a gap ("Cape May has no year yet. Do you remember one?") or a difference ("Susan and Maya remember this differently. Want to call her about it?"). Relay never says which account is right.
4. **One fixed pointer line, only when a change line is active on the record** (6.4.4): "There's a new note on Susan's record."

All fixed lines live in `/fixtures/family-copy.json` with script IDs and are covered by the banned-phrase lint. An empty week posts nothing. The pointer line and every other note component count toward the single weekly note; the per-topic record itself is a view, not a post. Safety alerts (rule 15) are separate, fixed-text, sent only to the designated caregivers, and never appear in or count toward the Weekly Note.

**6.4.3 The per-topic record (a view, not a post).**

- Available to approved members, at their chosen detail level (rule 14).
- Per topic, from logged `TopicOutcome` events: of the last 8 calls that included the topic, how many she reached it unaided, after a cue, or needed a recognition prompt. Example: "Maya - recalled unaided in 6 of 8 recent calls."
- Fewer than 3 calls for a topic: show "not enough calls yet."
- No total across topics, no ordering by concern, no color-coded good/bad, no arrows. Plain counts and dates.
- Fixed header, always visible: **"This is a record of what happened in Relay calls, not a measure of Susan's memory overall. Practice on a topic, call quality, and time of day all affect it."**
- Contains no claims, transcript text, or graph content. Topic names and event counts only.

**6.4.4 Change lines (deterministic, non-clinical, informative).**

These are views computed on load from `TopicOutcome` events. They are never pushed, never counted as Weekly Notes, and never paired with a cause.

- **Topic line.** For any topic with at least 8 recorded calls, compare the most recent 4 calls to the 4 before them, counting calls where she reached the memory unaided. If the counts differ by 3 or more, in either direction, show a neutral line: "Lincoln Elementary - recalled unaided in 1 of the last 4 calls, compared with 4 of the 4 before."
- **Summary line.** If 3 or more topics show a topic line in the direction of less unaided recall, show this fixed line (`FAM-CHG-01`): **"In recent Relay calls, more prompting was needed across several topics than in earlier calls. This is a record of Relay calls, not a clinical assessment. If you have concerns, you can export the record to share with a doctor."**
- All thresholds (window sizes, minimum calls, the difference of 3, the 3-topic minimum) live in `/fixtures/record-thresholds.json`. They are **not clinically validated** and are expected to change. The same events must always produce the same output.
- Comparison is only against her own earlier Relay calls, never against a population norm or a clinical cutoff (rule 4).

**6.4.5 Clinician export.**

`export_record_for_clinician` is initiated by an approved member. It produces a file of the per-topic counts, dates, any change lines, and the fixed header, plus: "This record is not a clinical assessment or diagnosis." Relay never sends the file to anyone. The export is logged (who, when) and visible to all approved members.

## 7. Knowledge graph and provenance schema

Keep the graph compact and private. Do not import a large ontology or FHIR. This is not a clinical record.

**Node types (18):** Person, Relationship, Place, Event, EpisodicClaim (a story or fact), Preference/Expertise, Artifact (photo/audio), AccessPolicy (call windows, topic allow/block list), Session (a recall call), Contribution (her confirmed spoken content), RetrievalRecord (§6.3's per-cue effectiveness metadata), FamilyQueryEvent (topic category + timestamp only, per rule 8), WeeklyNote, ShareConfirmation, TopicOutcome (per-topic call outcome, §6.4.3), ExportEvent, DashboardAccessGrant, SafetyEvent (category + timestamp + recipient only, per rules 8 and 15).

**Edges:** RELATED_TO (typed: mother_of, sister_of, etc.), LOCATED_AT, OCCURRED_AT, WORKED_AT, DEPICTS, ABOUT, EVIDENCE_FOR, SPOKEN_BY, CONTRIBUTED_BY, RECALLED_IN, CUE_EFFECTIVE_FOR, CUE_INEFFECTIVE_FOR, CONTRADICTS, DERIVED_FROM, INCLUDED_SPAN, SHARE_CONFIRMED_BY, POSTED_IN, OUTCOME_OF (TopicOutcome -> Session).

**Every claim and edge carries:** source_id, exact span or media hash, observed_at, speaker/author, extraction method, confidence, expiry, and supersedes/contradicts links. Every claim also carries `patient_confirmed` (bool). No inferred diagnosis, mood, competence, or relationship is ever stored as fact.

**`TopicOutcome` fields:** session_id, topic_id, first_rung_reached_unaided (or none), highest_rung_used, timestamp. Nothing inferred.

**Ask, don't assert.** The graph never decides "this is Maya, Susan's daughter" from face clustering or photo metadata. Onboarding surfaces a candidate ("Who is this?") and a named person answers it ("That's Maya, my daughter" / "This was at my wedding in New Jersey in 2008"), each recorded with speaker, medium, and timestamp. That's the only way an identity or relationship binding enters the graph. A mismatch blocks the flow (rule 7).

**Human authorship of claims.** Every claim has a named human speaker or author, never a model. Extraction may transcribe and segment; it may not add facts. A claim contributed by a family member keeps that author on every read and is spoken to her as an attributed cue ("Maya mentioned..."), never presented as her own memory (rule 13). Where contributions conflict, both stay, linked by `CONTRADICTS`, and neither is spoken until resolved.

**Four layers:** (1) immutable raw evidence (photos, voice); (2) extracted claims with citations; (3) ephemeral session state; (4) contribution + confirmation + retrieval-outcome audit. Public/open seed data covers only general entities (places, relationship types). Private family claims come only from consented family contributions.

**Demo seed (20-30 hand-curated facts with real source clips), from the design doc's own example:** Susan mother_of Maya; Maya's wedding, 2008, New Jersey; Susan and Maya summered at Cape May (multiple corroborating claims); Susan sister_of Priya; Susan worked_at Lincoln Elementary; Susan lived_at Princeton. Retrieval-layer entries: Maya - recalled unassisted frequently, useful cue Cape May, useful cue family photograph, ineffective cue wedding year; Lincoln Elementary - increasingly needs the recognition rung; Cape May summers - useful cue Maya, useful cue family photograph, ineffective cue the year. `TopicOutcome` seed: Cape May summers, 8 recent calls (6 unaided); Lincoln Elementary, 8 calls whose counts trigger a topic line (§6.4.4) without triggering the summary line.

**Open-source basis:** LadybugDB (`@ladybugdb/core`: embedded property graph, Cypher, MIT; Kuzu's successor) for persistence. Graphology (MIT) for the animated judge view, not persistence. W3C PROV-O vocabulary for provenance concepts (attribute the spec). Schema.org vocabulary where useful (CC BY-SA 3.0; keep extensions in a separate Relay namespace with attribution). Wikidata (CC0) only for public place/entity IDs. Never import personal or health assertions.

**PROV-O mapping:** Person -> `prov:Agent`; Session -> `prov:Activity`; Artifact, Contribution -> `prov:Entity`; `SPOKEN_BY`/`CONTRIBUTED_BY` -> `prov:wasAttributedTo`; `DERIVED_FROM` -> `prov:wasDerivedFrom`; `RECALLED_IN`, `SHARE_CONFIRMED_BY`, and the retrieval-layer edges are Relay-namespace extensions.

## 8. Stack and repo layout

**Stack:** Next.js (App Router) + TypeScript + Tailwind + Framer Motion + Zustand (or a tiny reducer) + Lucide icons. LadybugDB for the graph. Deepgram streaming STT and Meta Muse calls behind the tool interfaces above. All media is local. No backend is required for the judged path.

**Layout:**

```
/app                 routes; /present is the autoplay judged route;
                     /family is the family-side app (contribution form,
                     "Ask about Susan" box, Weekly Note, per-topic record)
/components          SandboxShell, MemoryGraphView, CallStage, CueCard,
                     AgentTrace, AuthorshipRibbon, ContributionCard,
                     ConfirmGate, FamilyRedirectCard, DemoControls,
                     FamilyDashboard, WeeklyNote, TopicRecord,
                     ContributionForm, AskAboutSusanBox
/lib/state           the reducer and transition table (single source of truth)
/lib/tools           the 19 tool implementations + JSON schemas + gates
/lib/graph           LadybugDB schema, seed loader, citation queries, retrieval layer,
                     whitelist projections
/lib/provenance      hashing, edit-decision list, PROV-style event log
/fixtures            deterministic tool outputs, graph seed, policy seed,
                     call-script.json (fixed lines + banned-phrase list),
                     family-copy.json (family-side fixed lines),
                     record-thresholds.json (window sizes, minimums),
                     safety-phrases.json (safety list, categories, fixed alert lines),
                     call-persona.md + question-bank.json (live model only),
                     reminiscence-techniques.md (facilitator source, not spoken)
/assets              prerecorded audio/video/images (immutable once cut)
/scripts             seed, hash, verify, language-lint, and test runners
```

Rules: fixtures are data, not code branches; `/assets` media is never re-encoded after hashing; every citation in fixtures must resolve to a real span or hash in `/assets`.

## 9. Judged path vs live side demo

The 90-second judged path runs entirely on prerecorded call branches and deterministic fixture outputs. Telephony, ASR, model latency, and network access must never touch it. Preload every asset. The `/present` route hides controls and auto-advances; arrow keys step manually as a fallback.

A live model + live Deepgram/Muse path may exist as an optional side demo, behind a flag, never in the judged path. When it runs, Muse Spark is given the persona prompt and category-matched few-shot invitations (`lib/script/persona.ts`); it still only proposes among eligible cues, and `render_prompt` still speaks only a reviewed script line or a cited fact. The counterfactual (a version without the ladder, where Relay repeats "Who is Maya?" once and she says "I don't know") is prerecorded and clearly labeled as an alternate path, never as a claim about the person.

## 10. Visual direction and accessibility

Direction: **"The Living Graph"** - one desktop sandbox at 1440x900. A calm family room crossed with a film-editing table, not a caregiver portal. Lead with a human moment, reveal one state change at a time, and put technical UI on top of recognizable family media.

- **Left rail (28%):** the memory graph, growing live. Recognizable people/place/event nodes with small photos, provenance tags on hover ("Maya · Susan · voice recording"), and a quiet pulse when a call adds something new.
- **Center stage (48%):** "With Susan now." Large video/portrait loop, her name, and the current topic. One cue card at a time, matching the active ladder rung. No transcript crawl while she speaks. A small "Phone call" badge so judges know she never operates this UI.
- **Right rail (24%):** "How Relay helped." Human-readable event cards (Topic selected; Cue given; Recalled; Remembered - added to graph). Tool names as tiny monospace labels for judges.
- **Bottom:** one scrubber with the chapters from §4, including the family-redirect beat and the family dashboard.
- **Authorship ribbon:** a thin coral line that starts at whichever graph node the call is about, crosses center only when she speaks, and ends wrapped around the new contribution card. It never touches Relay's scaffold words.
- **Contribution card:** her name and timestamp, original waveform, literal transcript, provenance rows ("Source: live call", "Edited: 2 pauses trimmed, 0 words generated", "Confirmed by her voice", "Share confirmed by her voice"), and a wax-seal-style approval mark, not a generic check.
- **Family-redirect card:** shown when `handle_family_query` fires - the family member's app view, showing only the fixed redirect line, with a visibly empty "no graph content shown" state so judges can see the guarantee, not just hear about it.
- **Family app views (never shown to her):** (1) "Tell Relay about a memory," a one-way form; (2) the Weekly Note at the top of the dashboard, empty state "Nothing new this week"; (3) the per-topic record, plain counts, fixed header, change lines when active, and a secondary "Export for a doctor" button; (4) the small "Ask about Susan" redirect-only box, visually distinct from the contribution form; (5) the safety alert card, shown only to a designated caregiver: fixed text, category and time, and a "Call Susan" button. No push indicators, unread badges, streaks, or urgency styling on any family view, except the safety alert card (rule 15).

**Design tokens:** warm paper `#F6F1E8`, ink `#18342F`, sage `#B9CEC3`, coral `#E4775B` (authorship), amber `#D5A64A` (uncertain thread), 18px card radius. Literary serif only for large emotional lines; legible sans for all controls. Do not use Remento's aqua/forest pairing as the dominant palette. The per-topic record uses ink and sage only; no red/green or other good/bad coloring.

**Information hierarchy:** person/topic -> current cue or answer -> whether Relay is listening, helping, or waiting for confirmation -> provenance/trace. Never surface model confidence, clinical labels, or caregiver analytics in the primary view.

**Accessibility for her (hard requirements):** center stage only, one task, one familiar topic named at all times; minimum 24px cue text and 44px controls; high contrast; no all-caps; no translucent text over video; one photo or two plausible choices at rung 4, never a carousel; no countdowns, typing dots, diagnostic language, or moving traces visible to her; status in plain speech ("I'm listening," "Let's make this easier," "Want me to remember that?"); stable placement of name, question, choices, confirmation controls; respect reduced-motion; crossfades and position continuity, no zooms or confetti.

## 11. Build order (24 hours)

- **0-2**: Lock the script. Record the phone-call branches (free recall miss, context miss, association hit, recognition hit, reorientation) and the family-redirect assets. Define graph and policy fixtures. Write `call-script.json` (fixed lines, script IDs, banned-phrase list), `family-copy.json`, and `safety-phrases.json`.
- **2-5**: Next.js shell: memory-graph view and call stage.
- **5-8**: LadybugDB schema + 20-30 seeded facts, artifact hashes and citations, policy query, retrieval-layer table, `TopicOutcome` seed and `record-thresholds.json`.
- **8-11**: Deterministic tool service with JSON schemas and the reducer state machine. Hard gates around retrieval, confirmation, storage, and the family-redirect tool's zero-leak guarantee. Whitelist projections for tools 14-17.
- **11-14**: Audio playback, literal transcript fixture, edit-decision list, store- and share-confirmation hashes.
- **14-17**: Caregiver receipt and PROV-style event log. Family app views (contribution form, Weekly Note, per-topic record, change lines, export). Graphology judge view of the live-growing graph.
- **17-19**: Counterfactual (no ladder) split replay with clear labeling.
- **19-21**: Autoplay `/present` route plus arrow-key manual mode. Preload all assets. Remove network dependencies.
- **21-23**: Test the success, denied-policy, conflicting-claim, unclear-confirmation, no-confirmation, stop-anytime, double-lost-thread, tool-timeout, family-query, weekly-cap, revoked-access, change-line, safety-handoff, and identity-question branches. Run the language lint. Verify every visible claim and citation.
- **23-24**: Rehearse. Cut anything that slows the emotional beat. Capture the backup video.

**Hour-18 checkpoint (kill criterion):** if the adaptive-ladder loop (select topic -> climb ladder -> capture -> confirm -> store) is not demoable end to end by hour 18, cut scope in this order: (1) export UI and change-line UI (keep fixtures and the per-topic record), (2) live side demo, (3) Graphology judge animation, (4) Meta Muse live calls (keep fixtures). The safety handoff and the AI-identity line are never cut. Never demo the thin version: a phone call plus transcription with no ladder and no family-redirect guarantee is Remento with faster cadence and is not worth presenting.

## 12. Tests and acceptance criteria

Automated checks that must pass before the demo is called done:

1. **Golden path**: full reducer walk from `idle` to `stored` with fixture inputs, including the store and share questions; every transition emits its trace event.
2. **Gate tests**: storing without confirmation fails; storing with mismatched hash fails; `render_prompt` with uncited content fails; `render_prompt` with an attribution that doesn't match the claim's speaker fails; an identity/relationship binding without an approved source fails closed; `select_scaffold` jumping to rung 5 without trying 1-4 in order fails; `select_scaffold` never returns rung 4 or 5 for a `patient_confirmed: false` claim; `handle_family_query`'s output never contains a citation, claim ID, or graph-sourced string, under fuzzing; tools 14-17 outputs contain no claim ID, citation, or transcript string under fuzzing; `build_weekly_note` never includes text from a claim lacking a `ShareConfirmation`.
3. **Branch tests**: denied policy (no call placed), conflicting claims (neither spoken), unclear confirmation (nothing stored, audio discarded), declined confirmation (same), share declined or unclear (stored, nothing posted), two escalated quiet windows (first pause on a rung is a hold; the next is a lost-thread signal; two of those wrap up gently), a recognition pick with no new detail after the follow-up (nothing stored), tool timeout (one fixed restatement, then close), stop from every non-terminal state including the share question (nothing stored, unconfirmed audio deleted, no follow-up call), revoked approved contributor/topic (next call blocked), a family query at any point (redirect line only, zero graph content, only a topic-category event logged), Weekly Note cap (a second note within 7 days is not posted), revoked dashboard access (no view, no post, before the next load), differing family and patient accounts (note says "remember this differently," never picks one), export by a non-approved requester (fails), a question typed into the contribution form (rejected with the hint, not stored).
4. **Authorship invariants**: every stored contribution is her audio span or an attributed family claim, never model-generated; every edit appears in the edit-decision list; every spoken Relay line maps to citations or a script ID; generated first-person word count attributed to her is exactly 0.
5. **Provenance**: content hashes verify against `/assets`; every fixture citation resolves to a real span or hash; the receipt lists source, trims, store-confirmation, share-confirmation, timestamp, and hash.
6. **Determinism**: the judged path runs with the network disabled.
7. **Visual**: inspected at 1440x900; ribbon never touches scaffold words; contribution card renders seal, waveform, and provenance rows; family-redirect card visibly shows no graph content; reduced-motion mode swaps animations for crossfades; family views show no badges, streaks, color-coded verdicts, or urgency styling.
8. **Language and conduct**: the lint over `call-script.json`, `family-copy.json`, every rendered Relay line, all UI copy, the Weekly Note, the record header, the change lines, the export note, and the receipt finds no banned evaluative phrase (rule 11), no diagnostic or emotional-state word (rule 4), and none of the rule 9 words. Family-sourced rung-3 prompts must end in an open question (no yes/no phrasing). Rung-1 prompts must be invitations and never begin with "Who is" or "Do you remember"; no Relay line may ask for money, account numbers, passwords, addresses, or identifiers. Each rung fires at most once per topic; every rejected lower rung is logged with a reason.
9. **Receipt and record scope**: `build_caregiver_receipt` output has only per-session fields; the per-topic record has no total, ordering by concern, or coloring, shows "not enough calls yet" under 3 calls, and carries its fixed header; `record_retrieval_outcome` writes never surface in any UI; deleting the retrieval layer reverts scaffold selection to no-preference and leaves the per-topic record intact, and vice versa.
10. **Change lines**: the same `TopicOutcome` events always produce the same output; boundaries hold (7 calls: no topic line; a difference of 2: no topic line; a difference of 3: topic line; 2 flagged topics: no summary line; 3: summary line `FAM-CHG-01`); all thresholds are read from `record-thresholds.json`; change lines never send a push or count toward the Weekly Note cap; text comes only from fixtures.
11. **Safety and identity**: every phrase on the safety list, fed as a final turn of hers at every non-terminal call state, reaches `safety_handoff`, drops the recall flow, speaks the fixed safety line once, and sends exactly one fixed-text alert to the designated caregivers only; a hang-up in the same turn still sends it; the alert contains category and time and never her words, and appears nowhere else; a phrase in Relay's own speech never triggers it; the alert does not count toward the Weekly Note cap; the safety list can be changed only through the joint setup, never in-call; expected false positives (for example, "I fell in love with Maya") are accepted and produce only the neutral alert. The first line of every call contains the AI-assistant disclosure; the identity line answers each phrase on the identity list; `place_recall_call` fails without the saved-contact and introduction attestations.

End-card metrics the demo must be able to show: 100% of her attributed words are hers, number of ladder rungs used, 0 generated first-person words, 0 graph-content leaks through the family-redirect path, 0 clinical claims on any family surface, 0 push/text/email sent to family.

## 13. Branch and file ownership

- `main` is protected. Feature branches named `<owner>/<area>-<thing>` (e.g. `dev2/tools-gates`).
- Suggested ownership split so agents and people do not collide: `/components` + visual polish (frontend), `/lib/state` + `/lib/tools` (orchestration), `/lib/graph` + `/lib/provenance` + `/fixtures` (data), `/assets` + script recording (media).
- Changes to `/lib/state`, the tool JSON schemas, policy fixtures, `call-script.json`, `family-copy.json`, `record-thresholds.json`, `safety-phrases.json`, `call-persona.md`, or `question-bank.json` require a second person's review: they define the safety gates, what Relay may say, and what the family may be shown, including the family-redirect guarantee.
- `/assets` is append-only after hashing. Replacing a hashed asset requires re-running the provenance verification script.
- Commit small and often; rebase before opening work that touches the reducer.

## 14. Non-goals (do not build, do not "just add")

- **Relaying a family member's question to her, or her answer back to family, in any form.** This was the product's earlier direction and is now explicitly out of scope (Appendix A). Relay's only response to a family question is the redirect line.
- A "chat with her" interface, digital replica, or posthumous simulation, for family or anyone else.
- Speech-to-story rewriting or any polished narrative in her name.
- Diagnosis, staging, mood detection, cognition scoring, aggregate or severity figures, "decline," "improvement," or "progress" language, and any alert that compares her to a population norm or a clinical threshold. The per-topic record (§6.4) is counts-only; change lines compare her only to her own earlier Relay calls by the fixed rule in §6.4.4; the clinician export is member-initiated and labelled non-clinical.
- Face recognition or face clustering, bulk photo-library ingestion, location features, health-record import, continuous recording.
- Facebook Graph API or any mocked social integration.
- Hardware, robotics, or sensors.
- A large ontology, FHIR, or any clinical data model.
- A third sponsor integration.
- Calls, texts, emails, or push notifications to family members (the safety alert in rule 15 is the only exception), and any family-side unread-count, streak, or urgency mechanic.
- Emergency dispatch, fall detection, location, wearables, between-call monitoring, or any claim that Relay is an emergency service. The safety handoff is a fixed-phrase alert to a designated caregiver, nothing more.
- Any UI surface, on the family side, that displays a graph claim, transcript excerpt, or citation, except (a) the observable per-session caregiver receipt, and (b) a line she confirmed sharing, with provenance.

## 15. Quick checklist for agents

Before considering any task done, confirm:

- No generated first-person words attributed to her, no voice cloning, no persona simulation.
- Every gate (identity, policy, evidence, confirmation) still hard-fails closed.
- The 90-second golden path still runs offline, deterministically, in order, including the family-redirect beat and the family dashboard.
- Every spoken line has citations or a script ID; every stored contribution is hers or an attributed family claim.
- Family-sourced claims are flagged `patient_confirmed: false`, spoken only attributed with an open question, and never past rung 3.
- `handle_family_query` never surfaces graph content, under any phrasing of the question.
- Tools 14-17 read only through the whitelist projection; family surfaces show only counts, topic names, fixed lines, and lines she confirmed sharing.
- No calls, texts, emails, or push to family, except the safety alert (rule 15); at most one Weekly Note per member per 7 days.
- The first line of every call discloses that Relay is an AI assistant; Relay never asks for money or identifiers.
- The safety check runs first on every final turn of hers; the alert goes only to the designated caregivers, is fixed text, never quotes her, and is never cancelled by a hang-up.
- No medical, diagnostic, scoring, or evaluative language anywhere (the lint passes), including the rule 9 word list.
- A stop works from every state and leaves nothing behind but the audit metadata.
- The ladder climbs in order; the retrieval layer only ever picks which cue, never whether to climb.
- No new dependency, API, sponsor, or feature that this file does not name.

## Appendix A. Reconciliation with earlier versions of this file

An earlier version of AGENTS.md built Relay around a different mechanic: a family member forwards a live question, Relay calls the patient to get her answer, and delivers it back into the family thread with a provenance receipt. That version deliberately departed from the design doc's actual core product (periodic recall calls that help the person reach her own memories) to build something narrower and, it turned out, in tension with the design doc's own Kitwood principle: a bot that answers for someone is a reason to stop calling her. Reconciled 2026-09-19, at the user's direction, back onto the design doc. When the two disagree, this file wins; where this file is silent, the design doc governs.

| Earlier "Relay" idea | Decision | Where |
| ----- | ----- | ----- |
| Family forwards a question; Relay calls her to get an answer; delivers it to the family thread | **Removed entirely.** Relay never contacts family on her behalf and never delivers her words into a family channel outside a share-confirmation. | rules 5, 10; §14 |
| "Which sari should Anika wear?" / Diwali-dessert style demo | **Removed.** Replaced by the design doc's own "Who is Maya?" recall-call demo. | §4 |
| Assent gates delivery to a family audience | **Adapted.** Store-confirmation gates what enters *her own* memory graph. A separate share-confirmation gates any of her words appearing on the dashboard. | rules 3, 10; tools 9, 17 |
| Support ladder (repeat / name asker / restate options / one cue); never say "wrong" | **Adapted** to the design doc's five-rung ladder (free recall, context, association, recognition, reorientation), including the design doc's reorientation rung, which the earlier ladder didn't have. | §6.1 |
| Cross-call scaffold preferences ("retrieval layer") | **Promoted from deferred to core**, per the design doc's own framing of it as the stronger technical thesis - kept under the same non-negotiable constraints (observable-cue-only, never shown as a trend, deletable). | §6.3 |
| Zero generated first-person words; no voice cloning; evidence-bounded speech; hard-fail gates; data minimization; no evaluative language; always-works stop | **Kept unchanged** - these guardrails don't depend on which mechanic the product uses. | §2 |
| Caregiver receipt scoped to one session, no trends | **Kept unchanged** as a per-session receipt. The per-topic record is a separate surface. | rule 4; §6, tool 13 |
| Family-facing warm messages ("she was thinking of you today") | **Adapted:** topic-only, observable, folded into one Weekly Note per member per week. Her own words only after share-confirmation. | rules 5, 10; §6.4.2 |
| Family memory contributions prompting Relay to ask her | **Adapted:** stored as the contributor's unconfirmed claim, rungs 1-3 only, attributed, open questions. | rule 13; §6.1, §6.4.1 |
| Longitudinal caregiver record, "we noticed a change" alert, clinician export | **Adopted in narrowed form:** per-topic counts, fixed non-clinical header, deterministic change lines against her own earlier calls, member-initiated export. No aggregate score, no cause, no push. | rules 4, 8, 9; §6.4.3-6.4.5 |
| Family fact-checking of memories | **Adapted:** differences surface as "remember this differently - want to call her?" Relay never resolves them. | §6.4.1, §6.4.2 |
| No medical/retention/improvement claims | **Kept unchanged** and extended to the family surface. | rule 9 |
| Opening a call with "Who is Maya?" | **Replaced** with an open invitation naming a place or event topic. Person topics are opt-in. Never identification or yes/no test questions. | §4, §6.1 |
| No contact with family by Relay at all (rule 5 as written in revision 2) | **Narrowed:** one exception, a fixed-text safety alert to the designated caregivers only, agreed in setup. | rules 5, 12, 15 |
| Relay introduces itself only as "Relay" | **Extended:** AI-assistant disclosure on every call, saved-contact and introduction attestations, and never asking for money or identifiers. | rule 16; §6.2 |

## Appendix B. Open items for the team

These are not settled. Do not implement around them; ask.

1. **Resolved (2026-09-19, revision 2):** the team chose a per-topic, count-only longitudinal record visible to all approved members, deterministic change lines, and a member-initiated non-clinical export. Pitch language in this file stays stricter than the design doc's ("stay familiar for longer" is not used); confirm before submission that the write-up matches.
2. **Receipt wording vs rule 4.** The golden-path receipt line "no correction, no distress" must be derived from logged events only (no correction line spoken, no distress-signal event), never phrased as an inference about her emotional state.
3. **Sponsor limits and Muse access.** Unchanged from §3: the sponsor cap and Muse credentials are still to confirm with organizers.
4. **Thresholds are not clinically validated.** The record windows (last 8 calls), minimums (3 calls to show, 8 to compare), the difference of 3, and the 3-topic summary minimum live in `/fixtures/record-thresholds.json`, are placeholders, and may be changed later with a second reviewer. The same is true of the morning window, the 8/10-minute cap, the two-stage silence, and the 16-word sentence lint: they are design decisions informed by adjacent literature, not dementia-specific trial cutoffs. Do not invent more precise ones, and do not describe them as clinical.
5. **Consent over time.** Her agreement to the family view is given in the joint setup and is revocable. Her capacity to consent can change, so the setup prompts a periodic re-confirmation with her and her caregiver (rule 14). The write-up should say how.
6. **Hang-up at the share question.** Because commit happens after both confirmations (§5), hanging up at the share question stores nothing. This is the conservative reading of rule 12; revisit if it loses too many memories in practice.
7. **Safety list and outside review.** The starter safety list is a lexical match, so it will miss things and will sometimes fire on harmless phrases. Relay is not an emergency service and must not be described as one. Before any real deployment: have a clinician or speech-language pathologist review the ladder and the safety list, and get a lawyer's review of automated and AI-voice call consent, call-recording and voice-data laws, and the alert channel.
8. **Golden-path echo.** In the demo, her reply ("We went to Cape May every summer") repeats words from Relay's own opener and is then stored as new. Decide whether to add an echo rule (a reply that only repeats Relay's cue words is not stored as new) and script a detail the cue could not have supplied.
9. **Phone delivery is an extrapolation.** Reminiscence and cueing evidence is from human-facilitated, in-person sessions. Do not claim Relay is a proven therapy, and do not add a dementia-stage or GDS cutoff to the ladder.
10. **Rung 5's scope is this team's synthesis.** Errorless learning covers new procedural learning; reality orientation's "state the fact" precedent is contested. Do not widen the last rung to autobiographical or identity memory.
