# Caregiver collection integration

`CircleApp` now hosts Moments, People, Places, Connections, Stories and Recall sessions in one rail at `/caregiver`, `/family` and `/conversations`. The conversations route opens the sessions section; old section hashes still work. Family settings links directly to `/onboarding/manage`. On small screens all sections are available through a native picker. The retired `FamilyDashboard` shell is removed.

`components/circle/RecallSessions.tsx` consumes the existing dashboard, export and pause endpoints. `SessionHistory.tsx` retains the keyboard-accessible animated bookshelf, with a narrow height range, a visible legend, a date timeline and a flat reduced-motion alternative. Every count has its denominator, every factual record sentence comes from the family copy fixture or record tools, and server-supplied thresholds drive the view. Weekly-note access cannot reveal history, topic counts or export controls. Shared patient quotations stay out of this counts-only view.

The sample family's record and export endpoints resolve the same durable household store as its patient call demo, using the signed caregiver account. Record and export tools, access checks and export logging are unchanged. The normal deployment still uses its existing live service. `RecordPrintout.tsx` portals the returned export text to the body; `sessions.css` isolates it for printing and the print effect restores the page title afterwards.

The following archive details describe the earlier contributor-library implementation; current Circle photos and stories use `/api/circle` (see `docs/PHOTO_FIRST_SCOPE.md`).

## Connected features

| Surface | Current behavior |
| --- | --- |
| Moments | Two-column desktop photo cards, single-column mobile cards, title/place/people search, story filter and attributed contributions. The contribution form draft survives destination changes. |
| Add photos | Native selection or drop target, previews and removal, title plus literal account, optional people/date/historical place and manually chosen map pin. Multiple photos form one moment and one initial claim. |
| Moment details | Original-photo gallery/lightbox, editable collection metadata and additional original written or recorded stories. |
| Stories | Contributor-attributed literal text and original audio playback; no generated retelling. |
| Places | MapLibre with muted OpenStreetMap raster tiles, photo pins, map navigation and explicit unpinned/error states. A historical place is selected manually; this is not location tracking. |
| Connections | Named people, places, photo moments and source stories on a dotted canvas. Four moments per page; story nodes appear when their moment is selected or in the Stories filter. Filters, zoom, pan, keyboard selection and an inspector retain access to the collection. |
| Family settings | Existing household permissions, invitations, knowledge review, contact and calendar import flows at `/onboarding/manage`. |
| Recall sessions | Persisted session bookshelf, observable per-topic counts, privacy-limited Weekly Note, authorized export, pause and fixed safety notices. |

The static clay connected-path wordmark and self-hosted Atkinson Hyperlegible Next remain shared. The desktop rail becomes a native section picker below 760px. Upload dialogs and detail drawers contain focus, return it on close and support Escape when not saving. Reduced-motion alternatives cover the graph, map travel and upload presentation.

## Evidence and privacy boundaries

`GET /api/family/library` uses `server/family-library.ts` to project only the signed-in approved contributor’s own family-confirmed material. Patient words and other family members’ private accounts do not enter the collection, search, map or connections. Access is checked against current setup, reads are logged, and blocked topics are excluded before grouped accounts/photos are exposed. The collection is not the underlying private memory graph and is not a family question-answering surface.

`POST /api/family/library` supports `create`, `edit` and `story`. Creation submits the short title and literal account through the existing reviewed knowledge import path. A place is passed to that evidence path only when its exact text occurs in the account. Additional photos attach as evidence to one claim rather than creating duplicate tellings for topic ranking.

People/date/map pins and subsequent collection edits are append-only audit metadata used by the library projection. They do not rewrite original evidence, create inferred relationships in the call graph or silently revise what Recall may say. Added stories use the existing attributed contribution tool and topic/privacy gates. Requests carry idempotency identifiers; metadata edits support revision checks. No collection action schedules an immediate call.

## Media and external dependencies

Photo selection accepts at most 20 JPEG/PNG files, each at most 6,000,000 bytes, through the existing private family-media API. HEIC must be exported to JPEG first. EXIF location is not automatically imported. Original audio uses the existing voice contribution flow. Uploaded originals remain attributed evidence; no facial recognition, generated story or voice cloning is introduced.

Places fetches external OpenStreetMap tiles through MapLibre and retains attribution. The deterministic judged route does not depend on that basemap. The reference application’s OpenAI integration and Linq reminders are not integrated here. Existing invitation/contact/calendar imports remain available through Family settings; these are distinct from native photo upload limits.

## Access and readiness

On an empty configured installation, `/api/onboarding/start` permits first setup without a pre-existing access key and issues a browser session bound to the new household. It does not grant general operator access. Once a household exists, subsequent household creation and management remain protected. Returning sign-in continues to use the current private access-key system; this is not email/password registration.

No sample household is installed in a real account. Screenshots under `.impeccable/review/caregiver-dashboard` are review artifacts, not evidence of live household data or permanent graph geometry. This UI integration does not establish deployment readiness, clinical validity or browser-call audio reliability; those require their own existing backend/provider checks.
