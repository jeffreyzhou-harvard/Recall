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
    fontSize: "clamp(36px, 5vw, 48px)"
    fontWeight: 650
    lineHeight: 1.13
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
  archive-title:
    fontFamily: "Atkinson Hyperlegible Next, Atkinson Hyperlegible, sans-serif"
    fontSize: "26px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.015em"
rounded:
  field: "6px"
  photo: "8px"
  collection: "18px"
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
    padding: "12px"
  suggestion-panel:
    backgroundColor: "{colors.tint}"
    textColor: "{colors.ink}"
    rounded: "{rounded.action}"
    padding: "24px"
---

# Design System: Recall

## Overview

**Creative North Star: "A familiar photograph, one spoken thought"**

Recall uses warm paper, dark readable words, quiet sage surfaces and a small clay connected path. Self-hosted Atkinson Hyperlegible Next carries identity and reading. The approved `BRAND_BOOK.md` remains the direction; this document records the current connected application rather than the retired scripted preview.

Source evidence: `app/caregiver.css`, `app/family-archive.css`, `app/archive-visualizations.css`, `components/archive`, `app/recall.css`, `app/globals.css`, `app/welcome.css`, `app/onboarding-live.css`, `components/live`, `RecallFrame` and `SessionBookshelf`. Welcome, access, household setup, invitations, caregiver records and patient web calls share the identity. The photo-led patient composition remains a brand target: the mounted live call currently displays prompts and audio status, without a photo or paginated captions. `/present` is a separate engine harness.

**Key Characteristics:**

- Warm neutral surfaces with restrained clay identity.
- One exact font family and generous actions.
- Explicit access, contribution and permission boundaries.
- Dated call counts without patient quotations or clinical grading.

## Colors

### Primary

Ink carries text and primary actions. Focus identifies keyboard focus and native selections. Clay connects the logo and marks the current date; it never grades a person or call.

### Neutral

Background is warm paper. Muted carries secondary text. Tint groups forms, notices and contribution panels. Soft fills book covers and light spines. Line separates sections; Rule accent is retained by the shared stylesheet. Essential inputs use Ink or Muted boundaries.

The dark token variants are opt-in reading preferences. Global Tailwind paper, ink, sage and coral values now match the shared brand palette; the historical coral name maps to Clay. Error panels use readable Ink on Tint in both preferences.

**The Quiet Color Rule.** Use neutral differences and explicit labels; never use good/bad color to grade call records.

## Typography

**Display Font:** Atkinson Hyperlegible Next, with Atkinson Hyperlegible and sans-serif fallbacks.
**Body Font:** The same self-hosted variable family, weights 100–900, `font-display: swap`; retain its OFL license.

Caregiver workspace headings use `clamp(36px, 3.3vw, 48px)`, weight 650, line-height 1.1 and tracking −.025em; they become 36px on phones. Moment card titles use Archive title; dialog headings use 36px / 650 / 1.15, becoming 32px on phones. Archive metadata is 17–18px and form text 20px. Live setup uses the Headline token; welcome and access use `clamp(36px, 6vw, 48px)`, weight 650 and line-height 1.15. Setup section headings are 27px / 600 / 1.25. Body text uses the shared 1.25rem size, enlarged to 1.5rem. Metadata generally uses 17–18px. The wordmark is 28px / 650.

The live patient prompt uses the existing revisit heading treatment (`clamp(38px, 10vw, 44px)`, 600 / 1.2), with supporting text at the shared 2rem cue size. Cue and question tokens remain shared CSS values; the former preview’s 12-word caption pagination and visual Yes/No choices are not mounted in the live audio flow. Counts use tabular numerals.

**The Exact Typeface Rule.** Keep self-hosted Atkinson Hyperlegible Next across Recall surfaces.

## Layout

The patient column is at most 560px. The caregiver workspace is at most 1920px with a sticky 224px rail, narrowing to 208px below 1200px. Its breadcrumb bar is at least 82px high; content uses 48px vertical padding and `clamp(24px, 3.5vw, 60px)` horizontal padding. Moments has two photo columns with 28px gaps, alongside a 290px contribution panel; that panel moves below the collection at 1200px. Below 760px the rail becomes a compact header with a native section picker, the breadcrumb bar disappears, content padding becomes 30px 20px, and cards stack in one column. The welcome shell is 840px with a 620px main column. Live setup is at most 720px, padded 24px 32px 64px; phone padding becomes 20px 24px 48px and 18px horizontally below 380px. Paired fields stack below 380px; review rows stack below 600px. Four setup steps retain a compact grid, with labels below numbered circles on phones.

The caregiver shelf spans the content width above a receipt and contribution area. Those columns stack at 800px. Open covers are 232 × 368px with 36px depth and 64px slots; below 600px they become 216 × 330px with 58px slots. Large text raises height to 390px. Reduced motion spaces flat covers by their width plus 32px. Keep the shelf’s horizontal scrolling inside the page.

## Elevation & Depth

Workspace surfaces are flat and separated by tone, whitespace and rules. Photographs have two scoped soft shadows: map pins use `0 3px 12px #18201c35`, and upload progress photos use `0 8px 18px rgb(0 0 0 / .15)`. These distinguish overlapping photographs, not a general elevated-card system. The bookshelf alone uses 1100px perspective. Legacy offset shadows resolve to transparent; they are not a design vocabulary. The date marker has a one-pixel clay ring, serving as a functional outline.

**The Flat Surface Rule.** Keep workspace panels flat; reserve depth for bookshelf geometry and the soft shadows of overlapping map/upload photographs.

## Shapes

Shared actions use 12px corners and inputs 6px; archive actions and fields use 8px, while photographic cards, collection panels and dialogs use 18px. Circular initials and photo nodes belong to the collection graph. Shared agreement and access-key panels use 8px corners. Book covers use asymmetric 3px/6px corners, a fine page edge and two spine binding rules. These details carry no data. The five-node mark uses square nodes and an orthogonal path.

## Components

### Connected-path identity

A static 32px mark precedes the 28px wordmark with a 12px gap. The caregiver rail enlarges both to 34px; its wordmark becomes 30px on phones. Five square nodes occupy the corners and center of a three-by-three grid. The path rises from bottom-left through center to top-right; path and endpoint use Clay, other nodes Ink. The same mark appears on patient, caregiver, setup, welcome and access surfaces. Waveforms remain count graphics, never logos.

### Buttons

Primary uses Ink with Background text, secondary Background with Ink border. Shared actions are at least 76px tall with 26px / 600 text; welcome actions are 72px / 24px, access actions 64px / 24px, setup actions 64px / 23px. Caregiver actions are at least 50px with 19px / 600 text. Hover changes fill in 120ms ease-out. Focus uses a 3px outline with 5px offset; disabled actions reduce opacity to .65. Underlined text actions retain generous targets.

### Inputs / Fields

Access keys use a password field, 60px minimum height, 2px Ink border, 12px padding and explicit helper/error associations. Live setup fields use 54px minimum height, 1.5px Ink borders and 12px padding. Labels remain visible. Setup checkboxes are 24px inside rows at least 52px high. Errors and status sit in the reading order on neutral tinted panels; no decorative alarm color is needed.

### Navigation and account entry

Welcome presents “I’m new here” and “Sign in.” New users choose joint setup or an invitation. Sign-in accepts existing private keys; it is not email/password registration. Existing accounts route by role. Caregiver rail navigation uses 52px rows, SVG icons and a paper selected surface with a fine border; below 760px it becomes a native section picker. Account actions expose reload and sign-out. The caregiver Text & contrast menu has been removed; shared preference styles remain available elsewhere. `/design/*` redirects to the application, without preview navigation.

### Cards / Containers

Receipt and topic rows use open surfaces and dividers. The contribution form uses Tint, a thin Line border, 12px corners and 24px padding. Weekly Note and topic records use native disclosures. Joint agreement and one-time key panels use restrained tinted containment; secrets are shown as selectable fields, not decorative cards.

### Patient call

The patient sees an AI identity line, current topic when available, and one current prompt or listening/playback status. Answer call requests microphone access; End call remains available while active. Store/share decisions occur through the backend’s spoken confirmation sequence and original-audio playback, not client-side Yes/No buttons. The current source includes neither the former default Susan conversation nor the generated familiar-photo preview. Do not document those retired components as shipped live behavior.

### Session bookshelf and receipt

One book represents one persisted dated topic call. Session metadata comes through `lib/family/session-summary`; no graph claims or personal words enter this projection. The server supplies the record window and minimum-history count. Resting scale is `(80 + clamp(unaided / recordWindow, 0, 1) × 288) / 368`; unmeasured scale is .37. With the default eight-call window this is 80px plus 36px per unaided call at desktop size. Spines below half the window are light, the remainder dark; insufficient history is dashed. Always retain the count denominator. The cover expands for reading, not extra quantitative meaning.

Native scrolling rotates the nearest cover from −90° toward −8°. Bottom-centered transforms preserve the baseline. Cached geometry and frame updates touch the visible band only. Touch, wheel, clicking, previous/next and Arrow/Home/End select the same record; wheel returns to page scrolling at boundaries. Topic filters are separate underlined text controls. A noninteractive date timeline places its Clay marker by elapsed calendar time. Two legend symbols describe taller counts and insufficient history, using server-supplied thresholds.

The receipt contains date, topic, a fixed observable support line and dated counts. Heading is 32px / 600 / 1.2, or 28px on phones. A 180ms opacity fade accompanies selection. Reduced motion flattens covers, hides spines and backs, removes the fade and navigates immediately. Empty and insufficient-history states remain explicit.

### Weekly note and contribution

The live Weekly Note omits `share` lines, including share-confirmed patient quotations, under the user’s count-only direction. Other allowed note lines and a direct-call invitation remain. Per-topic records and exports depend on authorized access. Safety alerts use their fixed text in a separate area.

“Share a memory” opens the real contribution form. Who, remembered account and optional when/where remain attributed to the contributor. JPEG/PNG photos and WAV voice notes upload to private backend media; voice recording is explicit. Questions are rejected by the backend with a direct-call invitation. Saving does not schedule a call. Family settings connects the existing invitation, contact and calendar import flows; there is no local question-request queue.

### Contributor collection

Moments, Places, Connections and Stories render the current contributor’s own collection; Recall sessions remains a separate destination. Photo cards crop covers to 4:3, retain date/place/attribution labels and open a detail drawer. Stories preserve original wording and optional original audio. Search filters collection labels, not patient memories. Collection labels and historical map pins do not rewrite call evidence.

Places uses a muted MapLibre/OpenStreetMap basemap, original-photo pins, accessible controls and explicit unpinned/failed-map states. Connections uses a dotted canvas, circular photos, family initials and curved named relationships. It pages four moments at a time; story nodes appear for a selected moment or in the Stories filter. Its labels express contributor-named connections, never inferred patient state. Do not encode evolving graph coordinates as global layout rules.

Upload dialogs are at most 720px wide; detail drawers at most 650px, attached to the right edge. The backdrop locks page scroll; focus is contained and returned, and Escape dismisses unless a save is busy. Photos use a native multiple-file input and a drop target. Mobile fields stack, previews change from four columns to three, and the drawer loses its corner radius. Reduced motion removes photo-orbit and graph animations and immediate map movement replaces animated travel. The contribution form remains mounted when changing destinations so its draft survives.

## Do's and Don'ts

### Do:

- **Do** preserve source attribution, visible access states and separate spoken confirmation gates.
- **Do** keep neutral counts paired with their denominator and date.
- **Do** keep the clay path consistent across all shared headers.
- **Do** retain visible keyboard focus, reduced-motion alternatives and readable dark preferences.

### Don't:

- **Don't** present fixture identities, sample history or generated images as a live household.
- **Don't** turn counts into clinical scores or expose patient quotations in this caregiver frontend.
- **Don't** restore bright accent fields, elevated workspace cards or a competing waveform logo.
- **Don't** describe planned photo-led calls, automatic photo metadata import or generated stories as implemented live features.
