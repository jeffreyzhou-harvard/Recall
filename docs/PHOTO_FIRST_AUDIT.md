# Photo collection audit — September 20, 2026

Audited the imported collection's frontend/API connections, uploads, photo analysis, recording and story sharing, accounts, invitations, media access, and reminder configuration. Ran the full repository suite, language/provenance checks, and production build.

## Bugs fixed

- Upload retries now retain the complete receipt, including rejected files and AI fallback warnings. Changing the selected photos starts a new request; an unchanged retry keeps its identifier. Entirely rejected batches show an accurate failure message.
- Overlapping uploads cannot leave a moment pointing to a duplicate photo's discarded cover or captions. Receipts count distinct moments, and newly supplied GPS can populate an existing moment's map location.
- Initial analysis runs up to four independent 20-photo batches concurrently rather than queuing four provider timeouts behind one upload request. Reanalysis processes photos beyond the first twenty and rejects stale results when a moment changes during analysis.
- Conflicting signup attempts roll back household creation instead of reserving the participant's phone number after login creation fails. Duplicate household errors return a client error instead of an unexplained server failure.
- Passwords longer than the supported maximum are rejected instead of accepting a matching truncated prefix. National phone input no longer loses leading digits merely because they match the selected country code.
- Recording drafts are discarded on recorder dismissal/replacement, including uploads that finish after dismissal. Unshared drafts older than one hour are removed on subsequent collection/audio/media access; saved stories retain their original audio. This is access-triggered cleanup, not a background expiry service.
- Audio sharing requires an explicit review flag at the API. Unsupported/empty audio is rejected; overlong text and transcripts are not silently truncated. Audio uploads and reanalysis have request limits.

Regression coverage is in `tests/circle-regressions.test.ts` and `tests/phone-format.test.ts`, alongside the existing integration and patient-call tests.

## Current verification

- **552 tests pass across 31 files**, including EXIF dates/GPS and unchanged original bytes, concurrent uploads, full receipt replay, 21-photo reanalysis, signup rollback, password bounds, audio review, draft cleanup, and shared-audio retention.
- TypeScript and the production Next.js build pass. Language lint reports zero findings. Provenance verification passes with the same five existing placeholder-media/timing warnings in the separate call presentation; strict presentation readiness is not claimed.
- Ten entry pages render through the running app. Live HTTP checks pass for signup, joint setup, sign-out/sign-in, multipart upload, real OpenAI titles/captions, deduplicated retries, single-use invitations, shared stories, patient access, account revocation, private media, cross-household denial, and cross-origin write rejection.
- Real OpenAI transcription of an explicitly synthetic recording reproduced its words. The app returned the original audio bytes, saved a reviewed story, and retained its playback after a discard request. No personal recordings or family photographs were used for these checks.
- The OpenAI and Linq keys were recovered from the authorized download into ignored, owner-readable `.env.local`; existing local settings were preserved. OpenAI model access and Linq phone-number access returned HTTP 200. No credentials are recorded here or in tracked source.
- `components/circle/circle.css`, `app/family-archive.css`, and `app/archive-visualizations.css` are byte-identical to Downloads. A parsed comparison of motion/transition/layout attributes across ten frontend components also matches Downloads. Only upload error text and request/recording lifecycle logic changed in the visual components during this audit.

## Verification limits

Browser automation was unavailable, so this audit does not claim a visual browser walkthrough, file-picker click test, or physical microphone test. Frontend request wiring was reviewed in source and the corresponding HTTP paths were exercised against the running app. The downloaded implementation's older browser results are historical, not new evidence.

No real invitation texts or reminders were sent. Their existing mocked tests and read-only Linq authentication check pass, but delivery still needs a current reachable `RECALL_PUBLIC_URL` and a separately authorized real-recipient test. Old tunnel URLs and phone numbers from the download were not copied. The test server used an isolated temporary database with call scheduling and messaging disabled.
