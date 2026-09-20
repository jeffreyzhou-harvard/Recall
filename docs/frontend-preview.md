# Recall frontend preview

Built on branch `designs`, merged with main through `00a823b`, and prepared for the shared frontend handoff. The latest AGENTS.md and SPECS.md were reviewed before integration.

## Routes

- `/`: Susan's phone call; incoming, captions, remember choice, share choice, end.
- `/revisit`: another invitation, with a clear option to leave it for another time.
- `/onboarding`: phone-first photo, contact and calendar selection, then joint review and calling preferences.
- `/caregiver`: laptop-first 3D session bookshelf, brief observable session summaries and local conversation suggestions. Topic categories and the Weekly Note are collapsed. `/family` is an alias.
- `/design/recall`: development-only 390px / 320px phone frames.

The user chose Atkinson Hyperlegible Next, then replaced the initial bright Braille Institute palette with quiet neutrals and fewer patient choices. Typography remains self-hosted. Text enlargement and dark-background settings live on caregiver surfaces and also apply to Susan's view.

## Try the flow

Answer the sample call. Captions advance automatically; optional prototype controls below the phone pause or step the script. Both Yes/No decisions must resolve before words enter the in-memory sample graph. Sharing is restricted to Maya in this preview. A stopped call adds no new words. Declining storage retains only a completed call's observable outcome.

The caregiver overview shows a topic-only Weekly Note and neutral call records. It omits all patient quotations, including share-confirmed sample words, under the latest user direction. Replaying the same sample does not create another call in the record.

Setup accepts JPG/PNG/WebP photos (12 maximum, 10 MB each), vCard/CSV contacts and ICS events (1 MB, 200 entries maximum). Imported contacts and events begin unchecked. CSV columns: Name, optional Phone, optional Relationship. Calendar dates are shown as written in the file, without timezone conversion or recurrence expansion.

## Integration boundaries

This is an isolated frontend prototype, with fictional sample dialogue and history. Files remain in the tab; refresh clears them. No real graph indexing, identity verification, account authorization, audio recording, transcription, voice playback, outbound call, calendar connection, scheduled call or message delivery is claimed.

The latest main supplies the recall engine, 19 tools, separate confirmations and family projections. It removes the earlier WebRTC scaffold; future web transcription plugs into the call-driver and transcription-provider interfaces. `/present` exercises that engine. The visual prototype remains isolated under `lib/recall-preview`; its copy and thresholds live under `fixtures/preview` to avoid replacing engine fixtures. `lib/` does not import fixtures.

The Cape May phone preview keeps one photo prominent above short, literal caption portions. Consent replaces the photo with the exact contribution and decision. The AI-generated photo is explicitly labeled, preview-only, and excluded from all graph evidence; provenance and its full generation prompt are in `public/preview/SOURCES.md`. The removed `/call` routes are not restored by the frontend. Live speech, transcription and verified photo cues remain the next integration phase.

Tests cover confirmation ordering, stop behavior, private/share projection, record windows and thresholds, CSV/vCard/ICS parsing. The repository's strict media verification still reports the preexisting placeholder assets/timings.

## References

- [Framer University 3D bookshelf scroll](https://framer.university/resources/3d-bookshelf-scroll-animation-in-framer): user-selected interaction reference, implemented with original CSS and native scrolling.

- [Braille Institute typography](https://www.brailleinstitute.org/freefont/) and the user's subsequent request for a much quieter palette.
- [Apple Assistive Access](https://support.apple.com/guide/assistive-access-iphone/welcome/ios) and [Be My Eyes](https://www.bemyeyes.com/bme-app/): clear, large, direct actions.
- [REMI](https://remistory.com/): caregiver-led setup and familiar conversations.
- [REMME](https://tryremme.com/): personal-photo conversation flow and separate caregiver follow-up. Its clinical marketing and emotional analytics are not claims about Recall.

## Caregiver bookshelf and conversation requests

The user refined the waveform navigator into a 3D bookshelf inspired by the Framer University scroll reference. Each neutral cover is one sample call ordered by date; its face shows topic, date and a compact count waveform. The waveform peak is the absolute count of unaided calls for that topic in up to its last eight calls as of that date, paired with a denominator. Fewer than three calls is unmeasured and drawn with dashed marks. These are event counts, never audio recordings, biographies or a cognition score. `SessionBookshelf` uses native scrolling and snapping; cached slot geometry and requestAnimationFrame transform updates rotate the nearest cover continuously toward the reader. There is no fixed playhead or animation dependency. Touch, trackpad, mouse wheel, previous/next and Arrow/Home/End controls select the same session, preserved by ID when data changes. Wheel input returns to page scrolling at track boundaries. Reduced motion uses spaced flat covers, immediate scrolling and no receipt animation. The projection in `lib/recall-preview/sessions.ts` takes only topic metadata and outcome history, never words or graph claims.

The selected summary contains only date, topic, dated counts and a fixed support description. Suggest a conversation stays alongside it. The Weekly Note and topic records are closed disclosures. The caregiver design banner and development navigation were removed for the frontend handoff; fictional sample labels and a small integration-status note remain truthful.

The latest user request explicitly extends the older specs: caregivers may suggest a question for a future session, as well as contribute their own memory. These are distinct input modes and remain attributed to the caregiver. Question requests are limited to one short prompt, never answered from the graph. The current frontend saves and removes suggestions only in tab memory; photos remain local. It neither calls `/api/family/memory` nor schedules a session, changes the patient preview or bypasses sharing confirmation. The proposed timing is the next agreed call.

For live integration, the backend's existing redirect-only question contract must be revised with the required gate review. A question request needs an invitation/skip choice for Susan and a separate share decision for any returned answer. A pending request is never a memory claim.

Validation before the latest main merge: `npm run check` passed (258 tests, language lint, provenance checks). Browser checks covered 1440px, 1088px and 390px layouts, wheel selection, previous/next, Home/End, historical counts and insufficient-history summaries. Existing placeholder media and word timings still prevent strict demo readiness. Post-merge verification is recorded below.

## Backend handoff

After merging the latest main: `npm run check` passes all 418 tests plus language/provenance checks; `npm run build -- --webpack` passes. Validation used Node 24.19.0; the new onboarding database requires Node >=22.13.

| Surface | Frontend entry | Integration boundary |
| --- | --- | --- |
| Patient call | `components/recall/RecallPhone.tsx` | Replace scripted preview turns with call-driver events; preserve separate remember/share decisions. |
| Caregiver | `app/family/page.tsx`, `components/recall/SessionBookshelf.tsx` | Supply authorized session metadata/outcomes, with real dates. `SessionSummary` excludes personal words. |
| Setup | `app/onboarding/page.tsx` | Adapt local file selections and joint review to the new `/api/onboarding` contracts; no files currently leave the tab. |
| Conversation requests | `components/recall/MemorySuggestionForm.tsx` | Pending local suggestions only. The live request contract and patient invitation/share flow need implementation and gate review. |

`PreviewProvider` is the isolated fixture/state adapter, not authentication or persistence. No backend secret belongs in the client. The patient and caregiver surfaces are frontend boilerplate; live calling, authorized data loading and persistence remain separate integration work.

## Applied brand-book refresh

`BRAND_BOOK.md` is applied through the shared five-square connected-path mark, with clay path and endpoint on patient, caregiver, setup and web preview surfaces. The patient shows complete short caption portions with no word reveal. The caregiver shelf uses bottom-aligned resting heights of `(80 + 36 × unaided calls) / 368`, light spines below four measured calls and dark spines from four, with dashed unmeasured spines below three calls of history. The selected cover expands for reading. Desktop covers are 232 × 368px; phone covers are 216 × 330px; large-text covers are 390px tall.

Two legend symbols and one count definition replace the explanatory disclosure. Topic text filters and an elapsed-calendar-date timeline accompany the shelf. The timeline is a noninteractive indicator; book selection, keyboard and previous/next controls remain the navigation. Only visible books receive per-frame transforms.

Setup offers 12 fictional photo records in three albums, eight unchecked contacts and 18 unchecked occasions. Capture or digitization dates stay separate from the family-provided year depicted. Metadata details disclose simulated provenance. The 96 fictional historical calls span June 15–September 18, 2026. Selected sources become reviewable after agreement; the sample launcher opens a fictional conversation and places no call.

This documentation refresh records source behavior, not final validation of the latest edits. Earlier check/build results above are historical. The implemented caregiver heading remains 42px (36px on phones), below the brand book’s proposed 44–64px range.
