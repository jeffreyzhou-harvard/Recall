# The live knowledge graph

Recall uses the graph to choose an approved topic, retrieve cited context, select a useful cue, identify missing context, and organize new contributions. The live pipeline is separate from the fixture-only `/present` demo.

## Storage and retrieval

The durable household graph is in `recall-graph.db`. SQLite commits evidence, graph changes and audio confirmation receipts in the same transaction. LadybugDB is the default live retrieval engine: a private, in-process index is loaded from one committed snapshot and reused until that snapshot changes. Reads use the same policy-bounded graph traversal and evidence gates as the fixture engine. An index build failure fails the read; stale results are never substituted. Set `RECALL_GRAPH_READS=sqlite` to run that same traversal directly over SQLite.

This split avoids a distributed commit between Ladybug and audio storage. Back up the private data directory; the Ladybug index can be rebuilt. The server still requires the existing single-process deployment. Snapshot rebuilding is currently proportional to the household graph's size; this implementation has not been benchmarked as a multi-household graph service.

## How contributions become usable context

1. Onboarding imports or an approved contributor save an attributed account. A call saves the patient's literal contribution only after the existing playback, store-confirmation and share-question sequence completes. Stopped or unconfirmed turns never enter enrichment.
2. Exact, unambiguous names link the account to known people, places and events. A later human naming can also link earlier literal mentions. These links mean *mentioned*, not *attended*, *lived at*, or *was related to*.
3. When configured, Muse Spark proposes additional entities and relations with exact character spans and source IDs. The server checks the schema, literal spans, closed relation vocabulary, endpoint types, author and current policy. New entity types and semantic relations remain `inferred`; they cannot be spoken as facts.
4. Contributors can review interpretations of their own accounts. Reviewed entities and connections are appended with a new review artifact, preserving the original account and the model proposal. Their standing is `family_confirmed`, never patient-confirmed. The review projection cannot return patient-derived proposals or another contributor's original words.
5. The original stored claims form a durable work queue. Successful updates have versioned receipts; retries cannot duplicate them. Provider failures leave work pending, with backoff so later contributions can run. Exact-name linking continues independently of the provider. Queue status is visible in the operator's onboarding controls.

The updater runs after saved calls and family contributions, and before each scheduler call check. Keeping `RECALL_SCHEDULER=1` also processes import backlogs while calls are paused. Missing `MUSE_API_KEY` selects the explicitly named literal matcher. A configured but unavailable Muse provider leaves its proposals pending; it does not silently substitute model-generated content or mark the work complete.

The existing typed graph interfaces and guarded update pipeline are used rather than adding Graphiti. Graphiti's [Ladybug driver proposal](https://github.com/getzep/graphiti/issues/1509) was still open when checked. No embedding service, automatic narrative rewriting, or additional sponsor API is introduced.

## Questions and cues

Topic ranking still starts with the longest-unvisited approved topic, then the existing deterministic tie-breakers. The graph question planner examines source-backed accounts for that topic:

- No confirmed account from the patient: invite their own telling with the existing open follow-up.
- Missing people, place or time context: choose the corresponding fixed, open follow-up.
- Context already present: use the topic's usual invitation to elaborate.

Every call still opens with free recall. Follow-up selection does not add a quiz or change the ladder, stop handling, safety handoff or confirmation sequence. Later calls can offer a cited person or place cue such as “You mentioned Maya. What comes to mind?” The retrieval layer records which cue was used and selects among those on offer. A mere mention is excluded from recognition choices that would otherwise assert participation or a relationship.

The question plan is private call-planning data, not a family analytics surface. Family queries still return only the fixed redirect. No model can freely choose a topic, widen approval, store unconfirmed words, or overwrite a person's account.

## Selective onboarding imports

Open `/onboarding/manage` after joint setup. Choose one file at a time, review the entries, select up to 20, and save them as the named contributor:

- JPEG/PNG: upload a chosen photo and supply a short topic and caption. Existing media validation removes optional metadata; identity is supplied by a person, never face recognition.
- vCard/CSV: parse locally and match selected contacts to already approved household members. Phone numbers and other raw export fields are never submitted by this flow.
- ICS: parse locally and select named calendar entries and dates. An entry is evidence of that entry, not proof the patient attended it.
- TXT: contribute a short history in its original wording, up to 2,000 characters.

An optional place must appear literally in the contributed account. New topics remain unavailable for calls until joint approval. The import endpoint rejects unknown fields, unapproved contacts, foreign attachments, altered reuse of an import ID, and unreviewed submissions. The batch and retained attachments commit atomically. There is no background contact/calendar sync, bulk photo analysis, browser-history ingestion, location extraction or health-record importer.

## Verification and review

`npm run check` covers the offline golden path plus graph provenance, idempotency, rollback, rejected extraction, contributor review isolation, backoff, native-read parity and the browser-audio confirmation-to-graph flow. `npm run build` followed by `node scripts/verify-live-http.mjs` checks the authenticated import route with isolated data.

`node --env-file=.env.local --import tsx scripts/verify-graph-provider.ts` explicitly checks the live Muse connection using fictional fixture text only. It opens no household and saves no graph data.

The added fixed follow-up/cue lines and the `place` cue kind require a second person's review under AGENTS.md §13 before merge. The reducer, safety phrases, policy fixtures and record thresholds are unchanged. Interactive browser verification remains outstanding because the Superset browser CLI was not authenticated during implementation.
