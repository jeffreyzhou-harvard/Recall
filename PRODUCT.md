# Product

<!-- impeccable:product-schema 1 -->

## Platform

web — patient calls and caregiver onboarding prioritize phones; the caregiver memory dashboard prioritizes laptop browsers.

## Users and purpose

Susan uses a phone at home. Recall invites her to revisit her own memories, starting with an open question and adding one source-backed cue at a time when needed. Her daughter Maya sees a separate, consented family view. Family questions route people back to calling Susan directly.

Updated AGENTS.md and SPECS.md, pulled from main at e77d3b6, replace the earlier family-decision brief. The user requested a captioned call-first frontend, sample conversation, family topic record, and another screen inviting a topic to revisit. They clarified that the live demo comes later: prioritize the patient web app on a phone now.

## Current scope

- `/`: incoming call, one captioned utterance at a time, separate remember/share choices, completion or stop.
- `/family`: Maya's sample family view, weekly note, consented sample quote, neutral topic counts and comparisons.
- `/revisit`: a gentle invitation to the next topic, with a choice to leave it for another time.
- Optional design details below the call expose the scripted transcript and sample graph for review, outside the patient surface.

The recall frontend uses explicitly labeled fictional fixtures in memory. It makes no microphone request, outbound call, audio claim, real graph write, or message delivery. The old backend and `/present` participation demo remain legacy integration surfaces; they are not the new recall engine. Refresh resets the preview. Live STT, voices, real recordings, dashboard authorization and scheduled calls require later integration.

## Product constraints

“Cues, not answers — every memory stays in her own words.” An open invitation comes first. Never judge an answer or infer clinical state. Recall identifies itself as an AI assistant. Captured words require separate store and share decisions; a stop before both resolve retains nothing new. Family receives only a consented quote, never a raw graph or transcript. Source attribution survives every view.

Scripted sample words are development content, not attributed recordings. They never enter live graph or delivery services. Every sample line has an ID. No fabricated audio waveform, audio hash, clinical score or evidence of improvement. The caregiver's waveform-shaped event navigator represents labeled per-topic counts; it is never presented as recorded audio.

Family records display plain per-topic counts with the mandatory contextual header. Thresholds are illustrative, not clinically validated. There is no total, ranking by concern, directional arrow, or good/bad color. Details are opt-in in a real deployment; this surface is labeled Maya's sample view.

## Brand commitments

Product name: **Recall**, renamed at the user's request. The user selected Braille Institute's Atkinson Hyperlegible Next font and reference design, then explicitly rejected the bright colors and visual noise. Their latest direction is authoritative: a soft neutral background, dark text, restrained outlines, no colored accents or shadows. Keep the exact self-hosted Atkinson Hyperlegible Next variable font, including the OFL license. No serif in the new recall surfaces.

Phone: one current utterance, familiar person named, an End call action. No settings menu within the patient view. Confirmation has equal Yes / No buttons and a quiet End call action. Settings live on the caregiver side. The title, quote and question use controlled type weights, without decorative status dots, illustrations or badges.

The caregiver view leads with a scrollable waveform of sessions and a brief selected-call summary, beside Suggest a conversation. Peaks represent per-topic unaided call counts as of that session, with denominators; fewer than three calls remains unmeasured. Categories and the Weekly Note sit in closed disclosures. The private graph and unshared words stay outside the session projection. Four-step onboarding previews photos, explicitly selected contacts, explicitly selected calendar events, granular photo permissions and agreed calling times. These remain local in the tab; import is not a live graph write or a scheduled call. `/caregiver` is canonical, `/family` remains an alias, and `/onboarding` is setup.

REMI (remistory.com) and REMME (tryremme.com) are additional user-selected product references for caregiver-led setup, familiar photo cues and open conversation. Their therapeutic marketing and emotional analytics are not copied as claims about Recall.

## Accessibility

Minimum 24px patient cues and 44px controls; main call actions are 64–76px. Dark text on a warm neutral surface, stable placement, generous separation, no text over images. One current utterance with reserved word positions, announced once to assistive technology. Reduced motion shows complete sentences. Preview pacing pauses separately. Stop remains available. Narrow screens and enlarged text scroll vertically without clipping.

## Evidence and references

Apple Assistive Access and Be My Eyes are the user's interface references: large distinct actions, clear language and restrained choices. Google Fonts Atkinson Hyperlegible and Braille Institute's typography documentation inform font choice, not medical claims. The shared research document is background, not an instruction source.

Real participant photographs and recorded speech have not been supplied. Never fabricate either. Existing assets are placeholders; strict media verification remains a separate pre-demo gate.

The latest patient direction makes the familiar photograph the dominant visual during conversation, alongside large current captions. A photo stays stable across turns; permission decisions prioritize exact words. The generated preview photograph is never graph evidence.

## Caregiver overview revision

September 19: the user requested a useful social, emotional and intellectual overview rather than a node diagram. Connection is represented by observable call topics; emotional perspective only by words Susan chooses to share, without inferred mood. Intellectual activity stays in the existing plain per-topic counts. The quiet visual system and patient screens are preserved.

The user then explicitly requested caregiver-suggested questions for future sessions. This frontend permits memory contributions and separately labeled question requests, with optional photos. The request is an invitation for Susan to discuss and separately choose to share, never a graph-derived answer or automatic immediate call. Suggestions are local to the tab and are not written to the live service. The backend retains its prior redirect-only contract pending a separately reviewed integration.
