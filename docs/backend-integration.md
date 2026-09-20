# Connected Recall surfaces

The patient, caregiver and onboarding entry points now use the live backend. They do not import sample people, conversations, photographs or outcome histories. `/present` remains an explicitly labeled offline engine check, separate from the live service.

## Start locally

Run `npm run dev`, then open `/onboarding`. With no credentials configured, **Open local setup** is available only on a loopback development URL. It issues an eight-hour HttpOnly session. It is never available in production. Header-based API access requires a configured operator key.

Create the participant and caregiver, review calling preferences and family access, and confirm both people's agreement. Only the participant's phone number is collected. Save creates an append-only setup version and selects that household for this server. The completion page links to the caregiver's actual member ID. Reloading the browser or restarting the server preserves the household and its contributions.

Calls remain paused. The deployed service has no live call transport or external safety-delivery adapter; real households cannot use prerecorded calls. The patient screen displays an unavailable-call state from `/api/call/status`, with no scripted turns or pretend confirmation buttons.

## Deployment and access

- Set `RECALL_OPERATOR_SECRET` to a strong random secret for the operator who records setup.
- Set `RECALL_FAMILY_CREDENTIALS` to a JSON object mapping each approved member's real ID to a distinct random secret. Members enter their own access key; the server derives identity from it. There is no client-side operator secret or embedded credential.
- Remove the old `RECALL_FAMILY_SECRET`. Its presence, duplicate member keys, malformed mappings, or a key shared with the operator disables access.
- Use HTTPS. Browser cookies are HttpOnly, SameSite=Strict and Secure over HTTPS. Mutating cookie requests must have the same Origin. Cookies expire after eight hours; rotating a credential invalidates its sessions immediately.
- Deploy one household per server configuration. Set `RECALL_HOUSEHOLD` to pin it; otherwise the operator's selected household is persisted. No household means setup is required, never a fixture fallback.
- Mount a private persistent directory using `RECALL_DATA_DIR` (default `.data`). It contains `onboarding.db`, `recall-graph.db`, and `active-household.json`. `RECALL_ONBOARDING_DB` can override the onboarding file. Protect and back up this volume; ephemeral/serverless storage is not appropriate.

The graph uses Node's built-in SQLite with WAL and household-scoped keys. Family operations are transactional, and call commits/outcome writes use a transaction when the graph supports one. Updated identities are added from onboarding before a dashboard load; existing claims are never overwritten. Policy is re-read on every family load. Only permission-filtered names, counts, exact share-confirmed lines, and a contributor's own submitted text enter the family response.

## Working flows

- Operator sign-in, joint setup, reloading existing setup, and immediate revocation of the caregiver's dashboard access.
- Member-bound browser sign-in and sign-out, with no credentials in local storage.
- Family dashboard, Weekly Notes, per-topic records, session navigator and empty states sourced from the backend.
- Attributed text contributions, durable across restart, with the contributor's own saved list. Question-shaped contributions use the existing redirect/hint contract.
- Member-initiated text export through the existing record-access and audit gates.

## Remaining work

This is a connected foundation, not a claim of deployment readiness. Live phone/web audio, recording/playback, transcription integration, durable external safety delivery, and automatic scheduling still need implementation. Saving setup cannot enable calls before those exist.

Topic creation and joint topic approval still need an operator flow. A text contribution is saved as its contributor's account; it does not invent an approved recall topic or schedule a call. Photo/voice uploads and invitation/account provisioning UI also remain unbuilt. Bulk contact/calendar ingestion and face grouping were removed from the live form rather than collecting data outside the current backend rules. The former local question-suggestion prototype is not a live request queue.

The backend invariants remain in AGENTS.md. No reducer, tool schema, policy fixture, call script, safety list, or record threshold was changed by this integration.

## Verification

- `npm run check`: types, unit/integration tests, language and provenance checks.
- `npm run build`: production build.
- `node scripts/verify-live-http.mjs`: after building, starts an isolated production server and temporary databases; checks rendered routes, setup consent, contribution persistence across process restart, session binding, cross-origin write refusal, family/operator isolation, export and revocation. It deletes only its own temporary directory.

Automated visual browser inspection was unavailable in the implementation session. HTTP route checks do not substitute for a desktop/mobile interaction and accessibility pass. Existing placeholder media warnings apply to the isolated offline demo.
