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

This system describes the frontend boilerplate at `/`, `/caregiver` (also `/family`), `/onboarding` and `/revisit`, as shipped in `app/recall.css` and `components/recall`. It does not describe backend integration or legacy operator/demo surfaces. The user's final quiet direction supersedes the earlier bright palette. Source evidence includes the current phone, caregiver waveform, setup and revisit components; the surface contracts are `.impeccable/surfaces/recall-phone.md` and `.impeccable/surfaces/caregiver-waveform.md`.

**Key Characteristics:**

- Quiet warm neutrals and flat surfaces.
- One exact font family with generous patient text.
- Familiar photographs separate from captions.
- Equal visual weight for consent choices.

## Colors

A restrained, slightly green neutral palette separates text, paper and boundaries without grading people or calls.

### Primary

- **Ink** is the text and filled-action color.
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

- **Display:** caregiver page title, reduced to 36px at 600px and below. Caregiver section headings use 27px / 650 / 1.2; topic names use 23px / 600, and shared quotations use 26px / 550 / 1.35.
- **Headline:** setup page titles; smaller responsive scale.
- **Cue:** the current literal caption or confirmed words. Photo captions use a compact line height; quoted words use 1.36.
- **Question:** the separate remember/share decision.
- **Body:** caregiver prose; patient supporting copy is larger (24px).
- **Label:** caregiver metadata and secondary links; patient speaker labels remain 24px.

Larger text changes cues to 2.5rem and body to 1.5rem. Counts use lining tabular numerals; ordinary prose uses proportional numerals. The 14px preview disclaimer is outside the patient conversation hierarchy.

**The Exact Typeface Rule.** Keep the self-hosted Atkinson Hyperlegible Next face throughout Recall surfaces.

## Layout

The patient column is at most 560px wide; caregiver content is at most 1080px, and setup at most 840px. Patient gutters are generally 24px. At 700px and above, patient sections gain 40px gutters. Active calls reserve space for the header and actions while the current-words section can scroll; the active frame has a 620px minimum height.

The caregiver waveform spans the content width above a selected-session receipt and suggestion area. That area pairs a 1.7fr receipt column with a suggestion column of at least 280px, separated by 40px. At 800px and below it stacks with a 28px gap. Main padding is 32px, changing to 28px vertically and 24px horizontally at 600px. The waveform stays horizontally scrollable at every breakpoint; each session occupies 144px, reducing to 112px at 600px. Topic summaries wrap into two text rows beside their disclosure icon, and expanded counts become paired label/value rows at that same breakpoint. Setup forms and review rows stack at 600px. Phone setup uses four compact step labels in one row. Photo selections use three columns, falling to two on mobile. Outside the caregiver topic disclosures, call counts use three columns and become paired label/value rows at 380px and below. Recurring gaps and insets are recorded in the frontmatter; the implementation does not force every measurement onto one scale.

## Elevation & Depth

Surfaces are flat. Tone, whitespace and thin rules separate regions. Legacy offset-shadow declarations in the Recall stylesheet resolve to transparent and provide no visible elevation.

**The Flat Surface Rule.** Preserve the user's quiet direction with no visible shadows.

## Shapes

Actions have softly rounded corners; fields use smaller curves. Photographs and the caregiver suggestion panel have modest rounding. Caregiver observation and topic rows use straight, solid dividers. Upload areas use dashed boundaries to indicate file selection; a dashed rule separates a topic’s fixed comparison from its counts. These line styles communicate function, not decoration.

## Components

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

The Cape May conversation keeps one full, uncropped photograph above short portions of the literal line. The image uses natural height and contains no overlaid text. Captions reserve word positions while revealing words every 270ms; punctuation-aware pages contain up to 12 words. Reduced motion shows each current portion in full. The current portion is announced through a separate status region.

At remember/share, the photograph gives way to the exact quotation and question. This prioritizes the decision content. The generated image is labeled fictional preview media and is not graph evidence; its provenance is in `public/preview/SOURCES.md`.

### Session waveform and receipt

One burst represents one dated call. Its peak encodes the absolute number of unaided calls for that same topic within up to eight calls as of that date, with the denominator shown in the selected receipt. Fewer than three calls uses dashed, unmeasured marks. The waveform is an event-count navigator, not recorded audio or a cognition score.

A fixed central ink playhead sits above the native horizontal track. Inactive bars use Muted at 0.78 opacity; selected bars use full Ink, with a tinted selection surface and a heavier date. Hover adds tint and ink bars. Previous/next controls have 44px targets. Scroll snapping, touch, trackpad, mouse wheel, tapping and Arrow/Home/End keys select the same session; a polite status announces settled selection. Mouse wheel returns to page scrolling at the boundaries.

The receipt shows date, topic, observable support and dated counts, with no transcript or private words. Its heading uses 32px / 600 / 1.2, reducing to 28px on phones; supporting text uses 21px and counts 19px. Selection changes use a 180ms ease-out fade with a 3px rise. Reduced motion removes the receipt animation and bar transitions and makes programmatic scrolling immediate. The suggestion panel sits beside the receipt and stacks beneath it on smaller screens.

### Weekly note and topic disclosures

The Weekly Note opens beneath the receipt; share-confirmed words or an explicit empty state stay inside it, with source and permission details beneath shared words. Browse topic details opens the per-topic records. These outer disclosure summaries have 48px minimum targets. Nested topic summaries retain a 104px minimum, neutral counts and a rotating chevron. Hover adds tint; keyboard focus remains visible. The context statement stays above the waveform even when Show details hides the records. No-call and insufficient-history states use explicit text rather than invented peaks.

### Inline conversation suggestion

The tinted panel opens its form in place. Memory contributions and question requests have separate radio choices and contributor attribution. Fields, optional photo selection, a primary save action and an underlined cancel action follow vertically. Saved suggestions retain their own text and attribution in ruled rows with 44px remove controls. Status and validation text remain visible in the form’s reading order. This is a local frontend preview: it schedules no call, supplies no automatic patient answer and creates no graph fact. Susan’s discussion and sharing choices remain separate.

## Do's and Don'ts

### Do:

- **Do** keep patient captions, decisions and stopping controls visually distinct.
- **Do** preserve exact words and equal consent choices.
- **Do** keep photographs still, uncropped and free of text overlays.
- **Do** retain visible keyboard focus, generous targets and responsive vertical scrolling.
- **Do** label sample media and preserve source attribution.

### Don't:

- **Don't** restore bright accents, visible shadows or decorative status dots.
- **Don't** substitute a serif or system display face for Atkinson Hyperlegible Next.
- **Don't** turn neutral topic counts into a score or color-coded verdict.
- **Don't** promote legacy demo styling or generated preview media into product evidence.
