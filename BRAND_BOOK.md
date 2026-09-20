# Recall — brand book

Version 1 · September 19, 2026 · For product designers and Cursor

**Familiar memories. Room to speak.**

Recall is an AI phone-call system for people living with dementia. It invites the person to revisit her own memories, offering a little more context only when needed. Family contributes context and receives a quiet, count-only account of calls. Recall should make it easier to connect with the person, never become a substitute for calling her.

This book establishes the visual direction before its application to the frontend. It preserves the existing quiet interface and Atkinson typography. The user's selected connected-node logo informs the identity's geometry; its bright red is replaced with a restrained clay accent. `AGENTS.md` owns behavior and privacy. This book owns brand expression. `DESIGN.md` documents the implemented tokens and components.

## 1. Character

Calm, familiar, direct, adult. A still photograph on a clear table, with room beside it for one spoken thought.

Peacefulness comes from fewer competing elements, stable positions, and readable contrast. It does not come from pale text, tiny controls, slow responses, or decorative emptiness. Use everyday family photographs and plain sentences. Avoid medical-dashboard aesthetics, cartoon reassurance, neon accents, and anything that makes the person feel assessed.

The person leads; the interface waits. Show one question, one photograph, and one decision at a time. On family screens, show the minimum account that helps someone understand the call and make contact themselves.

## 2. Identity

### Primary mark: the connected path

Five square nodes sit on a three-by-three grid: top-left, top-right, center, bottom-left, and bottom-right. An orthogonal path rises from bottom-left through the center to top-right. The path and endpoint are clay; the other nodes are ink. This is the compact logo from the user's selected connected-node reference. It is a static identity, not an interactive memory graph or a measurement of the person's memory.

- Pair it with **Recall**, set in Atkinson Hyperlegible Next, weight 650.
- At ordinary app size, use a 32px mark with a 12px gap before the 28px wordmark.
- Minimum stand-alone mark: 24px. Keep clear space of at least one node width on all sides.
- Use ink nodes and a clay path/endpoint on family/brand surfaces.
- Use the same restrained clay path on the patient screen and web preview, as requested. Keep every surrounding call control neutral. The name remains readable without the mark. A monochrome export is available for one-color reproduction.
- Never pulse, bounce, flash, or animate the mark during a call.
- No gradients, outlines around the lockup, drop shadows, or stretched proportions.

### Supporting motif: the full context grid

The reference's full nine-node grid is the larger expression of the same identity, used for explaining context in documentation. Use ink nodes and a clay path/endpoint. The compact five-node version remains the app mark. Neither is patient navigation or a caregiver database browser. Keep the actual graph off the patient screen. The waveform remains a caregiver visualization, not a competing logo.

Assets: `public/brand/recall-mark.svg`, `public/brand/recall-mark-mono.svg`, and `public/brand/recall-context.svg`. These are original vector constructions adapted from the user's supplied geometric reference; no photo asset is needed for the logo.

## 3. Color

Most of a screen is paper and ink. Sage quietly groups related content. Clay marks one current position or the logo's connecting path. Do not assign each topic a bright color.

| Token | Value | Use |
| --- | --- | --- |
| Paper | `#FAFAF7` | Default page and patient background |
| Ink | `#242C28` | Text, main actions, measured book spines |
| Secondary ink | `#535E57` | Supporting text and dates |
| Mist | `#F0F2EC` | Quiet grouped areas |
| Sage paper | `#E9ECE6` | Book covers, selected source backgrounds |
| Divider | `#BDC5BD` | Nonessential separators; never an essential control boundary alone |
| Sage line | `#C6CEC5` | Decorative rules |
| Focus | `#354F43` | Visible keyboard outline; selected controls |
| Clay | `#98513F` | Small brand accent and current timeline marker |

Measured against Paper: Ink **13.70:1**, Secondary ink **6.46:1**, Focus **8.54:1**, Clay **5.60:1**. These pairs meet the normal-text contrast target. Check any new combination separately; a passing palette does not certify the interface.

Use ink or secondary ink for an essential input/button boundary. Divider is deliberately too quiet to carry the only clue that something can be pressed. Pair color with shape, position, text, or a visible selected border. Clay never means "poor recall"; book heights never turn into a red–green scale.

Dark preference uses a quiet neutral ground `#18201C`, text `#F5F6F2`, secondary `#CDD5CD`, grouped surfaces `#27332B`, rules `#7C8D80`, focus `#D0DBCF`, and clay `#DCA38F`. Never force dark mode based on time. Maintain the user's selected reading preference across patient and caregiver surfaces in the current session.

## 4. Type

Use the already self-hosted **Atkinson Hyperlegible Next** variable font for the whole app. It is designed with distinctive letterforms for low-vision readers; font choice is one part of accessibility, not a claim that the app treats dementia. Keep its license beside the font assets. [Braille Institute font reference](https://www.brailleinstitute.org/freefont/)

| Role | Size | Weight | Line height |
| --- | --- | --- | --- |
| Patient caption | 32px; 40px in large text | 500 | 1.36 |
| Patient question | 28px minimum | 650–700 | 1.3 |
| Patient supporting text | 24px minimum | 400–500 | 1.4 |
| Patient action | 24–26px | 600 | 1.2 |
| Caregiver page heading | 44–64px responsive | 650–750 | 1.1 |
| Caregiver section heading | 28–32px | 600–650 | 1.2 |
| Caregiver body | 20px; 24px in large text | 400 | 1.4–1.5 |
| Caregiver labels/details | 17–18px; 20px in large text | 400–600 | 1.4 |

Use sentence case, left alignment, and ordinary word spacing. No all-caps labels, condensed fonts, italic passages, or lightweight text for key information. Keep captions to a short thought; do not shrink text to fit a fixed box. A photograph may yield space to readable words. Keep consent controls visible by allowing the text area to scroll.

## 5. Layout and controls

Use a spacing rhythm of **8, 12, 18, 24, 32, 40px**. Related text stays close; different decisions have clear separation. Use 24px patient side padding, at least 18px at narrow widths, and a 560px maximum phone surface. The caregiver dashboard is laptop-first, around 1080px maximum, with a single-column fallback. Setup is phone-first.

Patient primary actions are at least **64px tall**, preferably 76px. Caregiver controls have at least **44 × 44px** hit areas. A 16px icon may sit inside a 44px button; the icon alone is not the target. Keep 12–18px between independent actions. Use 12px action corners, 6px form-field corners, and 8px photo corners. Surfaces are flat; borders and spacing provide structure. The caregiver bookshelf is the one deliberate use of perspective.

Every control has a text label or an accessible name. Icons supplement words on the patient screen. Keyboard focus is a 3px Focus outline with a 5px offset. Hover is a quiet background change; never rely on hover for essential information. Errors name what happened and what to do next beside the relevant field.

## 6. The three product surfaces

### Patient call: one familiar thing

Lead with one selected, relevant photograph and one large caption portion. Preserve a recognizable person/topic context and stable control positions. Keep metadata, graph structure, statistics, scrolling books, family setup, and technical traces outside this view. Do not print text over a photo.

Recall identifies itself plainly as an AI assistant. Its spoken invitation is short and has one question. The system offers free recall, context, association, and recognition only as needed under the approved script. The UI does not label these as levels or display progression. Recognition presents at most two choices. The person may end or decline without pressure.

Remembering and sharing are distinct decisions. Show the exact pending words in the consent step when the flow requires them; never rewrite the person's words. Yes and No use equal visual weight and stable placement. Never preselect consent, hide No, or frame declining as a failure.

### Family setup: choose, inspect, agree

Organize photos by familiar album names. Show one thumbnail, a short caption, and a clear selection control; reveal detailed metadata only on request. Keep the iPhone capture/digitization date separate from the approximate year depicted. Family-entered names, places, and captions remain visibly attributed. A photo's file metadata is not evidence of identity.

Contacts and calendar occasions start unchecked. Show selected counts. Permission choices for faces, places, dates, and themes remain independent. Editing an agreed setup returns it to review. The final joint agreement explains what has been selected and the call window. Preview data stays clearly labeled as fictional, with no claim that a real call has been scheduled.

### Caregiver overview: a quiet record

The bookshelf contains dated call records. Closed spines align to one baseline. Their varying heights show the **number of unaided calls for that topic within up to its last eight calls, as of that date**. Keep the count and denominator visible on the opened book. Height is not a cognition, wellbeing, emotion, or memory-strength score. Topics with fewer than three calls use an outlined, dashed spine and no measured peak.

One book opens at a time. Binding rules and a fine page edge are enough to suggest a book; omit leather textures and ornaments. At desktop size, resting heights range from 80px for zero unaided calls to 368px for eight, with 36px per additional call. Measured counts below four use a light spine; four and above use ink. Height and the exact printed count carry meaning together; color is only a reinforcement. The open cover grows for readability, and its displayed count remains the quantitative explanation. Support descriptions and dates are sufficient for the summary. Do not expose raw transcripts, private quotes, or a queryable memory graph in this record.

Use two small visual legend keys: **taller bars + “More without a cue”**, and **an outlined dashed spine + “Fewer than 3 calls.”** One short supporting line defines the same-topic, last-eight window. Avoid an explanatory dropdown. Keep topic filters separate from the legend and avoid giving each category its own colored panel.

Under the shelf, draw a thin horizontal timeline, its first and latest dates, and a small current-position marker. The date position follows elapsed calendar time; label it “Call dates.” Keep it separate from height encoding. Use a narrow slider hit area only visually; its interactive target must remain at least 44px tall. Previous/next and keyboard navigation remain available.

Keep “Suggest a conversation” near the selected session and route family back to personal contact. A pending suggestion is a caregiver contribution, never an answer manufactured from the person's private graph. Live scheduling and sharing still require their own approved backend gates.

## 7. Motion

The patient surface stays still. Use brief opacity changes only when replacing content, with stable position and no letter-by-letter typing, pulsating indicators, camera zooms, celebratory effects, countdowns, or auto-rotating media.

The caregiver shelf may rotate as a direct response to a scroll or selection. Use native scrolling, cached geometry, and transform-only frame updates. Animate only the visible books. Do not animate unrelated cards as they enter the page. Prefer 120–180ms feedback for controls and text replacement.

With reduced motion, flatten the shelf, remove perspective movement and receipt fades, and navigate instantly. The dates, counts, selection, and controls must still work. Motion must never be required to understand a call. [W3C guidance on interaction animation](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)

## 8. Voice and privacy

Speak to an adult. Be brief, concrete, and kind without praise for performance. Use names and familiar nouns where context permits. Say “We can leave that for another time,” not “You failed to remember.” Say “A photo from Maya,” not “A verified memory,” when it is Maya's contribution.

| Prefer | Avoid |
| --- | --- |
| “Would you like to talk about Cape May?” | “Let's test your memory.” |
| “Would you like me to remember that?” | “Save to your second brain.” |
| “6 of 8 calls without a cue” | “Memory strength: 75%.” |
| “Want to give Susan a call?” | “Ask the AI what Susan thinks.” |
| “Selected photos” | “We know your family.” |

No treatment, improvement, clinical-monitoring, mood, or disease-stage claims. No simulated persona or generated first-person speech. Counts describe observed call events, not the person's capabilities. Rich mock data tests information design and flow; it cannot establish product effectiveness.

## 9. Accessibility acceptance

Treat these as implementation targets to verify, not a certification:

- Normal text at least 4.5:1; large text at least 3:1. Aim for 7:1 for the patient's principal words. Never lower text opacity to make a page feel quieter. [WCAG contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- Essential component boundaries and focus indicators remain distinguishable. Meaning is also expressed through wording/shape.
- Use Recall's 44px caregiver and 64px patient targets, deliberately more generous than WCAG 2.2's 24px minimum with exceptions. [WCAG target sizes](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- Check 320px and 390px phone widths, laptop width, 200% zoom, large text, dark preference, keyboard-only use, screen-reader names, and reduced motion.
- No page-level horizontal overflow; a labeled horizontal bookshelf may scroll within its own area.
- Preserve focus after actions. Announce the settled selected call politely, not every animation frame. Never duplicate spoken captions aggressively through a live region.
- Respect choice, attribution, and privacy as part of accessibility. Do not mistake visual simplicity for permission to hide an important decision.

## 10. Paste into Cursor

Use this instruction with `@BRAND_BOOK.md`, `@DESIGN.md`, `@AGENTS.md`, and the relevant frontend files:

> Modify the existing Recall frontend to follow BRAND_BOOK.md's colors, typography, geometry, spacing, accessibility, and motion rules. Preserve product behavior, separate remember/share gates, privacy projections, and current route structure. Use the connected-node logo with the same small clay path on caregiver, patient, and web-preview surfaces. Keep photos and short, complete caption portions prominent. For the caregiver bookshelf, bottom-align varying-height spines, simplify the legend to two visual keys and one short count definition, and add the dated timeline beneath it. Keep Suggest a conversation. Do not introduce memory scores, inferred emotions, transcripts in the caregiver record, new dependencies, or live API calls. Mark mock data honestly. Verify phone/laptop, keyboard, large-text, dark, and reduced-motion behavior; run the repository's required checks. Update DESIGN.md and its sidecar to reflect what actually ships.

Implementation order: **this book → reusable tokens and mark → components → visual/accessibility checks → documentation**. For future changes, preserve this direction and request a decision only when the product requirements conflict; do not replace it with a generic healthcare dashboard.
