# Fictional family intake

`family-library.ts` is a browser-safe sample of intake candidates, not a database seed. It contains 12 photo records in three albums, eight contacts and 18 family occasions. Nothing is checked or approved on load. There are no real contact details, patient statements, confirmed facts, call permissions or scheduled Recall calls. Photo metadata is authored example data; it was not extracted from the illustrative images.

## UI mapping

- Import `mockFamilyLibrary` into UI composition code. Do not import it from `/lib` or feed it to the live graph or onboarding API.
- `photos` supplies the phone onboarding selection cards. `file` describes a fictional iPhone export; `familyContext` is the contributor's separate entry. Its people links describe family context, not a face-identification result or a claim that everyone linked appears in the image. Keep the capture date distinct from the approximate year of the depicted event. A recently digitized family print can have both dates.
- Nine distinct generated illustrations are documented in `public/preview/SOURCES.md`. The fourth item in each album explicitly reuses an album illustration. Their mock HEIC/JPEG filenames, dimensions, lens, focal length and ISO are deliberately not claims about the PNGs. None depicts a verified real family, school or garden.
- `contacts` is the small selection the family chose to bring in. Relationships are stated by Maya. `selected` does not mean approved: every contact starts at `pending_joint_review`. There are no phone numbers or address-book credentials.
- `occasions` contains selected, all-day family occasions. These are optional family context, not a calendar subscription, reminders, event invitations or a mechanism to initiate a Recall call.
- `topics` connects the selected items to the existing `cape-may`, `lincoln` and `princeton` session topic IDs. These links are fictional editorial links, not model discoveries or evidence verification.
- Existing `fixtures/recall-preview.json` remains the sole scripted preview conversation. This library adds no first-person statements. Do not convert the family captions into Susan's words or treat their topic links as permission to speak facts to her.

`samplePhotos`, `sampleContacts` and `sampleEvents` are small adapters for the onboarding UI. Contacts and events are unchecked; photo selection must also be an explicit UI action. An explicit **Use sample data** action can load this set. Keep the fixture disclosure visible in setup, retain the actual joint-review step, and keep family attribution separate from Susan's store/share choices. Completing this frontend walkthrough must not imply that the live backend saved a setup or scheduled a call.

The caregiver session waveform should continue to use only the existing session-summary projection. It may show a count for one topic and its denominator, with the existing minimum-history rule. These intake records add no memory-strength metric, clinical inference, cross-topic score or access to private claims.

## Historical call samples

`session-timeline.json` contains 96 fictional call events, from June 15 through September 18, 2026. Its first 78 events are alternating Cape May and Lincoln topics, 39 each, before the original 18 September events. The corresponding history arrays in `fixtures/recall-preview.json` use only `unaided`, `cue` and `recognition`. They are authored observable-event samples, not model inferences, measurements or new scripted patient speech.

The original September event IDs, dates and order are preserved. Their Cape May/Lincoln history indices are offset by 39; Princeton's two events and indices are unchanged so its insufficient-history presentation remains visible. The original final eight outcomes for Cape May (6 unaided of 8) and Lincoln (5 of 8) are unchanged. Historical projections still slice at the event's own history index, never using a later call to draw an earlier peak. The larger fixture intentionally exercises scrolling across months without introducing any cross-topic aggregate.
