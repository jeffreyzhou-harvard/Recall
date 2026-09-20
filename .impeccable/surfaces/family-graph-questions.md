# Family graph questions

Mode: Operate. Extension of Circle's Connections view, authorized by the user on 2026-09-20.

## Direction contract

THESIS: Let a family ask a question and follow the answer back to an attributed story or photo group.

OWN-WORLD: Inherit the current Circle paper, ink and sage tokens, Atkinson controls, serif headings, and Lucide icons. Preserve the existing graph and its animation.

STORY: A family member asks about their collection, reads a sourced answer, opens the original moment, or chooses a suggested conversation question. Private call content stays outside the query projection.

FIRST VIEWPORT: A small sans-serif heading doubles as the question field's label above the graph. A one-row textarea and Ask action share the desktop row and stack on narrow screens. One short source note and a collapsed Try a question disclosure replace the repeated explanations and visible suggestion row. Answers expand in document flow, with source links and a short list of conversation ideas.

FORM: Local extension; no concept seed or replacement visual world. Clear loading, empty, unavailable-provider and error states. Cancellation and source navigation remain keyboard accessible. No decorative animation or generated images.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Implementation evidence — 2026-09-20

This is an ordinary extension of the shipped Circle interface. `components/circle/CircleApp.tsx` places `GraphQuestions` above the existing Connections graph for family members; source actions open the existing photo-group detail. `GraphQuestions.tsx` and `graph-questions.css` retain Circle's Atkinson controls, Georgia headings, paper and sage surfaces, Lucide icons, and inherited focus styles. No raster assets or new animation were added.

The labeled native textarea sits beside Ask, stacking below 560px. Answers and attributed source disclosures use two columns, stacking below 900px. Citation buttons open and focus the corresponding native disclosure; sources retain their author's text, attribution and available date. Conversation ideas have their own heading. Loading, cancel, error, no-match, limited-source and provider-unavailable search states are explicit. Clear answer and cancellation return focus to the field; cancellation aborts the request, and the field remains focusable through `readOnly={busy}`. Results reset when the collection revision changes; pending requests are aborted on revision change or unmount.

The 2026-09-20 minimalist refinement removes the enclosing card, decorative heading icon, large serif introduction and redundant field instruction. A bottom divider separates the form from the graph. The textarea remains resizable, starts at 48px high, and uses 16px text; controls and example-question targets remain at least 44px high. Example questions retain their existing behavior inside a native disclosure. The source note is shortened to “From shared stories, with sources.” The answer, citation and request logic is unchanged.

Scope follows the user's 2026-09-20 authorization: shared household collection, the member's approved contributions, and patient words only with valid share-confirmation and current dashboard access. Unshared call words remain excluded. Answers and conversation ideas are ephemeral and cannot create memories or initiate calls. These are access and service requirements; frontend source inspection alone does not establish their enforcement.

## Verification and limits

For the minimalist refinement, TypeScript, all 15 family graph query tests, the language lint and stylesheet parsing passed. The supplied screenshot established the previous visual state; no browser was available for a rendered check of the revised desktop or mobile layout.

Documentation was checked against `PRODUCT.md`, `DESIGN.md`, this direction contract, the component, its stylesheet, Circle's actual stylesheet, and its mounting point. Source inspection confirms the native labels and disclosures, status/alert roles, keyboard-operable actions, focus handling, wrapping rules and responsive declarations described above. This is not a rendered accessibility or visual signoff: the browser runtime reported no available browser, so desktop/mobile screenshots, measured layout, zoom behavior and live keyboard interaction could not be checked.

The integration verification report records `npm run check` passing all 646 tests with zero language-lint findings and existing placeholder-fixture warnings. The production build passed before the final textarea change from disabled to read-only; that final prop change was rechecked in source. A live Muse Spark check using fictional content returned a cited answer, a source and a conversation idea. One detector pass over the two new UI files reported only radius/type-ramp advisories against the stale global design specification (14px radius; 12/13/15/24/25px text). The independent source-based finish reviewer gave a ship disposition after the confirmation-chain and revision-invalidation security fixes; this does not imply browser visual signoff.

Existing documentation drift is preserved: `DESIGN.md` describes Atkinson-only headings, different shared color values and larger controls, while current Circle uses Georgia headings, local palette overrides and denser controls. `PRODUCT.md` still describes access-key sign-in, contributor-only collections and redirect-only questions, predating the authorized shared-collection and graph-question scope. Neither `DESIGN.md` nor `.impeccable/design.json` was rewritten for this local extension; the current Circle implementation is the visual reference for this surface.
