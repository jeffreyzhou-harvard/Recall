# Recall

Most dementia products help families manage the person. Recall helps the person keep reaching her own memories, and keeps the people around her calling her directly to do it.

Recall has two parts, built on one private memory graph:

1. **Capture.** She and the people who know her contribute memories — photos, voice, short stories — while those memories are still accessible. The graph holds people, relationships, places, events, stories, and preferences, each with visible provenance: who said it, and when.
2. **Retrieve.** Recall periodically calls her on an ordinary phone. It picks a personally meaningful memory and helps her reach it herself: free recall first, then progressively more context, only as needed. It also learns which cues actually help *her*, and prefers those next time.

Family stay in the loop without replacing her. They can contribute memories, open a light weekly note and a per-topic record of what happened in calls, and are pointed back to calling her.

Core loop: **CAPTURE → ORGANIZE → RETRIEVE → REINFORCE → LEARN → REPEAT.** Not: **CAPTURE → simulate the person.**

**Cues, not answers — every memory stays in her own words.**

If Maya wants to know what Susan remembers about her wedding, Recall does not answer from the graph. It says: *"Susan's talked about this before. Want to give her a call?"* and stops there. A product that answers family questions from a database of someone's memories is a reason to stop calling her. Recall exists to be the opposite.

Recall is not a digital replica, a "chat with her" interface, or a bot that relays decisions. It never impersonates her, never fabricates a first-person memory she didn't provide, and never becomes the thing family members talk to instead of her.

`AGENTS.md` is the complete brief, including the non-negotiables. `SPECS.md` is the locked design doc. When they disagree, `AGENTS.md` wins. HackMIT 2026, Healthcare track.

## Run it

```bash
npm install
npm run check        # typecheck + tests + language lint + provenance verify
npm run dev          # http://localhost:3000/present is the judged path
```

Node 22.13+. No keys, no database, and no network are needed for any of the above. (Onboarding real households uses one SQLite file through Node's built-in `node:sqlite`: still no service to run and no new dependency. See "Onboarding" below.)

| Command | What it does |
| --- | --- |
| `npm run check` | `typecheck` + `test` + `lint:language` + `verify`. Must pass before a task is called done. |
| `npm run lint:language` | The banned-phrase and conduct lint (`AGENTS.md` §12, test 8) over every fixed line and every line Recall rendered on the golden path. |
| `npm run verify` | Asset hashes, seed validation, citation resolution, the judged path end to end, authorship invariants. |
| `npm run verify:strict` | The pre-demo gate. Same, but **fails while any placeholder media or placeholder word timing remains.** |
| `npm run assets:hash` | Re-hash `/assets` into the manifest. Refuses to touch a changed `final` asset without `--allow-replace`. |
| `npm run assets:placeholder` | Generate stand-in media. Never overwrites an existing file. |
| `npm run graph:seed` | Build an on-disk LadybugDB graph at `.data/recall.lbug` from the family seed, for Cypher poking. |

## Shared photo collection

`/caregiver` (also `/family`) opens the household's shared photos, moments, map, connections and attributed stories. `/revisit` opens photo storytelling, `/conversations` opens the existing private call records, and `/conversations/call` hosts scheduled patient calls. `/` introduces the collection; `/onboarding` creates an organizer account and records joint conversation preferences.

Photos retain their originals and available capture dates/GPS. OpenAI optionally groups and describes them and transcribes recordings for review. Email/password, single-use invitation links and existing access keys work for sign-in. Family invitations and explicitly opted-in photo reminders use Linq; copyable links work without messaging. Set the optional variables in `.env.example`. See [the collection guide](docs/PHOTO_FIRST_DEMO.md) and [its authorized scope](docs/PHOTO_FIRST_SCOPE.md).

The sidebar can be resized or collapsed and remembers its setting. **People** (`/caregiver#people`) groups similar faces when you choose **Find people**, using self-hosted open-source models in your browser, with no API key. Family members name and correct the suggestions. See [People and model limitations](docs/PEOPLE.md).

## How it fits together

Recall places a scheduled recall call to her, climbs a five-rung support ladder, captures her exact words, and stores them only after she hears the line played back and says yes. A second question asks whether to share that line with family. Family never trigger a same-moment call, and Recall never answers them from the graph.

```
idle → scheduled → policy_passed → connected → topic_selected → asking
     → lost → reanchored → recalled → confirming → confirmed → stored
```

The call nests as `connected { greet → select_topic → ladder* → capture → confirm }`. Confirm asks two questions in order: store ("Want me to remember that?"), then share ("Would you like me to share it with your family?"). Commit happens last. A stop at the share question stores nothing.

Family flows sit outside that reducer: a query is redirected, a contribution is stored as that contributor's unconfirmed claim, a weekly note is posted at most once per member per 7 days, and the per-topic record is a view, not a post.

| Piece | Where it lives |
| --- | --- |
| Reducer and transition table | `lib/state` — one source of truth; every pane keys off the same transitions |
| 21 tools and hard gates | `lib/tools` — topic pick, place call, graph query, evidence, ladder, capture, store- and share-confirmation, family redirect, weekly note, topic record, clinician export, safety check, missed-call alert, caregiver ack |
| Memory graph + retrieval layer | `lib/graph` — 18 node types, provenance on every claim and edge, a thinner per-cue effectiveness layer that never decides whether to climb, only which cue to try |
| Trims, hashes, receipts | `lib/provenance` — an edit-decision list that can only express silence and disfluency trims; hash-chained PROV-style log |
| Onboarding database | `lib/onboarding` — households, the people in them, stated ties, invitations, and every version of the joint setup, append-only. SQLite (`node:sqlite`) with an in-memory twin; the same rules run over both |
| Caregiver frontend | `/caregiver` (`/family` alias) — persisted session bookshelf, optional topic details/Weekly Note, attributed memory and private media contributions |
| Judged sandbox | `/present` — isolated fixture-based engine check |

The model may select tool calls. It cannot bypass gates. Storing a claim without confirmation, speaking an uncited fact, leaking graph content through `handle_family_query`, or climbing the ladder out of order are hard fails.

**Support ladder (least support first):** free recall → context → association → recognition → reorientation. Climb one rung at a time. Rung 1 is an invitation ("I'd love to hear about the summers at Cape May. What comes to mind?"), never "Who is…?" or "Do you remember…?". Family-sourced, unconfirmed claims stop at rung 3 and are spoken only attributed, followed by an open question.

## Family services (current backend contract)

Family are part of the loop, passively and lightly. Nothing here is shown to her.

- **Tell Recall about a memory.** A one-way form. Stored as the contributor's claim with `patient_confirmed: false`. A question typed here is rejected with a hint to call her.
- **Ask about Susan.** Redirect only. The entire response is the fixed line pointing them to call her. No graph content, ever.
- **Weekly Note.** At most one per approved member per 7 days, shown when they open the dashboard. Topic-only, observable; her words only after share-confirmation; at most one gap or difference prompt.
- **Per-topic record.** Counts and dates from the last 8 calls that included a topic. No total, no score, no color-coded verdict. Fixed header: this is a record of what happened in Recall calls, not a measure of her memory overall.
- **Export for a doctor.** Member-initiated. The same counts, dates, and header, plus "This record is not a clinical assessment or diagnosis." Recall never sends the file to anyone.

Recall never calls, texts, emails, or pushes family, with one exception: a fixed-text safety alert to designated caregivers if her final turn matches a lexical phrase on the safety list. The alert states a category and time. It never quotes her. Recall is not an emergency service.

## Onboarding

Before Recall's first call, a household is set up: her, the caregiver setting Recall up with her, and whoever they invite. `lib/onboarding` holds it, and the live server can run for a household from it (`RECALL_HOUSEHOLD=household:1`) instead of the committed fixture family.

- **One file, no service.** `SqliteOnboardingStore` uses Node's built-in `node:sqlite`, at `.data/onboarding.db` (git-ignored; `RECALL_ONBOARDING_DB` moves it). `MemoryOnboardingStore` is its twin, and `tests/onboarding.test.ts` runs every rule over both.
- **Two ways to change the setup, and the difference is the point.** `recordJointSetup` needs her AND a caregiver, and is the only way to add or widen anything. `tightenSetup` is what she, or a caregiver, may do alone at any time: revoke, narrow, pause (rule 12). It compares the new document with the current one and refuses, by name, anything that gives more - above all any change to the safety block (rule 15). Every version is kept, with who agreed and who recorded it; the table is append-only in the schema itself.
- **Nobody signs themselves up.** Family join by an invitation from her or a caregiver. The token is shown once, to the inviter, to pass on themselves - Recall never contacts family (rule 5) - and only its hash is kept.
- **Data minimization is in the schema (rule 8).** One phone number - hers - and nothing else about anyone: no diagnosis, stage, birth date, address, or email column exists, a family member's row cannot hold a number, and clinical or state language is refused in any name or note.
- **Ask, don't assert.** A tie between two people is recorded only because a named member stated it, in the word they used, and `graphSeed()` turns the household into the identity layer of her graph - people, stated ties, the setup - with no memories in it. Those come only from her own confirmed words, or a family contribution in its author's name.

Routes are under `/api/onboarding/*`. Private-key browser sessions enforce setup authority; accepting an invitation needs its one-time token.

## The 90-second golden path

Cast is fixed: Susan, Maya (daughter), Priya (sister), Anika (granddaughter), Cape May, Lincoln Elementary, Princeton. Do not invent another.

1. Onboarding: Maya's photo, Susan names her, the graph node forms with provenance.
2. The phone rings as a saved contact, "Recall (from Maya)." Recall discloses it is an AI assistant Maya set up, then invites her to talk about summers at Cape May. It waits. She is unsure.
3. The ladder climbs: context, then association ("You and Maya used to go there together"). She reaches it. Recall does not rewrite her line. Store-confirmation, then share-confirmation. The graph grows from this call.
4. Later, Maya types "What did Mom say about her wedding?" Recall's entire response: **"Susan's talked about this before. Want to give her a call?"**
5. The dashboard shows the weekly note, the line Susan chose to share, and the per-topic record. Never a score.
6. Provenance receipt: her waveform, literal transcript, 2 silence trims, 0 generated first-person words. Final line: **Cues, not answers — every memory stays in her own words.**

`/present` runs this offline, on prerecorded branches and fixture outputs. Telephony, ASR, and the network must never touch it.

## Connected application

The shared collection is persisted separately from the private patient-call graph. New organizers can sign up with email/password; invited relatives join through expiring links. Existing key-based accounts remain accessible. Joint setup, scheduled calls, topic approval, call confirmation, family records and exports retain their backend gates. Browser calls use microphone audio, final-turn transcription, Recall speech and original-audio confirmation playback.

Local sample families open with six fictional photographs in two groups: Home Garden Morning and Quiet Library Rooms. Connections starts with Susan, Maya, Priya, and Anika, their explicitly fictional family ties, and links to these moments; this creates no accounts, photo identities, or patient-call evidence. Upload the 12 original photographs from the Relay Family Photo Kit during the demo to create Our Cape May summer, A birthday around the table, The kitchen before Diwali, and A long weekend in Acadia. In sample families only, exact file hashes identify these fictional fixtures and apply their declared grouping without an API key, including across separate upload batches. Successful sample uploads play the grouping reveal for three seconds before showing the receipt. Other uploads use the normal photo organization pipeline. Caregivers can delete a photograph or photo group from its detail view; confirmation lists any stories and recordings that will also be removed. Deletion cleans up private media and People references. Patients have a prominent “Your Recall call” link in their photograph view.

Browser calls also display verified photographs attached to the approved conversation topic. Photos appear at the association rung or once she has reached the memory, remain visible while she answers and confirms, and disappear when the call ends. The opening unaided question remains photo-free. Multiple photographs have manual previous/next controls; an unavailable image does not interrupt audio. Image requests require the patient's session and the current call, and recheck topic/contributor permissions. Photos in the separate shared collection are not automatically approved call evidence; they need an attributed photo contribution linked to an approved call topic.

For the paired local demo, **Try the patient call demo** beneath **Explore a sample family** opens `/demo/call` in another tab. The tabs use separate signed caregiver/patient sessions for the same sample household, so opening either demo first works and returning preserves uploaded photos. Click **Start demo call**, then **Answer call** and allow the microphone. This uses the existing browser call engine, Deepgram speech/transcription (`DEEPGRAM_API_KEY`), and the normal store/share confirmation gates. Sample photo groups become attributed call topics; confirmed words persist in that household’s private graph, and only share-confirmed words appear as stories attached to their photo group and in Connections. The caregiver tab refreshes every three seconds. This local-only fictional setup never changes the deployment’s active household or sends external calls or alerts.

The call now displays live patient captions through the server-side Deepgram streaming client; these are temporary previews, and only final recorded turns can reach the confirmation gates. In Connections, select a connecting line to inspect its relationship and source. Shared demo call stories also include their actual backend edge type, properties and confirmation timestamps; the caregiver view never receives unshared call transcripts or the full private graph.

The safety engine includes phrase handoffs, missed-call tiering, caregiver acknowledgment and escalation. Delivery uses the configured dashboard or durable webhook channel. The fixture engine and its safety thresholds remain covered by `npm run check`.

The [knowledge graph](docs/knowledge-graph.md) now supports selected onboarding imports, continuous Muse-assisted updates, contributor interpretation review, graph-driven follow-ups and native Ladybug reads.

See [backend integration](docs/backend-integration.md) for configuration, verification and deployment limits. A real browser microphone/speaker walkthrough remains to be verified. The offline `/present` demo remains isolated and still contains placeholder recordings. The local contact/calendar import and question-request prototypes are not live ingestion paths.

## Replacing the placeholder media

1. Record, then drop the real file into `/assets` (keep the id; the extension may change).
2. In `assets/manifest.json`, update that entry's `path` and set `"status": "final"`. Set `duration_ms` by hand if it is not a PCM WAV.
3. `npm run assets:hash`
4. Re-derive word timings from the real recording and replace the call transcript fixture, setting `"timing_status": "measured"`. The pauses in her answer must still exceed 700 ms for the receipt to read "2 pauses trimmed".
5. `npm run verify:strict`

`/assets` is append-only after hashing. Recall's spoken lines in the recording must match `render_prompt` (or a fixed script ID) word for word: if they drift, the run stops rather than letting the audio say one thing while the trace shows another.
