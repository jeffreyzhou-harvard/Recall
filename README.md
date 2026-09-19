# Relay

Most dementia products help families manage the person. Relay helps the person keep reaching her own memories, and keeps the people around her calling her directly to do it.

Relay has two parts, built on one private memory graph:

1. **Capture.** She and the people who know her contribute memories — photos, voice, short stories — while those memories are still accessible. The graph holds people, relationships, places, events, stories, and preferences, each with visible provenance: who said it, and when.
2. **Retrieve.** Relay periodically calls her on an ordinary phone. It picks a personally meaningful memory and helps her reach it herself: free recall first, then progressively more context, only as needed. It also learns which cues actually help *her*, and prefers those next time.

Family stay in the loop without replacing her. They can contribute memories, open a light weekly note and a per-topic record of what happened in calls, and are pointed back to calling her.

Core loop: **CAPTURE → ORGANIZE → RETRIEVE → REINFORCE → LEARN → REPEAT.** Not: **CAPTURE → simulate the person.**

**Cues, not answers — every memory stays in her own words.**

If Maya wants to know what Susan remembers about her wedding, Relay does not answer from the graph. It says: *"Susan's talked about this before. Want to give her a call?"* and stops there. A product that answers family questions from a database of someone's memories is a reason to stop calling her. Relay exists to be the opposite.

Relay is not a digital replica, a "chat with her" interface, or a bot that relays decisions. It never impersonates her, never fabricates a first-person memory she didn't provide, and never becomes the thing family members talk to instead of her.

`AGENTS.md` is the complete brief, including the non-negotiables. `SPECS.md` is the locked design doc. When they disagree, `AGENTS.md` wins. HackMIT 2026, Healthcare track.

## Run it

```bash
npm install
npm run check        # typecheck + tests + language lint + provenance verify
npm run dev          # http://localhost:3000/present is the judged path
```

Node 22+. No keys, no database, and no network are needed for any of the above.

| Command | What it does |
| --- | --- |
| `npm run check` | `typecheck` + `test` + `lint:language` + `verify`. Must pass before a task is called done. |
| `npm run lint:language` | The banned-phrase and conduct lint (`AGENTS.md` §12, test 8) over every fixed line and every line Relay rendered on the golden path. |
| `npm run verify` | Asset hashes, seed validation, citation resolution, the judged path end to end, authorship invariants. |
| `npm run verify:strict` | The pre-demo gate. Same, but **fails while any placeholder media or placeholder word timing remains.** |
| `npm run assets:hash` | Re-hash `/assets` into the manifest. Refuses to touch a changed `final` asset without `--allow-replace`. |
| `npm run assets:placeholder` | Generate stand-in media. Never overwrites an existing file. |
| `npm run graph:seed` | Build an on-disk LadybugDB graph at `.data/relay.lbug` from the family seed, for Cypher poking. |

## How it fits together

Relay places a scheduled recall call to her, climbs a five-rung support ladder, captures her exact words, and stores them only after she hears the line played back and says yes. A second question asks whether to share that line with family. Family never trigger a same-moment call, and Relay never answers them from the graph.

```
idle → scheduled → policy_passed → connected → topic_selected → asking
     → lost → reanchored → recalled → confirming → confirmed → stored
```

The call nests as `connected { greet → select_topic → ladder* → capture → confirm }`. Confirm asks two questions in order: store ("Want me to remember that?"), then share ("Would you like me to share it with your family?"). Commit happens last. A stop at the share question stores nothing.

Family flows sit outside that reducer: a query is redirected, a contribution is stored as that contributor's unconfirmed claim, a weekly note is posted at most once per member per 7 days, and the per-topic record is a view, not a post.

| Piece | Where it lives |
| --- | --- |
| Reducer and transition table | `lib/state` — one source of truth; every pane keys off the same transitions |
| 19 tools and hard gates | `lib/tools` — topic pick, place call, graph query, evidence, ladder, capture, store- and share-confirmation, family redirect, weekly note, topic record, clinician export, safety check |
| Memory graph + retrieval layer | `lib/graph` — 18 node types, provenance on every claim and edge, a thinner per-cue effectiveness layer that never decides whether to climb, only which cue to try |
| Trims, hashes, receipts | `lib/provenance` — an edit-decision list that can only express silence and disfluency trims; hash-chained PROV-style log |
| Family app | `/family` — contribution form, "Ask about Susan" (redirect only), Weekly Note, per-topic record |
| Judged sandbox | `/present` — autoplay 90-second path; arrow keys step manually |

The model may select tool calls. It cannot bypass gates. Storing a claim without confirmation, speaking an uncited fact, leaking graph content through `handle_family_query`, or climbing the ladder out of order are hard fails.

**Support ladder (least support first):** free recall → context → association → recognition → reorientation. Climb one rung at a time. Rung 1 is an invitation ("I'd love to hear about the summers at Cape May. What comes to mind?"), never "Who is…?" or "Do you remember…?". Family-sourced, unconfirmed claims stop at rung 3 and are spoken only attributed, followed by an open question.

## Family surface

Family are part of the loop, passively and lightly. Nothing here is shown to her.

- **Tell Relay about a memory.** A one-way form. Stored as the contributor's claim with `patient_confirmed: false`. A question typed here is rejected with a hint to call her.
- **Ask about Susan.** Redirect only. The entire response is the fixed line pointing them to call her. No graph content, ever.
- **Weekly Note.** At most one per approved member per 7 days, shown when they open the dashboard. Topic-only, observable; her words only after share-confirmation; at most one gap or difference prompt.
- **Per-topic record.** Counts and dates from the last 8 calls that included a topic. No total, no score, no color-coded verdict. Fixed header: this is a record of what happened in Relay calls, not a measure of her memory overall.
- **Export for a doctor.** Member-initiated. The same counts, dates, and header, plus "This record is not a clinical assessment or diagnosis." Relay never sends the file to anyone.

Relay never calls, texts, emails, or pushes family, with one exception: a fixed-text safety alert to designated caregivers if her final turn matches a lexical phrase on the safety list. The alert states a category and time. It never quotes her. Relay is not an emergency service.

## The 90-second golden path

Cast is fixed: Susan, Maya (daughter), Priya (sister), Anika (granddaughter), Cape May, Lincoln Elementary, Princeton. Do not invent another.

1. Onboarding: Maya's photo, Susan names her, the graph node forms with provenance.
2. The phone rings as a saved contact, "Relay (from Maya)." Relay discloses it is an AI assistant Maya set up, then invites her to talk about summers at Cape May. It waits. She is unsure.
3. The ladder climbs: context, then association ("You and Maya used to go there together"). She reaches it. Relay does not rewrite her line. Store-confirmation, then share-confirmation. The graph grows from this call.
4. Later, Maya types "What did Mom say about her wedding?" Relay's entire response: **"Susan's talked about this before. Want to give her a call?"**
5. The dashboard shows the weekly note, the line Susan chose to share, and the per-topic record. Never a score.
6. Provenance receipt: her waveform, literal transcript, 2 silence trims, 0 generated first-person words. Final line: **Cues, not answers — every memory stays in her own words.**

`/present` runs this offline, on prerecorded branches and fixture outputs. Telephony, ASR, and the network must never touch it.

## What is built, and what is not

**Built, and covered by `npm run check`:** the recall loop end to end on fixtures - topic pick, the call gate, the five-rung ladder, capture, store- and share-confirmation, commit last, the retrieval layer - plus the safety handoff, the AI-identity line, all 19 tools, and the family side as an engine: the redirect-only ask box, the contribution path, the Weekly Note, the per-topic record with change lines, and the export, all behind a whitelist projection. `/present` runs the whole golden path, family beats included, as a plain engine check. The fixtures (`call-script.json`, `family-copy.json`, `record-thresholds.json`, `safety-phrases.json`) exist. `EVIDENCE.md` records the design choices that were checked against the literature.

**Not built:**

- **The interface.** `/family` and `/components` do not exist, and `/` and `/present` are unstyled scaffolds. Direction is "The Living Graph" (`AGENTS.md` §10). The family side is reachable only through `/api/family/*`, which has no sign-in yet.
- **A live call.** The earlier video call was removed. The call feature - her speech transcribed on the web app - is being built separately; it plugs in as a `CallDriver` plus a `TranscriptionProvider` (`lib/orchestrator/call-driver.ts` says what a driver owes the engine). Until then a call runs only on the prerecorded fixture, and a turn of the schedule is a manual, operator-only request.
- **Onboarding capture.** The "Who is this?" beat has no flow; her graph comes from the seed.
- **Real media.** Everything in `/assets` is a generated stand-in. Word timings are placeholders. See below.
- **`legacy/`** holds the earlier family-ask relay (forwarded asks, thread bridge, Telegram). It is out of scope (`AGENTS.md` §14), excluded from the build, and can be deleted once the team agrees.

## Replacing the placeholder media

1. Record, then drop the real file into `/assets` (keep the id; the extension may change).
2. In `assets/manifest.json`, update that entry's `path` and set `"status": "final"`. Set `duration_ms` by hand if it is not a PCM WAV.
3. `npm run assets:hash`
4. Re-derive word timings from the real recording and replace the call transcript fixture, setting `"timing_status": "measured"`. The pauses in her answer must still exceed 700 ms for the receipt to read "2 pauses trimmed".
5. `npm run verify:strict`

`/assets` is append-only after hashing. Relay's spoken lines in the recording must match `render_prompt` (or a fixed script ID) word for word: if they drift, the run stops rather than letting the audio say one thing while the trace shows another.
