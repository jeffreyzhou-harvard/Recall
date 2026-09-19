# Relay

Most dementia products help families manage the person. **Relay helps the person keep reaching her own memories, and keeps the people around her calling her directly to do it.**

Relay calls her, on a schedule, about something she or her family has told it - the summers at Cape May. It opens with an invitation, never a test. If she needs it, it gives a little more help, one rung at a time: context, then one cue, then a choice, and only at the very end the memory itself in her own earlier words. What she says is played back to her in her own recording; it is kept only if she says yes, and shared with her family only if she says yes to that too.

If a family member asks Relay what she remembers, it answers with one line: *"Susan's talked about this before. Want to give her a call?"* That is the point of the product.

**Cues, not answers - every memory stays in her own words.**

`AGENTS.md` is the complete brief, including the sixteen non-negotiables; read it first. Its Appendix C lists every place the code had to choose a reading of the brief. HackMIT 2026.

## Run it

```bash
npm install
npm run check        # typecheck + tests + language lint + provenance verify
npm run dev          # http://localhost:3000/present runs the golden path, and the family side, in the browser
```

Node 22+. No keys, no database, and no network are needed for any of the above.

| Command | What it does |
| --- | --- |
| `npm run check` | `typecheck` + `test` + `lint:language` + `verify`. Must pass before a task is called done. |
| `npm run lint:language` | The banned-phrase lint (AGENTS.md section 12, test 8) over every fixed line and every line Relay rendered on the golden path: no evaluative language, no diagnostic or emotional-state words, none of the rule 9 words, nothing that asks her for money or identifiers. |
| `npm run verify` | Asset hashes, seed validation, citation resolution, the golden path end to end, authorship invariants, the family redirect. |
| `npm run verify:strict` | The pre-demo gate. Same, but **fails while any placeholder media or placeholder word timing remains.** |
| `npm run assets:hash` | Re-hash `/assets` into the manifest. Refuses to touch a changed `final` asset without `--allow-replace`. |
| `npm run assets:placeholder` | Generate stand-in media. Never touches a `final` file. |
| `npm run graph:seed` | Build an on-disk LadybugDB at `.data/relay.lbug` from the seed, for Cypher poking. |

## How it fits together

```
the schedule ticks                       lib/service/relay-service.ts   runScheduledCall - takes no topic and no requester
  -> which topic is due                  tool 1   deterministic ranking; no model and no family member picks it
  -> may Relay call her, now, about it   tool 2   the joint setup: windows, frequency, allow/block, attestations (rule 16)
  -> what may be said                    tools 3-4  policy-bounded retrieval, then verification: who said it, is it hers
  -> the call                            lib/orchestrator/run.ts
       safety check, first, every turn   tools 18-19  a fixed phrase list -> a fixed alert to her designated caregiver
       what she observably said          tool 5   recalled | asked_repeat | no_answer | new_detail_offered. Nothing else
       the least support that fits       tool 6   the five-rung ladder; the retrieval layer picks WHICH cue, never whether
       a reviewed line, cited facts      tool 7   only lines in fixtures/call-script.json; attribution must match the speaker
       her exact words                   tool 8   literal transcript + silence/disfluency trims only
       "Want me to remember that?"       tool 9   played back in her own recording; her yes, or nothing is kept
       "...share it with your family?"   tool 17  her yes, or it never reaches a family surface
       commit - last                     tool 9   a new claim, in her words, with full provenance
       what happened on the topic        tool 10  the retrieval layer + a TopicOutcome. Neither is a score
       one session's observable receipt  tool 13

the family side (never pushed; read when an approved member opens it)
  tell Relay a memory                    tool 11  stored as THEIR claim, patient_confirmed false, rungs 1-3 only
  "Ask about Susan"                      tool 12  the redirect line. Always. No graph content, no question logged
  the Weekly Note                        tool 14  at most one per member per 7 days; her words only if she shared them
  the per-topic record, change lines     tool 15  counts and dates under a fixed header; compared only with her own calls
  export for a doctor                    tool 16  member-initiated, logged, labelled non-clinical, never sent anywhere
```

- **One reducer** (`lib/state`) drives everything: `idle -> scheduled -> policy_passed -> connected -> topic_selected -> asking -> lost -> reanchored -> recalled -> confirming -> confirmed -> stored`, five safe endings (`blocked`, `no_answer_today`, `not_stored`, `stopped`, `safety_handoff`), a stop from every state, and the ladder's order enforced a second time. A refused event is logged and then thrown.
- **The family tools cannot read the graph.** They run on a context that holds a whitelist projection (`lib/family/projection.ts`) and nothing else: topic names, counts, dates, booleans, and lines that start from her recorded yes to sharing. Their output contracts have no field a claim id, citation, or transcript could travel in. Tests fuzz both.
- **Fixed lines are data.** `fixtures/call-script.json`, `family-copy.json`, `safety-phrases.json`, and `record-thresholds.json` hold every word Relay can say or show that is not a cited fact, and every number the record uses. Changes need a second reviewer (AGENTS.md section 13).
- **Two graph stores, one answer.** `MemoryGraphStore` (browser, judged path) and `LadybugGraphStore` (embedded LadybugDB, Node). Parity tests run the whole golden path on both. Nothing can be deleted from either except the two record layers a caregiver may clear.

### Mock data

Kept deliberately small. `/fixtures` holds only what the judged path needs - the family graph, the joint setup, the four script files, and the call transcript - and `/assets` holds four stand-in media files. Earlier calls are one row each; the seed loader writes the Session, TopicOutcome, and cue record so they cannot disagree. Everything that exists only to exercise a failure branch lives in `/tests`, mostly derived from the judged data. Nothing under `/lib` may import a fixture; a test enforces it.

## The live side demo (video call, Deepgram, Muse Spark)

Optional, behind `RELAY_CALL`, never on the judged path.

```bash
RELAY_CALL=video npm run dev         # open http://localhost:3000/call/host and leave it open: it is Relay's end of every call
npm run build && npm run e2e:call    # one real call between two headless Chromes (needs Chrome)
npm run build && npm run e2e:live    # a whole recall session for real: Deepgram + Muse Spark, a few cents a run (macOS + Chrome)
```

With `DEEPGRAM_API_KEY` (and optionally `MUSE_API_KEY`) in `.env.local`, a turn of the schedule - `POST /api/live/schedule`, operators only - picks the topic that is due and, if the joint setup allows it now, places a WebRTC call. `/call/host` joins as Relay and shows her one-time link. Relay's lines are spoken on her device in the device's own synthetic voice, labeled "Relay". **Deepgram** turns her speech into words with timings. **Muse Spark** may pick which cue to offer where Relay has no preference of its own; it never picks a topic or a rung, and Relay's own choice stands if Spark is slow, wrong, or down. Her audio is wiped from the server when the call ends.

There is no route by which a family member can cause a call. The family routes are `/api/family/ask`, `/api/family/memory`, and `/api/family/dashboard`; there is no sign-in yet, so in production they need the operator secret.

Three things will bite outside `localhost`: her device needs **HTTPS** for camera and microphone; venue wifi usually needs a **TURN** server (`RELAY_ICE_SERVERS`); and rooms live in memory, so it needs a **long-running Node server**, not serverless hosting.

## What is not built yet

- **The interface.** `/` and `/present` are plain scaffolds, and `/family` and `/components` do not exist. Design goes through the Impeccable skill: run `/impeccable init` first.
- **Real media.** Everything in `/assets` is a generated stand-in, and the transcript's word timings are placeholders. See below.
- **Telephony.** The brief's call is an ordinary phone call; the live side demo is a video call because no telephony exists.
- **Sign-in**, and anything that decides two accounts differ. See AGENTS.md Appendix C, items 16-19.
- **`legacy/`** holds the earlier family-relay mechanic (intake, thread bridge, Telegram bot), which AGENTS.md section 14 rules out. It is not built, type-checked, or tested. Delete it once the team agrees.

## Replacing the placeholder media

1. Record, then drop the real file into `/assets` (keep the id; the extension may change).
2. In `assets/manifest.json`, update that entry's `path` and set `"status": "final"`. Set `duration_ms` by hand if it is not a PCM WAV.
3. `npm run assets:hash`
4. Re-derive word timings from the real recording and replace `fixtures/transcripts/call-golden.json`, setting `"timing_status": "measured"`. The two pauses in Susan's answer must still exceed 700 ms for the receipt to read "2 pauses trimmed".
5. `npm run verify:strict`

`/assets` is append-only after hashing. Relay's spoken lines in the recording must match `render_prompt` output word for word: if they drift, the run stops with a `ScriptMismatchError` rather than letting the audio say one thing while the trace shows another.
