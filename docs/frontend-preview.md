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

`FamilyDashboard` supplies persisted metadata to `SessionBookshelf` through `lib/family/session-summary`, including the actual record window and minimum call count. The shelf, topic filters, date timeline, plain counts and reduced-motion behavior remain. Weekly Note filters out patient `share` lines. MemoryForm saves attributed contributions and uploads private JPEG/PNG photos or WAV voice notes; it rejects question requests and never schedules a call.

The former PreviewProvider, RecallPhone, sample launcher, selected-source library and local suggestion components were removed. Rich album/contact/calendar intake has no live UI until supported by the backend. Remaining preview fixtures/test helpers are development material, not default household data.

See [backend integration](backend-integration.md) for configuration, persistence, security, audio and deployment limits. This documentation describes source behavior and does not claim final validation of the latest frontend edits. A complete real browser microphone/speaker walkthrough remains a separate verification step.
