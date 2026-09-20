# People in the shared collection

Open `/caregiver#people` or choose **People** in the sidebar, then **Find people**. Existing collection photos are checked on demand; new uploads become eligible on the next scan. No API key is needed. The first scan downloads about 12.4 MB of model weights from this application's own `/models/face-api` route, plus the lazily loaded inference bundle. WebGL is preferred; CPU is the fallback. CPU scanning can be slow on older devices.

Suggested groups show cropped faces and photo counts. Open a group to name it, see its photographs, combine duplicates, separate a mistaken match, or dismiss a false detection. Names come only from family input, with the author and timestamp recorded. Scanning never infers names, relationships, age, gender, emotion, health, or identity in the patient-call graph. Illustrations, small faces, side profiles, glasses, aging and poor lighting can cause missed or incorrect matches. Review the suggestions; this is photo organization, not identity verification.

## Implementation and storage

- `client/face-detection.ts` loads the browser ESM bundle of `@vladmandic/face-api@1.7.15`. Only SSD MobileNet v1, 68-point landmarks and the face descriptor network are loaded. Detection uses confidence 0.55 or higher, at most 30 faces per photograph. There are no remote face service calls.
- `server/circle/people.ts` validates batches of up to eight known collection photos. Each detected face stores its normalized box, detector confidence and 128-dimensional descriptor. Automatic grouping requires distance below 0.48 to every member of a group and a 0.06 margin over the next candidate. Two faces from one photograph never automatically join. These conservative thresholds are heuristics, not measured accuracy guarantees. Manual corrections remain in place when later photos are added.
- The existing household-scoped SQLite state stores the face index and labels. Descriptors are not encrypted separately from that private store and are not exposed by collection/People reads. Public-facing responses include only groups, photo IDs, crop boxes and naming provenance. Authenticated face thumbnails use `private, no-store`; the source photos stay behind existing collection authentication. Participant-only and revoked accounts cannot access People.
- A scan is idempotent per photograph. Saved batches survive a stopped scan. An organizer's **Clear face groups** removes the current face index, including descriptors and names; photos and stories remain. A generation token rejects in-flight results from before a clear, and revision checks reject stale edits. Re-scanning after clearing recomputes groups. Existing backups, if maintained externally, have their own retention.
- No face result changes a call-graph claim, a relationship, a moment's manually confirmed participants, or reminder recipients. The user-authorized scope is recorded in `AGENTS.md` and `PHOTO_FIRST_SCOPE.md`.

## Dependency provenance

The selected [face-api project](https://github.com/vladmandic/face-api) is MIT licensed and was archived on February 5, 2025. Version 1.7.15 is pinned; it is not an actively maintained dependency. The browser wrapper isolates it for a future replacement. We vendor only the three required model sets, their upstream license and SHA-256 checksums in `public/models/face-api/`. See that directory's `SOURCES.md` for provenance. No runtime CDN is required.

`tests/people.test.ts` checks matching ambiguity, chain prevention, corrections, persistence, stale scans/edits, input validation, authorization, household isolation and real JPEG cropping. Production build and the repository's `npm run check` cover integration. Model detections should also be spot-checked on representative, consented photos before relying on the group suggestions.

## Sidebar

The collection and conversation dashboard share a collapse icon and a draggable right edge. Expanded width ranges from 200–340 pixels. The focused separator also accepts Left/Right arrows and Home/End; double-click resets its width. Width and collapsed state persist in this browser. A collapsed sidebar retains named icon links; mobile keeps its existing compact navigation.
