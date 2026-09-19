# Recall frontend preview

Built on branch `designs`, merged with main through `00a823b`, and prepared for the shared frontend handoff. The latest AGENTS.md and SPECS.md were reviewed before integration.

## Routes

- `/`: Susan's phone call; incoming, captions, remember choice, share choice, end.
- `/revisit`: another invitation, with a clear option to leave it for another time.
- `/onboarding`: phone-first photo, contact and calendar selection, then joint review and calling preferences.
- `/caregiver`: laptop-first session waveform, brief observable session summaries and local conversation suggestions. Topic categories and the Weekly Note are collapsed. `/family` is an alias.
- `/design/recall`: development-only 390px / 320px phone frames.

The user chose Atkinson Hyperlegible Next, then replaced the initial bright Braille Institute palette with quiet neutrals and fewer patient choices. Typography remains self-hosted. Text enlargement and dark-background settings live on caregiver surfaces and also apply to Susan's view.

## Try the flow

Answer the sample call. Captions advance automatically; optional prototype controls below the phone pause or step the script. Both Yes/No decisions must resolve before words enter the in-memory sample graph. Sharing is restricted to Maya in this preview. A stopped call adds no new words. Declining storage retains only a completed call's observable outcome.

The caregiver overview reveals a shared sample quote after those two choices. Private sample words are omitted. Replaying the same sample does not create another call in the record.

Setup accepts JPG/PNG/WebP photos (12 maximum, 10 MB each), vCard/CSV contacts and ICS events (1 MB, 200 entries maximum). Imported contacts and events begin unchecked. CSV columns: Name, optional Phone, optional Relationship. Calendar dates are shown as written in the file, without timezone conversion or recurrence expansion.

## Integration boundaries

This is an isolated frontend prototype, with fictional sample dialogue and history. Files remain in the tab; refresh clears them. No real graph indexing, identity verification, account authorization, audio recording, transcription, voice playback, outbound call, calendar connection, scheduled call or message delivery is claimed.

The latest main supplies the recall engine, 19 tools, separate confirmations and family projections. It removes the earlier WebRTC scaffold; future web transcription plugs into the call-driver and transcription-provider interfaces. `/present` exercises that engine. The visual prototype remains isolated under `lib/recall-preview`; its copy and thresholds live under `fixtures/preview` to avoid replacing engine fixtures. `lib/` does not import fixtures.

The Cape May phone preview keeps one photo prominent above short, literal caption portions. Consent replaces the photo with the exact contribution and decision. The AI-generated photo is explicitly labeled, preview-only, and excluded from all graph evidence; provenance and its full generation prompt are in `public/preview/SOURCES.md`. The removed `/call` routes are not restored by the frontend. Live speech, transcription and verified photo cues remain the next integration phase.

Tests cover confirmation ordering, stop behavior, private/share projection, record windows and thresholds, CSV/vCard/ICS parsing. The repository's strict media verification still reports the preexisting placeholder assets/timings.

## References

- [Braille Institute typography](https://www.brailleinstitute.org/freefont/) and the user's subsequent request for a much quieter palette.
- [Apple Assistive Access](https://support.apple.com/guide/assistive-access-iphone/welcome/ios) and [Be My Eyes](https://www.bemyeyes.com/bme-app/): clear, large, direct actions.
- [REMI](https://remistory.com/): caregiver-led setup and familiar conversations.
- [REMME](https://tryremme.com/): personal-photo conversation flow and separate caregiver follow-up. Its clinical marketing and emotional analytics are not claims about Recall.

## Caregiver waveform and conversation requests

The user replaced the node diagram with a waveform-shaped session navigator. Each burst is one sample call, ordered by date. Its peak is the absolute count of unaided calls for that topic in up to its last eight calls as of the selected date, paired with a denominator. Fewer than three calls is unmeasured and drawn with dashed marks. This is an event visualization, never an audio waveform or memory-strength score. `SessionWaveform` uses native scrolling, scroll snapping, a fixed playhead, keyboard controls and reduced-motion support; no new dependency. Its projection in `lib/recall-preview/sessions.ts` takes only topic metadata and outcome history, never words or graph claims.

The selected summary contains only date, topic and a fixed support description. Suggest a conversation stays alongside it. The Weekly Note and topic records are closed disclosures. The caregiver design banner and development navigation were removed for the frontend handoff; fictional sample labels and a small integration-status note remain truthful.

The latest user request explicitly extends the older specs: caregivers may suggest a question for a future session, as well as contribute their own memory. These are distinct input modes and remain attributed to the caregiver. Question requests are limited to one short prompt, never answered from the graph. The current frontend saves and removes suggestions only in tab memory; photos remain local. It neither calls `/api/family/memory` nor schedules a session, changes the patient preview or bypasses sharing confirmation. The proposed timing is the next agreed call.

For live integration, the backend's existing redirect-only question contract must be revised with the required gate review. A question request needs an invitation/skip choice for Susan and a separate share decision for any returned answer. A pending request is never a memory claim.

Validation before the latest main merge: `npm run check` passed (258 tests, language lint, provenance checks). Browser checks covered 1440px, 1088px and 390px layouts, wheel selection, previous/next, Home/End, historical counts and insufficient-history summaries. Existing placeholder media and word timings still prevent strict demo readiness. Post-merge verification is recorded below.

## Backend handoff

After merging the latest main: `npm run check` passes all 418 tests plus language/provenance checks; `npm run build -- --webpack` passes. Validation used Node 24.19.0; the new onboarding database requires Node >=22.13.

| Surface | Frontend entry | Integration boundary |
| --- | --- | --- |
| Patient call | `components/recall/RecallPhone.tsx` | Replace scripted preview turns with call-driver events; preserve separate remember/share decisions. |
| Caregiver | `app/family/page.tsx`, `components/recall/SessionWaveform.tsx` | Supply authorized session metadata/outcomes, with real dates. `SessionSummary` excludes personal words. |
| Setup | `app/onboarding/page.tsx` | Adapt local file selections and joint review to the new `/api/onboarding` contracts; no files currently leave the tab. |
| Conversation requests | `components/recall/MemorySuggestionForm.tsx` | Pending local suggestions only. The live request contract and patient invitation/share flow need implementation and gate review. |

`PreviewProvider` is the isolated fixture/state adapter, not authentication or persistence. No backend secret belongs in the client. The patient and caregiver surfaces are frontend boilerplate; live calling, authorized data loading and persistence remain separate integration work.
