# Live Recall web app

The patient call runs inside the web app. No Twilio or telephone delivery is used. `/` and `/revisit` accept a patient-specific access key and show a scheduled incoming call. Answering requests microphone permission; Recall then speaks its gated questions, listens for a completed recording, and transcribes it through Deepgram. The existing reducer and tool gates choose the questions and decide whether anything may be stored.

## Set up and run

1. Use Node 22.13 or newer, HTTPS (localhost is also a secure microphone context), and one long-lived Node server. Mount a private persistent `RECALL_DATA_DIR`. This implementation is not a serverless or multi-instance call router: the current call and command acknowledgments belong to one process.
2. Configure `RECALL_OPERATOR_SECRET` and `DEEPGRAM_API_KEY`. Use `RECALL_CALL=web` and `RECALL_SCHEDULER=1` to enable the web transport and the 30-second schedule check. In local development with no operator credentials, **Open local setup** is available on loopback only.
3. Complete `/onboarding` together. Give the web call a familiar name and explicitly confirm that Recall has been introduced as an AI assistant. Web calls do not require a saved telephone contact or photo; existing phone policies retain those requirements. Saving initial preferences leaves calls paused.
4. Open `/onboarding/manage`. Add a contributed topic, approve its use together, and choose member access. Enable web calls in the joint review. Schedule windows, topic blocks, minimum interval, weekly frequency, and maximum duration remain enforced. There is no family trigger for an immediate call.
5. Issue the participant's call access key. Sign in with it on `/` in a separate browser profile/device from the caregiver account, and leave that page open during the agreed window. Family and operator credentials cannot answer a patient call. An operator can also run one schedule check through `POST /api/live/schedule`; it still honors every policy gate.

Calls use a completed-turn audio path: the browser waits through silence, sends a PCM WAV, and the server obtains literal word timings. The UI does not display a patient transcript wall. This is not a streaming partial-transcript display. A family voice note can also be recorded or uploaded as a mono PCM16 WAV, up to 90 seconds. Failed recognition follows the engine's timeout close; browser disconnection stops the call.

## Connected family and setup flows

- Invitations are one-time codes handed over by the inviter, never sent by Recall. `/join` accepts them and returns a private access key once. Joining alone grants no contribution or dashboard permissions.
- Joint approval grants contribution and dashboard access. Keys can be replaced or revoked. Only their hashes are stored; rotation invalidates browser sessions. Existing `RECALL_FAMILY_CREDENTIALS` environment-managed keys still work, but must be rotated in the environment.
- Topic creation stores the contributor's account, with `patient_confirmed: false`. Generic topics have no invented contextual facts: they use the reviewed free-recall and attributed-family prompts. Topic approval never starts a call. Families can attach further memories to an approved topic.
- Text, JPEG/PNG photos, and voice notes are private, member-bound contributions. Photos lose optional metadata before hashing. Voice notes are transcribed literally and remain attributed to their contributor. Unsupported files and oversized uploads are refused.
- The dashboard, Weekly Note, per-topic record, exports, and own-contribution list read persisted data. Only share-confirmed patient words can reach the family view. Caregivers can pause calls from their dashboard; resuming requires joint setup.

## Audio and safety

Recall's synthesized voice uses [Deepgram's documented speech endpoint](https://developers.deepgram.com/reference/text-to-speech/speak-request), only with script/evidence-gated Recall prompts. Her words use [Deepgram transcription](https://developers.deepgram.com/docs/pre-recorded-audio); her voice is never synthesized. Provider requests opt out of model improvement. A timeout aborts the provider request rather than abandoning a graph mutation.

Each call command has an unpredictable identifier. The server accepts audio only for its current listening step. Playback must be acknowledged before a confirmation question advances. A confirmation cannot be submitted as browser-supplied text or a boolean. Her exact kept audio spans are played back before the store question; the separate share question follows. The common playback establishes the exact line for both questions, as on the judged path.

Unconfirmed turn audio is deleted on normal call termination. Confirmed contribution audio and its confirmation receipts are retained privately. Temporary family uploads expire after an hour. Startup reconciliation preserves committed audio, then deletes any remaining unconfirmed patient audio left by an interrupted process. Live media, confirmation receipts, and graph claims share the same SQLite connection and commit transaction. A stopped or failed commit rolls all of them back. Ring timestamps survive restarts so a process failure cannot cause a repeat call inside the agreed interval.

Safety matches run before other handling of a final recording, including a hang-up submitted with it. A durable dashboard handoff is the default. For an external caregiver handoff, configure `RECALL_SAFETY_WEBHOOKS` as a JSON map from designated caregiver IDs to `{ "url": "https://…", "token": "at-least-32-random-characters" }`, then select the webhook channel jointly. The receiver must honor `Idempotency-Key`; retries after uncertain network delivery cannot otherwise guarantee exactly-once arrival. The outbox contains only the fixed alert, category, time, and designated recipient. Pending deliveries are retried by the scheduler and remain visible to that caregiver. Recall is not an emergency service.

## Persistence and access

`RECALL_DATA_DIR` holds onboarding, graph, media, accounts, ring attempts, safety outbox, scheduler lease, and selected household. Protect and back up the whole directory. Do not put it in a public/static directory. One household is selected per deployment; `RECALL_HOUSEHOLD` can pin it.

Use HTTPS in deployment. Sessions use HttpOnly, SameSite=Strict cookies, Secure on HTTPS, expire after eight hours, and revalidate credentials on each request. Cookie-authenticated mutations require the same Origin. Remove the legacy `RECALL_FAMILY_SECRET`; it intentionally disables access. No user key is embedded in the bundle or stored in browser local storage.

## Verification and limits

- `npm run check`: types, engine/integration tests, language lint, provenance verification.
- `npm run build`, then `node scripts/verify-live-http.mjs`: isolated production HTTP checks for setup, restart persistence, invitations, joint topic approval, patient/family isolation, CSRF, exports, and revocation.
- `node --env-file=.env.local --import tsx scripts/verify-voice-provider.ts`: explicit live-provider check using only a fixed Recall procedural line; no household data is used or stored.

The implementation session verified the real Deepgram speech-to-audio-to-transcription connection. Automated browser access was unavailable, so real microphone permissions, speaker playback, device-specific audio behavior, mobile layout, and a complete spoken browser call still require manual verification. No claim of zero defects or deployment readiness is made. The isolated `/present` demo retains its explicitly labeled placeholder assets and timing warnings; it never writes the live household.

The web-transport policy adaptation follows the user's September 19 instruction to present the conversation as a call inside the web app. No reducer, tool JSON contract, policy fixture, call script, safety list, or record threshold was edited. Before deployment with real participants, the external reviews in AGENTS.md Appendix B.7 still apply.
