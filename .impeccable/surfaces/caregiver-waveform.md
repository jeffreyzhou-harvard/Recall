# Caregiver session waveform

Mode: Operate. September 19 refinement, based on the user's supplied waveform reference.

THESIS: A caregiver moves through a quiet thread of calls, stopping at one observable session summary. The waveform is a navigator, not a reconstruction of a person.

AUTHORITY: Preserve DESIGN.md's self-hosted Atkinson and quiet neutral palette. The user's supplied composition pins the waveform and fixed playhead; adapt it directly in code to the existing surface, with no concept roll or raster asset. The patient's screens are unchanged.

FORM: One broad waveform, a fixed central playhead, dates beneath, then the selected session beside Suggest a conversation. Categories recede into a closed detail disclosure, per the latest user steer. No ornamental cards or mood summaries.

DATA: One burst per fictional dated call. Peak height is the absolute count of unaided calls for that topic within its last eight calls as of that session. Always pair with its denominator. Fewer than three calls is unmeasured, never a low score. The supplied life-span/strongest-memory labels are inspiration only: no invented life chronology or clinical memory-strength claim. The user's request explicitly extends the earlier text-only presentation, while preserving its underlying event counts and privacy limits.

MOTION: The focal moment is native horizontal scrolling beneath a still playhead; the selected burst darkens and its summary changes with a short opacity transition. Touch/trackpad, wheel over the track, keyboard and previous/next controls all select the same session. No looping animation. Native scrolling plus one requestAnimationFrame read per scroll frame, React updates only on changed session, no network or animation dependency. Reduced motion uses immediate programmatic scrolling and no spatial summary transition. At the track's ends, vertical wheel returns to page scrolling.

RESPONSIVE: Desktop full-width wave with a two-column summary/contribution area. Phone keeps the wave horizontally scrollable and stacks the same content. All navigation targets at least 44px, labels readable, large text and dark theme inherited.

QUALITY BAR: Selecting a peak always shows the corresponding date, topic and fixed observable support line. No transcript, private words, emotional inference or global score enters this projection. Empty and insufficient-history states work. Validate desktop, phone, actual viewport, keyboard and scroll, finish review and document the shipped component.
