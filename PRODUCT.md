# Product

<!-- impeccable:product-schema 1 -->

## Platform

Web — patient calls and joint setup prioritize phones; caregiver records prioritize laptop browsers with a single-column fallback.

## Users and purpose

Recall invites a person to revisit their own memories with source-backed cues, and encourages family to talk with them directly. Names and relationships come from the authorized household; primary routes contain no default Susan/Maya family or sample history.

## Current scope

- `/`: guest welcome with “I’m new here” and “Sign in”; signed-in users continue by role.
- `/get-started`: joint setup or invitation entry.
- `/sign-in`: existing private access keys, not public email/password signup.
- `/onboarding` and `/onboarding/manage`: connected joint setup, household permissions, topics, invitations and call access.
- `/join`: one-time invitation acceptance.
- `/caregiver` and `/family`: authorized contributor-owned Moments, Places, Connections and Stories, plus persisted Weekly Note, session bookshelf, per-topic records, exports and real attributed memory/media contributions.
- `/revisit`: patient-only scheduled browser calls, microphone input, Recall speech and original-audio confirmation playback.
- `/design/*`: redirects to `/`. `/present` remains a separate fixture-based engine harness.

The first household on an empty configured installation can complete setup without an existing access key; its browser session is bound to that household. Subsequent household creation and management remain protected. Returning sign-in uses the current private access-key system, not email/password registration. Live deployment needs configured persistence, access, scheduling and audio providers; see `docs/backend-integration.md`. Browser audio and deployment readiness require their own verification.

## Product constraints

“Cues, not answers — every memory stays in her own words.” Never generate speech as the person or infer clinical/emotional state. The reducer and tools enforce evidence, separate store/share confirmation and stopping. Current caregiver UI excludes all patient quotations, even share-confirmed lines; records expose only authorized observable facts and topic counts. Contributions retain the family member’s attribution. Questions invite direct human contact and cannot trigger an immediate call.

Safety phrase handoffs and missed-call tiering follow the backend’s fixed rules and designated recipients. They are not clinical assessments or between-call monitoring. The application must not invent extra alert behavior.

## Brand commitments

`BRAND_BOOK.md` owns the approved direction; `DESIGN.md` records shipped implementation. Self-hosted Atkinson Hyperlegible Next, warm paper, dark ink, sage grouping and a small clay five-node connected-path logo apply across routes. Keep the font license. Avoid bright fields, elevated shadows, decorative status dots and clinical dashboards.

The caregiver shelf uses neutral dated counts, bottom-aligned spines, a reading-sized open cover, a simple legend and elapsed-date marker. Thresholds and windows come from the backend. Current patient UI shows live prompts and audio states; the familiar-photo and short-caption composition remains a direction target, not a mounted preview.

## Accessibility

Preserve large direct actions, visible focus, native form labels and reduced-motion behavior. Shared dark and large-text preference styles remain; the caregiver workspace uses readable defaults without the former Text & contrast menu. End call remains available during an active call. Keep account errors and loading states explicit. Do not hide a permission decision in pursuit of visual simplicity.

## Integration boundaries

Real JPEG/PNG photo and WAV voice contributions remain connected. The collection accepts up to 20 JPEG/PNG photos at 6 MB each through the existing private media API; HEIC conversion and automatic EXIF import are not implemented. Family settings exposes the existing invitation, contact and calendar import flows. Collection labels and historical pins remain audit metadata rather than edits to call evidence. Patient and other contributors’ private words are excluded from the signed-in contributor’s collection. No question-request queue is mounted. `fixtures/preview` and preview test helpers may remain for development; primary routes do not mount them. No generated preview image is real household evidence.
