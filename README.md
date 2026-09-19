# Relay

Most dementia products help families care for the person. Relay helps the person keep caring for the family.

A relative forwards one current question from the family thread. Relay calls Mom on an ordinary phone, helps her stay on the thread without supplying an opinion, captures her exact words, gets her spoken yes, and delivers her verbatim contribution back into the family's existing thread with a full provenance receipt.

**Access changed. Authorship didn't.**

`AGENTS.md` is the complete brief, including the non-negotiables. Read it first. `Rabbit_Product_Flow_Design_Spec.md` draws the end-to-end flow the code follows ("Rabbit" there is Relay). HackMIT 2026.

## Run it

```bash
npm install
npm run check        # typecheck + tests + provenance verify
npm run dev          # http://localhost:3000/present runs the judged path in the browser
```

Node 22+. No keys, no database, and no network are needed for any of the above.

| Command | What it does |
| --- | --- |
| `npm run check` | `typecheck` + `test` + `verify`. Must pass before a task is called done. |
| `npm run verify` | Asset hashes, seed validation, citation resolution, the judged path end to end, authorship invariants. |
| `npm run verify:strict` | The pre-demo gate. Same, but **fails while any placeholder media or placeholder word timing remains.** |
| `npm run assets:hash` | Re-hash `/assets` into the manifest. Refuses to touch a changed `final` asset without `--allow-replace`. |
| `npm run assets:placeholder` | Generate stand-in media. Never overwrites an existing file. |
| `npm run graph:seed` | Build an on-disk LadybugDB at `.data/relay.lbug` (family seed + the ask via real intake) for Cypher poking. |

## How it fits together

Two loops share one graph, and `lib/service` is the whole outside surface:

```ts
// participation: a family ask -> her own words -> her yes -> the family
await relay.forwardAsk(payload);              // a relative forwarded one ask (text + at most one photo)
const { recording } = await relay.runSession(threadId, sessionId);

// discovery: photos -> questions -> answers -> a richer graph the asks above can lean on
await relay.ingestLibrary(observations, grantedBy);
const questions = await relay.nextQuestions(3);
await relay.answerQuestion(question, answer);
```

`forwardAsk` is request intake. `runSession` walks the gates, places the call, captures her exact words, gets her yes, delivers, and sends the receipts - or stops safely. Everything it produced comes back as one `SessionRecording`: plain JSON that can be replayed to any moment, which is what the web views render.

| Flow spec node | Where it lives |
| --- | --- |
| Request intake (ask, audience, artifacts) | `lib/intake` - strict contract, no field for chat history; topics matched from the asker's own words |
| Identity and audience / policy / evidence / assent gates | `lib/tools` - a `GateKeeper` service that fails closed; the model picks calls but cannot reach past it |
| Scaffold ladder, capture, playback, publish | `lib/tools/impl`, walked by `lib/orchestrator` |
| Family thread: voice card, "clarify", "not this time", support receipt | `lib/bridge` - refuses anything that is not a reply to a forward it received |
| Live session view, receipt and provenance | `lib/session` - recording, `stateAt(t)`, and three view selectors |
| Discovery loop (photo observations, knowledge gaps, the support ladder, guarded answers) | `lib/discovery` - inference never silently becomes fact: every node and edge carries how it is known, and only a person's sourced word can raise it |
| Compact private context graph | `lib/graph` - 16 node types, 17 edge types, a closed relation vocabulary, provenance and epistemic status on every node and edge; in-memory store for the browser, LadybugDB for persistence, held to identical answers by a parity test |
| State sequence | `lib/state` - one pure reducer, one transition table; the trace carries its events, so it *is* the recording |
| Trims, hashes, receipts | `lib/provenance` - an edit-decision list that can only express silence and disfluency trims; hash-chained PROV-style log |

### Mock data

Kept deliberately small. `/fixtures` holds only what the judged path needs - the family graph, the policy, one forwarded-ask payload, and the call transcript - and `/assets` holds three stand-in media files. The ask's graph nodes are never hand-written: intake builds them from the payload, exactly as it would for a real forward. Everything that exists only to exercise a failure branch lives in `tests/fixtures.ts`, mostly derived from the judged data. Nothing under `/lib` may import a fixture; a test enforces it.

## Telegram bot

The family's thread is a Telegram group. Live only: the judged `/present` path never touches it.

1. Create a bot with [@BotFather](https://t.me/BotFather). **Leave group privacy mode on** - Telegram then sends Relay only `/ask` commands and the one message they reply to, never the rest of the chat.
2. Put the token in `.env.local` as `TELEGRAM_BOT_TOKEN`, then `npm run telegram -- whoami` and `npm run telegram -- setup`.
3. Add the bot to the family group. Run `npm run telegram -- discover`, send `/help` in the group, and copy the chat and user ids it prints into `RELAY_TELEGRAM_BINDINGS` (format in `.env.example`).
4. `npm run telegram -- poll`. No public URL needed. (For a deployed app use `npm run telegram -- webhook https://your-host` with `TELEGRAM_WEBHOOK_SECRET` set.)

To ask: post your question (with a photo if you like), then reply to it with `/ask kheer and halwa` - the words after `/ask` say what the photo shows.

`RELAY_CALL=none` (default) is intake only: the ask is validated and recorded, and no call is placed, because there is no telephony yet. `RELAY_CALL=prerecorded` runs the session against the prerecorded golden call and posts her voice card back under the question - real Telegram on both ends of a recorded call. It only completes for the Diwali ask that call was recorded for, and only inside the policy's call window (10:00-19:00 New York); outside it the family correctly gets "Not this time."

## What is not built yet

- **The interface.** `/` and `/present` are plain scaffolds. Design goes through the Impeccable skill: run `/impeccable init` first (see `AGENTS.md` section 16).
- **Real media.** Everything in `/assets` is a generated stand-in (a tick once a second; an SVG that says "Placeholder"). Word timings in the transcripts are placeholders too. See below.
- **Photo analysis.** The discovery loop is built from the analyzer's output onward. The analyzer itself (face grouping, EXIF, scene themes) is an interface, `PhotoAnalyzer`, with no implementation: it is a model concern with its own consent questions. A model that reads richer facts out of an answer plugs in as an `AnswerInterpreter`; today a small lexical one handles "my daughter Maya" and place names.
- **Live parts.** `ThreadBridge` now has a real Telegram transport. Three seams still have only their deterministic implementation: `CallDriver` (telephony - the big one), `TranscriptionProvider` (Deepgram / Muse Voice Transcribe), and `AskInterpreter` plus the `select_scaffold` decision (Muse Spark). The judged path must never depend on the live ones.
- **The counterfactual replay.** Nothing exists for it yet, by design: the no-tools bot's lines are not written in `AGENTS.md` and should be locked by the team, not invented by an agent. It is a labeled, prerecorded clip, so it needs a recording and a transcript but no engine work.

## Replacing the placeholder media

1. Record, then drop the real file into `/assets` (keep the id; the extension may change).
2. In `assets/manifest.json`, update that entry's `path` and set `"status": "final"`. Set `duration_ms` by hand if it is not a PCM WAV.
3. `npm run assets:hash`
4. Re-derive word timings from the real recording and replace `fixtures/transcripts/call-golden.json`, setting `"timing_status": "measured"`. The three pauses in Mom's answer must still exceed 700 ms for the receipt to read "3 pauses trimmed".
5. `npm run verify:strict`

`/assets` is append-only after hashing. Relay's spoken lines in the recording must match `render_prompt` output word for word: if they drift, the run stops with a `ScriptMismatchError` rather than letting the audio say one thing while the trace shows another.
