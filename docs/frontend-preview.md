# Recall frontend integration

This path is retained for existing links. The application now mounts connected household and call flows; the former local scripted preview is retired.

| Route | Current behavior |
| --- | --- |
| `/` | Guest welcome, or role-based continuation for an existing session |
| `/get-started` | Choose joint setup or a family invitation |
| `/sign-in` | Sign in using an existing private access key |
| `/onboarding` | Real joint setup, gated by setup authority |
| `/onboarding/manage` | Household members, invitations, topic approval, call preferences and access |
| `/join` | Accept a one-time invitation; receive a private key |
| `/caregiver`, `/family` | Authorized persisted family dashboard and contributions |
| `/revisit` | Patient-only scheduled browser call |
| `/design/*` | Redirect to `/` |
| `/present` | Isolated fixture engine harness |

`LiveProvider` supplies session and reading preferences. `AccessGate` signs in through `/api/session`; patients continue to `/revisit`, family to `/caregiver`, operators to `/onboarding`. There is no email/password account creation. New household setup needs an operator key, with local development setup available only when the server explicitly permits it. Invitation acceptance alone does not grant dashboard or contribution permissions.

The shared header uses the clay connected-path mark everywhere. Welcome, access, setup and invitations share Atkinson typography and quiet fields. The live patient view shows current prompts, listening/playback status, Answer call and End call. Spoken confirmation runs through the backend; the former photo-led, paginated-caption component and client Yes/No preview are not mounted.

`CircleApp` now supplies the shared workspace at `/conversations` as well as `/caregiver` and `/family`. Recall sessions and Stories are direct sidebar destinations, alongside the existing collection views. `RecallSessions` consumes the persisted dashboard projection and supplies `SessionHistory` with actual record thresholds. The bookshelf, topic filters, date timeline, plain counts and reduced-motion behavior remain. The fixed header is visible above the record; change lines remain plain sentences from the existing tools. Weekly Note filters out patient `share` lines, and note-only access hides every record and export control. Export still runs the authorized, logged `/api/family/export` tool path. The separate `FamilyDashboard` / `care-portal` shell has been retired.

The former PreviewProvider, RecallPhone, sample launcher, selected-source library and local suggestion components were removed. Rich album/contact/calendar intake has no live UI until supported by the backend. Remaining preview fixtures/test helpers are development material, not default household data.

See [backend integration](backend-integration.md) for configuration, persistence, security, audio and deployment limits. Verified after merging main: `npm run check` passed all 455 tests, typechecking, language lint and provenance checks; `npm run build -- --webpack` passed. `scripts/verify-live-http.mjs` passed against an isolated database, covering sessions, persistence, invitations, media ownership, consent, revocation and member isolation. Browser checks covered welcome/sign-in, invalid-key recovery, 390px and 320px layouts, large text/dark mode, joint setup saved to a temporary database, and a contribution draft retained after refresh. A complete real microphone/speaker call remains unverified. Existing placeholder demo media and timings still prevent strict demo readiness.
