<p align="center">
  <img src="public/brand/recall-mark.svg" alt="Recall logo" width="80" height="80">
</p>
<h1 align="center">Recall</h1>
<p align="center"><strong>Cues, not answers — every memory stays in their own words.</strong></p>
<p align="center">Memory participation and family connection for people living with dementia.</p>

Recall is built for people living with dementia and the families and caregivers who support them. It brings family photos and stories together in a private memory graph, helping people revisit their own memories through gentle voice conversations.

Families contribute photographs and stories to create familiar starting points for conversations with a loved one living with dementia. The person can revisit an approved topic in a browser voice call, with familiar context offered as needed. Their words enter the private call graph only after original-audio playback and confirmation; sharing with family requires a separate confirmation. Recall creates reasons for people to talk to each other, without speaking on anyone's behalf.

Built for HackMIT 2026, Healthcare track. [SPECS.md](SPECS.md) and [EVIDENCE.md](EVIDENCE.md) explain the design and its limits.

## Built for people living with dementia

- **Shared collection:** upload photographs, retain originals and available capture dates/GPS, organize them into moments, and add attributed written or recorded stories. OpenAI organization is optional; metadata grouping works without a key.
- **One workspace for dementia caregivers:** Moments, People, Places, Connections, Stories, and Recall sessions share the Circle sidebar. The sidebar resizes, collapses, supports keyboard controls, and remembers its width.
- **People:** opt-in face detection runs in the browser with self-hosted models. Families can name, merge, separate, or dismiss suggested groups. Photo groups never establish an identity or relationship in the patient-call graph.
- **Places and connections:** a map of photo locations and an interactive graph with selectable people, moments, stories, and relationship/source details on connecting lines.
- **Family search and Q&A:** ask about people, places, events and relationships in Connections, even before any story is recorded. Muse Spark answers from accessible base graph records, photo-group links and shared stories, with attributed sources. Without a Muse key, source search remains available.
- **Collection management:** caregivers can delete individual photos, whole photo groups, or stories. Confirmation explains related removals; orphaned collection media is cleaned up. Deleting a shared call story does not erase its original private call record.
- **Accounts and invitations:** caregiver email/password sign-in, existing access keys, expiring family/story links, and optional Linq invitation texts and opted-in photo reminders.
- **Voice conversations for people living with dementia:** browser microphone input, Recall's spoken questions, live captions, speech endpoint detection, topic photos, original-audio confirmation playback, and saved call records. The implemented transport is the web app; ordinary telephone delivery is not connected.
- **Family call records:** an opt-in Weekly Note, dated per-topic call history, counts with denominators, and an access-checked printable record. These describe what happened in Recall calls, without a score or medical interpretation.

## Tech stack

Versions below describe the repository's current dependency families; [package.json](package.json) and [package-lock.json](package-lock.json) contain the exact requirements and resolved versions.

| Layer | Technology and role |
| --- | --- |
| `npm run check` | `typecheck` + `test` + `lint:language` + `verify`. Must pass before a task is called done. |
| `npm run lint:language` | The banned-phrase and conduct lint (`AGENTS.md` §12, test 8) over every fixed line and every line Recall rendered on the golden path. |
| `npm run verify` | Asset hashes, seed validation, citation resolution, the judged path end to end, authorship invariants. |
| `npm run verify:strict` | The pre-demo gate. Same, but **fails while any placeholder media or placeholder word timing remains.** |
| `npm run assets:hash` | Re-hash `/assets` into the manifest. Refuses to touch a changed `final` asset without `--allow-replace`. |
| `npm run assets:placeholder` | Generate stand-in media. Never overwrites an existing file. |
| `npm run graph:seed` | Build an on-disk LadybugDB graph at `.data/recall.lbug` from the family seed, for Cypher poking. |
| `npm run prizes:check` | Check that the seven-target judge brief is complete. |
| `npm run prizes:brief` | Print the concise round-one and round-two talk track for the team sync. |
| `npm run prizes:prompt` | Print the bounded prompt for drafting sponsor justifications from the shared brief. |

## Prize alignment

The internal [prize alignment brief](docs/PRIZE_ALIGNMENT.md) keeps every demo explanation pointed at the same human moment and technical proof. It covers seven targets: Long Lake, OpenAI, Meta, Dropbox, Deepgram, Ramp, and Cognition/Devin. The winning story is consistent across rounds: Recall helps a person reach her own memories in her own words, then gives family a reason to call her directly.

Before a team sync, run `npm run prizes:check` and `npm run prizes:brief`. Use `npm run prizes:prompt` when preparing a short, judge-facing justification from the shared demo records.

## Frontend boilerplate

The frontend is ready for backend integration: `/` is the patient call, `/caregiver` is the caregiver session waveform and conversation-suggestion form, `/onboarding` is phone-first setup, and `/revisit` is the next-conversation invitation. `/family` aliases `/caregiver`.

These screens use isolated sample state and local files. They do not yet load authorized household data, schedule calls or persist suggestions. The waveform displays labeled per-topic call counts, not recorded audio or a memory score. The UI permits separately labeled question suggestions; the live backend still has its redirect-only question contract. See [the frontend handoff](docs/frontend-preview.md#backend-handoff) for entry points and integration boundaries.

## How it fits together
| Frontend | Next.js 16 App Router, React 19, TypeScript 7 |
| Styling and motion | Custom CSS, Tailwind CSS 4, Framer Motion 13, Lucide icons, locally hosted Atkinson Hyperlegible Next |
| State and validation | Zustand 5, a deterministic call reducer, Zod 4 |
| Server | Next.js route handlers on Node.js 22.13+; one long-lived process |
| Durable storage | SQLite through built-in `node:sqlite` for onboarding, accounts, collection state, graph evidence, and call records; private filesystem media |
| Graph retrieval | Embedded LadybugDB (`@ladybugdb/core`) over committed graph snapshots, or the same guarded traversal directly in SQLite |
| Voice | Deepgram Nova-3 transcription and streaming captions; Aura-2 Thalia for Recall's own voice |
| Conversation and graph proposals | Optional Meta Muse Spark; typed outputs checked by the policy, evidence, and confirmation gates |
| Photo organization and recording transcription | Optional OpenAI integration; configured defaults are `gpt-5.4-mini` and `gpt-4o-mini-transcribe` |
| Photo processing | Sharp, Exifr for capture metadata, and HEIC conversion |
| Face grouping | Pinned `@vladmandic/face-api@1.7.15`, with vendored detection, landmark, and descriptor models |
| Maps | MapLibre GL |
| Optional messaging | Linq for shared-collection invitations and opted-in reminders |
| Checks | Vitest 5, TypeScript, language/conduct lint, and asset/provenance verification |
| Deployment | Railway Node service with a persistent volume |

The face library is pinned and archived upstream; see [People and model limitations](docs/PEOPLE.md). Provider keys remain on the server.

## Run locally

Use **Node.js 22.13 or newer**.
main

```bash
npm ci
cp -n .env.example .env.local
npm run dev
```

Open [localhost:3000](http://localhost:3000). For another port, use `npm run dev -- --port 3001`. Keep an existing `.env.local` rather than replacing it.

The sample collection needs no provider keys. Live voice calls require Deepgram. The app creates local SQLite files and private media under the git-ignored `.data/` directory; no separate database service is needed. Dependencies must be installed first.

| Route | Purpose |
| --- | --- |
| `/` | Landing page, sign-in/setup entry points, and local demo links |
| `/sign-in`, `/onboarding` | Account access and joint family setup |
| `/caregiver`, `/family` | Shared collection and caregiver workspace |
| `/conversations` | Recall sessions inside the same Circle workspace |
| `/revisit` | Patient photo storytelling and entry to their Recall call |
| `/conversations/call` | Scheduled patient browser call |
| `/demo/call` | Local sample patient's call, paired with the caregiver demo |
| `/onboarding/manage` | Joint preferences, approved topics, member access, and selected imports |

## Sample family walkthrough

The two sample entry points are currently **development-only and localhost-only**. Production builds do not expose them.

1. Click **Explore a sample family** on the landing page. Each click starts a fresh sample household with **Home Garden Morning** and **Quiet Library Rooms** only. The four person-focused moments, People groups, and stories are absent. Connections already includes explicitly fictional family ties.
2. Upload the 12 original JPEGs from the **Relay Family Photo Kit**, also included in [public/sample-family](public/sample-family). Exact file hashes select the authored sample grouping; altered or unrelated files use the regular organization pipeline.
3. The forming-groups animation plays for **three seconds**, then the collection shows **Our Cape May summer**, **A birthday around the table**, **The kitchen before Diwali**, and **A long weekend in Acadia**. Places and Connections use the uploaded moments.
4. In this sample only, People shows at most **Grandmother, Mother, Daughter 1, and Daughter 2**, using authored crops from uploaded kit photos. These are demonstration fixtures, not inferred identities. Real households use opt-in face grouping.
5. Click **Try the patient call demo** to open the paired patient tab. It joins the same sample household through a separate signed session. Start the demo call, answer, and allow microphone access.
6. The sample call shows the event's photos with its opening question, displays live captions, and handles replies through the existing conversation gates. After audio playback, confirm storage and then sharing. Only share-confirmed words appear as a story on the associated moment and in the caregiver's Connections view.

Returning between the two tabs preserves their shared sample. Clicking **Explore a sample family** again starts another fresh sample; it is not a resume button. The fictional setup does not change the deployment's active household or send external calls or safety alerts.

## Calls, memory, and authorship

The private patient-call graph and the household's shared photo collection are separate. A collection upload does not automatically become approved evidence for a real patient's call.

The call engine chooses an approved topic from the graph and uses the least support needed: free recall, context, association, recognition, and permitted reorientation. Family contributions remain attributed to their authors and are never silently treated as the patient's account. Optional Muse proposals can help interpret a reply or select supported context, but cannot bypass the gates.

Real-household calls keep the opening unaided question photo-free. Verified topic photographs can appear with an association cue or after the patient reaches the memory. The sample demo's opening-photo behavior is an explicit exception, and the engine records the photo support. Topic and contributor permissions are rechecked when serving private call photos.

Only completed recorded turns drive the call engine. Streaming captions are temporary previews. Recall plays back the patient's actual recorded words before asking:

1. “Want me to remember that?”
2. “Would you like me to share it with your family?”

Commit happens after both questions resolve. A stop before commit stores no contribution; a declined or unclear share answer can still permit private storage after a confirmed store answer. The patient's voice is never synthesized.

Families can search and ask questions about their shared collection and accessible graph sources. A recorded story is not required: named people and places, event dates, approved setup relationships, confirmed graph contributions, and photo-group links can answer a question themselves. Muse Spark supplies cited answers and ideas for conversations together; private, unshared patient accounts and unconfirmed graph proposals stay outside this search. A link to a photo group does not establish who attended an event. Questions and generated answers are not saved as memories. Call records contain per-topic counts, dates, and fixed explanatory copy. The printed record states that it is **not a clinical assessment or diagnosis**.

The safety path uses fixed phrase matches and missed-call counts, with designated-caregiver acknowledgment and one backup escalation. Delivery uses the configured dashboard or durable webhook channel. Recall is not an emergency service.

## Configuration

Copy only the settings you need from [.env.example](.env.example); never commit keys or private data.

| Variable | Use |
| --- | --- |
| `DEEPGRAM_API_KEY` | Required for live patient speech transcription and Recall's voice |
| `MUSE_API_KEY` | Family graph Q&A and conversation ideas; optional call support and graph extraction proposals |
| `OPENAI_API_KEY` | Optional photo organization and collection recording transcription |
| `OPENAI_VISION_MODEL`, `OPENAI_TRANSCRIPTION_MODEL` | Override the photo/recording model defaults |
| `LINQ_API_KEY` | Optional collection invitation texts and opted-in reminders |
| `RECALL_PUBLIC_URL` | Public HTTPS origin for shared links |
| `RECALL_DATA_DIR` | Private persistent storage root; defaults to `.data/` |
| `RECALL_GRAPH_READS` | `ladybug` by default; `sqlite` uses direct durable-store traversal |
| `RECALL_CALL` | Set to `web` for browser calls |
| `RECALL_SCHEDULER` | Set to `1` to check agreed call windows and process pending graph work |
| `RECALL_REMINDER_TIMEZONE` | Shared-collection reminder timezone |
| `RECALL_SAFETY_WEBHOOKS` | Optional JSON map of designated-caregiver handoff endpoints |
| `RECALL_OPERATOR_SECRET`, `RECALL_FAMILY_CREDENTIALS` | Optional operator/member access-key configuration |

For a fresh installation using **Start your family**, leave the operator secret, policy file, and household override unset, with `RECALL_FAMILY_CREDENTIALS={}`. The first household can create its caregiver account through onboarding; subsequent access uses the saved account. An operator-managed installation uses its separate operator credential instead. Remove the obsolete `RECALL_FAMILY_SECRET` if configured.

The optional `RECALL_ONBOARDING_DB` and `RECALL_CIRCLE_DB` variables override individual database paths. Leave them unset to keep those files under `RECALL_DATA_DIR`. `RECALL_HOUSEHOLD` pins the active live household; legacy `RECALL_POLICY_FILE` fixture configuration cannot be combined with it.

Real calls require joint setup, approved topics and windows, an introduction to Recall, and a patient session. Initial setup leaves calls paused; enabling them requires joint review. Family credentials cannot answer a patient call or trigger an immediate one.

## Deploy on Railway

Use one service for the frontend and backend, with a persistent volume for SQLite and media.

1. Connect this repository's `main` branch using Railpack.
2. Attach a [Railway volume](https://docs.railway.com/volumes) to the service at `/data`.
3. Set the build command to `npm run build` and start command to `npm run start -- --hostname 0.0.0.0`.
4. Add the following variables, plus any provider keys needed:

   ```dotenv
   NODE_ENV=production
   RAILPACK_NODE_VERSION=22
   PORT=3000
   RECALL_DATA_DIR=/data/recall
   RECALL_GRAPH_READS=sqlite
   RECALL_CALL=web
   RECALL_SCHEDULER=1
   RECALL_FAMILY_CREDENTIALS={}
   RECALL_SAFETY_WEBHOOKS={}
   RECALL_REMINDER_TIMEZONE=America/New_York
   ```

5. Generate a service domain using port **3000**, then set `RECALL_PUBLIC_URL` to that HTTPS origin.
6. Keep **one replica** and **Serverless/sleeping off**. Current calls and their command acknowledgments live in one process.
7. Use `/api/session` as the healthcheck path, deploy, and complete family setup. Upload a photo and restart the service to check persistence. Enable volume backups.

SQLite schemas are created by the app at runtime; no separate PostgreSQL service or migration command is required. Back up the whole private data directory. Local accounts and uploaded files do not transfer automatically, and an active call does not survive a process restart.

**Hosted sample demos still require a code change:** the current sample routes check for development mode and localhost. Railway environment variables alone do not enable them. Keep `NODE_ENV=production`.

## Checks and repository map


| Command | Purpose |
| --- | --- |
| `npm run check` | Typecheck, tests, language/conduct lint, and provenance verification |
| `npm test` | Vitest engine, storage, permissions, collection, and integration checks |
| `npm run graph:seed` | Build a local LadybugDB seed at `.data/recall.lbug` |

| Path | Responsibility |
| --- | --- |
| `app/`, `components/circle/` | Routes and shared caregiver workspace |
| `components/live/`, `client/` | Patient calls, microphone capture, onboarding, and browser helpers |
| `server/circle/` | Shared collection, photos, stories, People, invitations, and sample fixtures |
| `server/` | Sessions, accounts, scheduling, live calls, private media, and durable graph |
| `lib/state/`, `lib/tools/`, `lib/orchestrator/` | Deterministic call transitions and enforced tool contracts |
| `lib/graph/`, `lib/knowledge/`, `lib/provenance/` | Evidence, graph updates, hashes, receipts, and retrieval |
| `lib/onboarding/`, `lib/family/` | Joint setup, permissions, count-only records, and exports |
| `fixtures/`, `assets/`, `tests/` | Fixed copy, thresholds, source media, and verification |

Further implementation notes: [backend integration](docs/backend-integration.md), [knowledge graph](docs/knowledge-graph.md), [People](docs/PEOPLE.md), and [shared-collection scope](docs/PHOTO_FIRST_SCOPE.md).
