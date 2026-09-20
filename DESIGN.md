---
name: Recall
description: Familiar conversations with quiet, legible controls.
colors:
  ink: "#242c28"
  background: "#fafaf7"
  muted: "#535e57"
  soft: "#e9ece6"
  rule-accent: "#c6cec5"
  tint: "#f0f2ec"
  focus: "#354f43"
  line: "#bdc5bd"
  clay: "#98513f"
  dark-background: "#18201c"
  dark-ink: "#f5f6f2"
  dark-muted: "#cdd5cd"
  dark-tint: "#27332b"
  dark-line: "#7c8d80"
  dark-focus: "#d0dbcf"
  dark-clay: "#dca38f"
typography:
  display:
    fontFamily: "Atkinson Hyperlegible Next, Atkinson Hyperlegible, sans-serif"
    fontSize: "42px"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Atkinson Hyperlegible Next, Atkinson Hyperlegible, sans-serif"
    fontSize: "clamp(38px, 6vw, 54px)"
    fontWeight: 750
    lineHeight: 1.12
  cue:
    fontFamily: "Atkinson Hyperlegible Next, Atkinson Hyperlegible, sans-serif"
    fontSize: "2rem"
    fontWeight: 500
    lineHeight: 1.3
  question:
    fontFamily: "Atkinson Hyperlegible Next, Atkinson Hyperlegible, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "Atkinson Hyperlegible Next, Atkinson Hyperlegible, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Atkinson Hyperlegible Next, Atkinson Hyperlegible, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  field: "6px"
  photo: "8px"
  action: "12px"
spacing:
  tight: "8px"
  small: "12px"
  regular: "18px"
  inset: "24px"
  wide: "32px"
  section: "40px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.background}"
    rounded: "{rounded.action}"
    padding: "18px"
  button-secondary:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    rounded: "{rounded.action}"
    padding: "18px"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "10px 12px"
  suggestion-panel:
    backgroundColor: "{colors.tint}"
    textColor: "{colors.ink}"
    rounded: "{rounded.action}"
    padding: "24px"
---

# Design System: Recall

## Overview

**Creative North Star: "A familiar photograph, one spoken thought"**

Recall uses warm neutral surfaces, dark readable words and quiet controls. The exact self-hosted Atkinson Hyperlegible Next family carries both identity and reading. Familiar imagery remains still; literal words and decisions receive clear space.

This system describes the frontend boilerplate at `/`, `/caregiver` (also `/family`), `/onboarding` and `/revisit`, as shipped in `app/recall.css` and `components/recall`. It does not describe backend integration or legacy operator/demo surfaces. The approved `BRAND_BOOK.md` preserves the quiet palette and adds the small clay connected-path identity on every surface, including the patient screen. Source evidence includes the current phone, caregiver bookshelf, setup and revisit components; the surface contracts are `.impeccable/surfaces/recall-phone.md` and `.impeccable/surfaces/caregiver-waveform.md`.

**Key Characteristics:**

- Quiet warm neutrals and flat surfaces.
- One exact font family with generous patient text.
- Familiar photographs separate from captions.
- Equal visual weight for consent choices.

## Colors

A restrained, slightly green neutral palette separates text, paper and boundaries without grading people or calls.

### Primary

- **Ink** is the text and filled-action color.
- **Clay** connects the five-node logo and marks the selected date on the caregiver timeline. It never grades a call.
- **Focus** is a functional keyboard outline and native input accent, not a decorative highlight.

### Neutral

- **Background** is the warm page and field surface.
- **Muted** carries supporting copy, dates and secondary labels.
- **Tint** separates the caregiver suggestion panel and upload areas, and highlights topic rows on hover.
- **Soft** distinguishes the selected setup marker.
- **Line** divides sections and outlines quiet containers.
- **Rule accent** remains an incumbent quotation-rule token; the current caregiver surface uses Line for its dividers.

**The Quiet Color Rule.** Use neutral differences and explicit labels; never use good/bad color to grade call records.

The caregiver's existing dark-background option overrides background, ink, muted, tint, line and focus in the stylesheet. The default neutral palette above is the normative identity; the opt-in dark variant is an accessibility setting, not a second brand palette.

## Typography

**Display Font:** Atkinson Hyperlegible Next, with Atkinson Hyperlegible and sans-serif fallbacks.
**Body Font:** The same family. The bundled variable WOFF2 declares weights 100–900 with `font-display: swap`; retain its OFL license.

The open letterforms and restrained weight changes keep words recognizable. No separate decorative display face is used.

### Hierarchy

- **Display:** caregiver page title, reduced to 36px at 600px and below. Caregiver section headings use 27px / 650 / 1.2; topic names use 23px / 600, and selected session titles use 32px / 600 / 1.2. The actual caregiver heading remains 42px, below the brand book’s proposed 44–64px range; this refresh records the implementation without changing it.
- **Headline:** setup page titles; smaller responsive scale.
- **Cue:** the current literal caption or confirmed words. Photo captions use a compact line height; quoted words use 1.36.
- **Question:** the separate remember/share decision.
- **Body:** caregiver prose; patient supporting copy is larger (24px).
- **Label:** caregiver metadata and secondary links; patient speaker labels remain 24px.

Larger text changes cues to 2.5rem and body to 1.5rem. Counts use lining tabular numerals; ordinary prose uses proportional numerals. The 14px preview disclaimer is outside the patient conversation hierarchy.

**The Exact Typeface Rule.** Keep the self-hosted Atkinson Hyperlegible Next face throughout Recall surfaces.

## Layout

The patient column is at most 560px wide; caregiver content is at most 1080px, and setup at most 840px. Patient gutters are generally 24px. At 700px and above, patient sections gain 40px gutters. Active calls reserve space for the header and actions while the current-words section can scroll; the active frame has a 620px minimum height.

The caregiver bookshelf spans the content width above a selected-session receipt and suggestion area. That area pairs a 1.7fr receipt column with a suggestion column of at least 280px, separated by 40px. At 800px and below it stacks with a 28px gap. Main padding is 32px, changing to 28px vertically and 24px horizontally at 600px. The shelf stays horizontally scrollable at every breakpoint. Fully open covers measure 232px by 368px in 64px scroll slots, reducing to 216px by 330px in 58px slots at 600px; the book depth is 36px. Larger text increases cover height to 390px. Reduced motion spaces flat covers by their full width plus 32px. Topic summaries wrap into two text rows beside their disclosure icon, and expanded counts become paired label/value rows at that same breakpoint. Setup forms and review rows stack at 600px. Phone setup uses four compact step labels in one row. Photo selections use three columns, falling to two on mobile. Outside the caregiver topic disclosures, call counts use three columns and become paired label/value rows at 380px and below. Recurring gaps and insets are recorded in the frontmatter; the implementation does not force every measurement onto one scale.

## Elevation & Depth

Page surfaces are flat. Tone, whitespace and thin rules separate regions. The caregiver session navigator uses geometric depth: neutral covers, spines and backs rotate within 1100px perspective. This scoped bookshelf treatment adds no visible shadow. Legacy offset-shadow declarations in the Recall stylesheet resolve to transparent and provide no visible elevation.

**The Flat Surface Rule.** Keep surfaces free of elevated shadows. The timeline marker’s one-pixel clay ring is a functional outline, not elevation.

## Shapes

Actions have softly rounded corners; fields use smaller curves. Photographs and the caregiver suggestion panel have modest rounding. Caregiver observation and topic rows use straight, solid dividers. Upload areas use dashed boundaries to indicate file selection; a dashed rule separates a topic’s fixed comparison from its counts. These line styles communicate function, not decoration.

## Components

### Connected-path identity

The shared header uses five square nodes on a three-by-three grid with a clay orthogonal path from bottom-left through center to top-right. Its endpoint is clay; the other nodes follow Ink. The static mark is 32px square, separated from the 28px / 650 wordmark by 12px. Patient, caregiver, setup and web preview use the same color treatment. The waveform is a data graphic, never the logo.

### Buttons

Large, direct and readable. Primary buttons use ink on the warm background in reverse; secondary buttons retain the background and ink outline. Main buttons are at least 76px tall with 26px semibold type. Confirmation buttons reduce to 64px and 24px type. Hover changes only the fill; background transitions last 120ms with ease-out. Keyboard focus uses a 3px outline offset by 5px. Disabled setup actions use 0.65 opacity. Caregiver actions use a compact variant: at least 50px tall, 19px / 600 text, 12px 16px padding, a 1px border and 8px corners. Their hover changes the fill; focus retains the same visible outline.

**The Equal Choice Rule.** Remember/share Yes and No use identical secondary styling and equal columns. End call is a separate underlined action.

### Inputs / Fields

Text inputs have a 2px ink border, the field radius, a 54px minimum height and 22px text. Checkbox controls are 24px in setup, alongside explicit labels. File selection uses a dashed 2px boundary, tint fill and a visible focus-within outline. Mobile upload areas have a 180px minimum height. Imported selections remain individually selectable. The inline caregiver form uses 1px ink borders, 48px minimum fields, 19px text and 10px padding. Its labels are 18px / 600; fields are separated by 18px. Memory/question radio labels have 44px targets. Optional photo selection uses a dashed 1px border and a 56px minimum target.

### Navigation

Caregiver navigation uses underlined 18px text links with a 44px minimum target, a thin lower rule and wrapping gaps. Destinations are Recall sessions, Suggest a conversation and Setup; hover thickens the underline. Setup's current step adds weight and underline. The patient header presents the wordmark and familiar setup attribution; text and contrast settings live in caregiver UI. Prototype controls and navigation remain below and outside the patient screen. The caregiver surface omits the design-preview banner and prototype navigation; a small sample-data integration note remains below its content.

### Cards / Containers

The selected-session receipt uses an open surface separated by rules. The Weekly Note and topic details start in closed native disclosures. The suggestion panel uses tint, a thin line border, action-radius corners and 24px padding (22px on phones). Record topics use dividers and whitespace instead of repeated cards. Neutral counts retain explicit categories and context; no score, color verdict or concern ranking appears.

### Familiar photograph and current words

The Cape May conversation keeps one full, uncropped photograph above short portions of the literal line. The image uses natural height and contains no overlaid text. Punctuation-aware pages contain up to 12 words and appear complete, without word reveal. Each portion holds for at least 5.5 seconds; preview pause suspends advancement. The current portion is announced through a separate status region.

At remember/share, the photograph gives way to the exact quotation and question. This prioritizes the decision content. The generated image is labeled fictional preview media and is not graph evidence; its provenance is in `public/preview/SOURCES.md`.

### Session bookshelf and receipt

One book represents one dated call. Resting spines have varying heights that form a count waveform along a shared bottom baseline; the selected cover expands to full height to display its topic, date and compact count waveform. Cover titles use 27px / 650 / 1.15 (25px on phones), with 16px counts and 17px dates. Covers use Soft. Measured spines below four unaided calls use Soft with Ink lettering and a Muted boundary; four or more use Ink with Background lettering. Waveform bars use Ink. Unmeasured spines use Background with Ink lettering and a dashed border. Covers have Line borders, a thin inset rule and a narrow page edge. Two fine binding rules cross each spine at 12% and 88% of its height; these are book details, not data. Both resting spine height and the cover waveform encode the absolute number of unaided calls for that same topic within up to eight calls as of that date, with the denominator shown in the selected receipt. Fewer than three calls uses dashed, unmeasured marks. The waveform is an event-count navigator, not recorded audio or a cognition score.

Native horizontal scrolling turns the nearest cover continuously from its spine toward the reader, from a closed rotation of −90° to −8° at selection. Resting height scales by `(80 + 36 × unaided calls) / 368`; unmeasured spines use 0.37 scale. On desktop this yields 80–368px measured resting heights; smaller and larger text covers apply the same proportional scale. Opening interpolates that scale to 1 for legibility; accessible instructions explain that the open cover expands for reading; its size is not an additional count. Perspective and transform origins are both at the bottom center, keeping all bases aligned. Date lettering is inverse-scaled to remain readable. The scroll target stays fixed in layout while its visual child rotates, scales and shifts; there is no playhead. Selection is preserved by session ID when data changes. Previous/next controls have 44px targets; a Call n of n label gives position. Scroll snapping, touch, trackpad, mouse wheel, tapping and Arrow/Home/End keys select the same session; a polite status announces settled selection. Mouse wheel returns to page scrolling at the boundaries. Hover changes dark measured spines to Muted; keyboard focus outlines both spine and cover. A persistent two-symbol legend reads “More without a cue” and “Fewer than 3 calls,” followed by the same-topic, last-eight count definition. Underlined text topic filters sit separately above the shelf. The thin “Call dates” timeline positions its clay marker by elapsed calendar time between the first and last filtered sessions. It is a date indicator, not an interactive slider; previous/next and book keyboard controls provide navigation.

The receipt shows date, topic, observable support and dated counts, with no transcript or private words. Its heading uses 32px / 600 / 1.2, reducing to 28px on phones; supporting text uses 21px and counts 19px. Selection changes use a 180ms ease-out opacity fade. Reduced motion removes receipt animation and all book transforms, hides spines and backs, presents spaced flat covers, outlines the selected cover and makes programmatic scrolling immediate. The suggestion panel sits beside the receipt and stacks beneath it on smaller screens.

### Weekly note and topic disclosures

The Weekly Note opens beneath the receipt and names call topics only, followed by an invitation to call Susan. It exposes no patient quotations, including share-confirmed words, under the latest caregiver direction. Browse topic details opens the per-topic records. These outer disclosure summaries have 48px minimum targets. Nested topic summaries retain a 104px minimum, neutral counts and a rotating chevron. Hover adds tint; keyboard focus remains visible. The context statement stays above the bookshelf even when Show details hides the records. No-call and insufficient-history states use explicit text rather than invented peaks.

### Setup and selected sources

Phone-first setup groups fictional photos into familiar album disclosures, with a thumbnail, caption, independent checkbox and optional metadata details. The first album opens initially. Capture/digitization date and family-provided approximate year stay distinct; names and places retain contributor attribution. Contacts and occasions load unchecked. Joint review is cleared whenever selections change. After agreement, a closed source review shows only selected items. A separate sample launcher opens fictional scripts without placing a call. The sample library contains 12 photo records, eight contacts and 18 occasions; 96 historical call events exercise the caregiver archive. These quantities are fixtures, not visual tokens.

### Inline conversation suggestion

The tinted panel opens its form in place. Memory contributions and question requests have separate radio choices and contributor attribution. Fields, optional photo selection, a primary save action and an underlined cancel action follow vertically. Saved suggestions retain their own text and attribution in ruled rows with 44px remove controls. Status and validation text remain visible in the form’s reading order. This is a local frontend preview: it schedules no call, supplies no automatic patient answer and creates no graph fact. Susan’s discussion and sharing choices remain separate.

## Do's and Don'ts

### Do:

- **Do** keep patient captions, decisions and stopping controls visually distinct.
- **Do** preserve exact words and equal consent choices.
- **Do** keep patient photographs still, uncropped and free of text overlays. Setup and source-review thumbnails may crop to their fixed preview ratio.
- **Do** retain visible keyboard focus, generous targets and responsive vertical scrolling.
- **Do** label sample media and preserve source attribution.

### Don't:

- **Don't** restore bright accent fields, elevated shadows or decorative status dots; retain the small clay brand path and functional date marker.
- **Don't** substitute a serif or system display face for Atkinson Hyperlegible Next.
- **Don't** turn neutral topic counts into a score or color-coded verdict.
- **Don't** promote legacy demo styling or generated preview media into product evidence.
