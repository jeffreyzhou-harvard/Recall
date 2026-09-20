# Photo-first Recall

The primary family experience is `/caregiver`. The only required collection action is **Add photos**. Recall preserves the originals, extracts capture dates and GPS when present, groups events with OpenAI, writes short titles and image descriptions, chooses a cover, and suggests a story question. The map and connection graph use the saved collection, not a separate presentation fixture.

## A two-minute walkthrough

1. On a local development server, choose **Explore a sample family**, then **Try it with 9 sample photos**. These are explicitly illustrative photos with fictional camera-roll metadata. They go through the real analysis pipeline.
2. Open an automatically named moment. Browse its photos and add a written story or a recording. A recording is transcribed for review and the original audio remains available beside the approved words.
3. In **Your family**, enter a name and optionally a phone number. The invitation is a private, expiring link. With messaging configured, Send invitation delivers it through Linq. Without a number, copy the link.
4. Open the invitation in a separate browser/device. The relative joins the shared collection directly, and can add photos or stories.
5. In a moment, use **The details you know** to confirm who was there. **Create a story link** invites a particular relative into that photograph and question.
6. Open **Connections** and select the story node. It shows the attributed original words and links back to the source moment. Story authors are connected without asserting that they appear in a photograph.
7. **Create Susan’s link** opens the patient view: a large photograph, one question, and record/write actions. No access key form.

The real onboarding keeps its four steps and all schedule, pacing, introduction and privacy questions. New organizers get email/password sign-in. Invited relatives can use phone links and optionally add email sign-in later. Clinical call records remain available separately under `/conversations`; they are not mixed into the shared photo collection.

## Connected services

- `OPENAI_API_KEY`: Responses vision and audio transcription. Default vision model `gpt-5.4-mini`, overridable by `OPENAI_VISION_MODEL`. Default transcription `gpt-4o-mini-transcribe`, overridable by `OPENAI_TRANSCRIPTION_MODEL`.
- `LINQ_API_KEY`: [Linq’s message endpoint](https://docs.linqapp.com/channel/imessage/api/resources/messages/methods/create/), including idempotency keys. Existing account credentials were checked read-only; no real recipient was texted during validation.
- `RECALL_PUBLIC_URL`: current public HTTPS origin for phone invitations. Configure a reachable tunnel or deployed origin; the old tunnel address in the download was not copied. A temporary tunnel requires the Mac, server and tunnel to stay running.
- `RECALL_REMINDER_TIMEZONE`: defaults to `America/New_York`. Opted-in relatives with confirmed participation receive a story link at a randomized interval of 3–7 days, between 10am and 6pm. Failed delivery pauses that contact. Sample families never send real texts. The long-lived server runs the scheduler; this is not a serverless cron deployment.
- `RECALL_DATA_DIR`: private persistent storage. Default `.data/`; use a persistent volume when deploying. Originals and reviewed audio are not public assets.

People’s names come from explicit family labels or existing photo person metadata, not guessed facial identities. Photos without GPS remain browseable but are not placed at invented coordinates. AI descriptions are suggestions; family stories remain original attributed contributions. This implementation accepts uploads; it does not claim unrestricted access to an iPhone photo library or a connected Dropbox account.

## Validation recorded in the source copy, before integration

- Production Next.js build and TypeScript check pass.
- 520 existing tests plus 14 new tests cover password hashing, account/household isolation, CSRF, invitation expiry/single use, revoked sessions, AI output coverage, deduplication, failure fallback, idempotent imports/stories, capture-based grouping, cross-family media denial and reminder opt-in/claiming.
- Real OpenAI import: 9 photos → 3 named events, zero rejected images and no fallback. Real multipart upload and retry also pass.
- Real transcription of an explicitly synthetic test recording reproduced its words; the approved story and original WAV were saved and retrieved successfully.
- Browser walkthrough: onboarding through all four steps, invitation acceptance in a separate session, shared collection, written story, patient access, map and graph. Responsive collection and drawer checked in real 390px and 320px iframe viewports; horizontal overflow fixed.
- Chrome’s automation extension blocked programmatic file-picker assignment. The same multipart upload endpoint and the browser’s sample-photo import were tested successfully. Live microphone capture and real SMS delivery remain untested.
- Language lint passes. The separate legacy call-fixture verifier still reports its five existing placeholder-media/timing warnings; its strict presentation readiness is not claimed by this work.

The validation above was recorded with the downloaded implementation; it is not a claim about provider or browser validation in the current checkout. Integration checks are recorded below.

## Integration into DementiaApp, September 20

Imported the 14 modified files and 23 new files from the downloaded `Relay` tree, preserving the current country-based phone field and its styles. Added fixes for phone helper TypeScript errors, existing access-key sign-in, call-record navigation, and links that could restore revoked accounts or reset reminder preferences. Pending account links now bind to the current credential version; old links from before this binding was introduced need to be recreated. Sample data, private databases, environment files, dependencies and build outputs from the download were not copied.

- `npm run check`: all 544 tests pass, plus TypeScript, fixed call-language checks and provenance verification. The five existing placeholder-media/timing warnings remain.
- `npm run build`: production build passes.
- HTTP checks against an isolated production server: all 10 entry pages render; signup, joint preferences, sign-out/sign-in, multipart upload and retry, unavailable-AI fallback, single-use invitations, shared stories, patient access, private media, household isolation, account revocation and cross-origin rejection pass.
- Browser automation was unavailable in this integration session. Microphone interaction and live OpenAI/Linq delivery were not exercised; HTTP checks used synthetic data with provider keys and call scheduling disabled. No messages were sent.

The separate patient-call flow is at `/conversations/call`; it is linked from the patient's photo view. `/conversations` opens the private session record directly. Collection configuration variables are documented in `.env.example`.

## Follow-up bug audit, September 20

The current checkout now passes 552 tests and a production build. Live OpenAI photo organization and transcription passed using illustrative photos and synthetic test audio in an isolated household database. See [the audit record](PHOTO_FIRST_AUDIT.md) for the fixes, animation comparison, and remaining verification limits. This supersedes the earlier integration note about provider checks; browser automation is still unavailable.
