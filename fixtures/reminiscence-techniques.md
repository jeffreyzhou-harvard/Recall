# Relay — reminiscence technique & question-bank reference

Companion to `fixtures/call-persona.md`. That document is the voice and the hard rules. This document is the material: what actual reminiscence-therapy facilitators are trained to do, and a curated bank of topic prompts. The live model is fed the operational prompt from `lib/script/persona.ts` plus matching rows from `fixtures/question-bank.json`. The judged path still speaks only `call-script.json`.

**Everything here is subordinate to `AGENTS.md`.** Where a real facilitator technique below conflicts with a non-negotiable rule (e.g., real training material uses "Do you remember...?" constantly — Relay never does), the AGENTS.md rule wins and the example has been rewritten to comply. That rewriting is flagged, not hidden.

**Source key**, so you can tell what's a citable finding vs. our own adaptation:
- **[R]** — directly reflects what the cited source says facilitators are trained to do.
- **[A]** — adapted from a real source but reworded to fit Relay's rules (usually: closed question → open invitation, "do you remember" → declarative, or a longer sentence → single-clause).
- **[G]** — a genuine gap in the published literature (no source addresses this); what follows is our own design judgment, not a citation.

---

## 1. How this document gets used

This is not a script to read verbatim. It's the example set and technique guide that shapes how the model:
- opens a topic (rung 1),
- builds a context or association cue (rungs 2-3),
- and generally sounds like it knows what it's doing, conversationally, beyond the fixed lines in `call-script.json`.

For the **judged path** (§9 of AGENTS.md), the fixed prerecorded branches and `call-script.json` still govern — nothing here overrides that. This document matters most for the **live side-demo model** and for **building the topic-specific cue banks** that feed `select_scaffold`/`render_prompt` (tools 6-7) and `get_next_recall_topic` (tool 1). See §4 for exactly how to wire it in technically.

## 2. Facilitator technique, distilled

Four things trained reminiscence facilitators are taught that matter directly for how Relay should behave:

### 2.1 Never correct. Ever.
**[R]** Two independent training sources say this almost word for word: "It doesn't matter if people don't remember correctly, the process is the most important part," and "by telling and retelling memories the detail may subtly change and that is acceptable." A common ground rule stated to participants up front: "Can we agree not to interrupt others or correct them?" This is already rule in `RELAY_CALL_PERSONA.md` (§2, "never correct or argue") — this is the evidence it's built on, not just good manners. **[G]** No source addresses what to do when the drift is safety-relevant (e.g., she says she drove somewhere) — that's out of scope for reminiscence literature and is handled instead by AGENTS.md rule 15 (safety phrases), which is a separate, lexical, non-conversational mechanism.

### 2.2 Name the feeling, don't redirect from it.
**[R]** The taught response to tears or distress is not to change the subject — it's to say the feeling out loud and give space. Verbatim training example: "It sounds as though you are feeling very sad as you recall this." Facilitators are told tears aren't a sign of harm done — "recall may bring distress [but] it may also bring relief" — and never to force a reluctant participant to continue.
**[A]**, rewritten, and then refused for speech: training material names the feeling out loud. Relay never does (rule 4: no inferred emotional state). If she asks to stop, close. Do not name a mood, and do not put feeling-naming lines in `question-bank.json`.
**[G]**: no source gives a rule for when to end a topic vs. continue after acknowledging distress — her asking to stop ends the call (rule 12). That is Relay's own design call, not a citation.

### 2.3 Open questions, asked one at a time, with real silence after.
**[R]** Training materials give this exact contrast as the model example: closed — "Did you go to school in Belfast?" → "No." vs. open — "Tell me what you remember about your school" → "Well I remember the big red brick building..." Facilitators are explicitly told not to "barrage" with multiple questions, and to let silence sit rather than rushing to fill it. This is already `RELAY_CALL_PERSONA.md`'s "one question per turn" and graduated-silence rule — same evidence base.

### 2.4 Props and sensory detail deepen a memory; they don't replace the verbal opener.
**[R]** The taught pattern is verbal invitation first, sensory/prop cue as an optional follow-up deepening move ("what do you smell, hear, see, feel?"), not a prop-first opener. For a phone call with no physical prop available, the transferable piece is the *sensory follow-up question* — asking about a sensory detail of a memory she's already started sharing, as a way to deepen it, never as the opening move.
**[A]** example: after she mentions Cape May, a sensory deepening follow-up — "What do you remember it smelled like there?" — used only after she's already engaged with the topic, never as rung 1.

### 2.5 No numeric rule exists for "how many tries before moving on."
**[G]** This is a confirmed, explicit gap: multiple training sources were checked and none give a count. It's facilitator judgment, driven by engagement signals (flat or repeated "I don't know" answers, silence, or a topic refusal), not a fixed number. Relay's ladder already substitutes a structural rule for this (climb one rung per attempt, never repeat a failed rung, stop after rung 4 or 5 per §6.1) — that structure is Relay's own design answer to a gap the literature leaves open, not something the literature itself specifies.

## 3. The question bank

Organized by topic category, matching the taxonomy that recurs across every source checked (Haight's structured life review, the RYCT/REMCARE program, and multiple independent UK/Canada practitioner manuals all converge on nearly the same category set). Each entry gives: the category (for retrieval tagging), a Relay-style rung-1 declarative invitation **[A]**, one or two rung-2/3 style follow-ups, and where it's drawn from.

Every opener below has been rewritten from its source phrasing to comply with AGENTS.md: no "Do you remember...?", no bare identification questions ("Who is...?"), declarative invitation or gentle statement + open question instead.

### Childhood, home & family of origin
Sources: Haight LREF stage 1 (childhood/family/home); Age NI manual; Dementia UK "early life."
- **[A]** "I'd love to hear about the house you grew up in. What comes to mind?" *(source: Haight LREF childhood stage, Dementia UK "early life")*
- **[A]** "Tell me about your family when you were little." *(source: Age NI manual, "Family & Relationships" domain, adapted from closed original)*
- **[A]** follow-up once she's shared something: "What was it like living there?"

### School days
Sources: Age NI manual (verbatim: "Tell me what you remember about your school"); RYCT/REMCARE ("schooldays" theme).
- **[R]** "Tell me what you remember about your school." *(this one is close to verbatim — the Age NI manual's own example open question, already compliant with Relay's style)*
- **[A]** "I'd love to hear about your school days." *(alternate opener, same source)*

### Work, career & working life
Sources: Age NI manual (verbatim examples: "How did you find the job?", "Did they have to leave home to find work?"); Haight LREF adulthood stage; RYCT "working life" theme; Dementia UK "working life."
- **[A]** "I'd love to hear about your first job." *(rewritten from Age NI's closed originals into an open invitation)*
- **[A]** follow-up: "How did you find the job?" *(this specific line is close to verbatim from Age NI and is already open-ended)*
- **[A]** "Tell me about the people you worked with."

### Courtship, romance & marriage
Sources: Age NI manual (verbatim: "Where you met?", "How long did you know each other before getting married?", "Can you describe your wedding outfit?"); Haight LREF adulthood stage; Alzheimer Society BC ("What was your wedding like?", "What attracted you to your husband/wife?").
- **[A]** "I'd love to hear about how you and [name] met." *(rewritten from the Age NI closed original)*
- **[A]** "Tell me about your wedding day."
- **[A]** follow-up, sensory deepening: "What do you remember about what you wore?" *(from Age NI's wedding-outfit prompt)*

### Parenting & children
Sources: PositivePsychology structured-review guide; implied in Haight adulthood stage; Dementia UK relationship sections.
- **[A]** "I'd love to hear about when [child's name] was little."
- **[A]** "Tell me about a favorite memory with your kids."

### Places lived, visited & hometown
Sources: "This Is Me" / Dementia UK ("places that matter to me"); Age Exchange Dice Game ("My Town"); Alzheimer Society BC ("What is your favourite place to visit?").
- **[A]** "I'd love to hear about [place]. What comes to mind?" *(this is the golden-path Cape May opener's own template, generalized)*
- **[A]** "Tell me about the town where you grew up."

### Holidays, traditions & travel
Sources: Age NI manual (verbatim: "Where did you go? Who did you go with? How did you get there? What smells would bring you back there?"); Age Exchange Dice Game ("Holidays"); Alzheimer Society BC ("favourite vacation," "holiday tradition").
- **[A]** "I'd love to hear about a trip you took that you loved." *(rewritten from the Age NI closed original)*
- **[R]** follow-up, sensory: "What smells would bring you back there?" *(close to verbatim from Age NI — already an open sensory prompt, used here only as a deepening follow-up per §2.4, never as an opener)*

### Food, cooking & home life
Sources: Age Exchange Dice Game ("Food" — cooking/recipes/shopping); Alzheimer Society BC "shared experience" prompts (bikes, car repairs, family cooking).
- **[A]** "I'd love to hear about a meal your family used to make together."
- **[A]** "Tell me about your kitchen growing up."

### Music, entertainment & hobbies
Sources: Age Exchange Dice Game ("Cinema," "Theatres/Concerts"); Dementia UK preferences section (music genres, favorite artists, instruments); Alzheimer Society BC ("What kind of music do you enjoy? Did you play an instrument?").
- **[A]** "I'd love to hear about the music you used to listen to."
- **[A]** "Tell me about a show or a film you loved."

### Community, town & historical context
Sources: Age NI manual ("Historical Context" domain — wartime/rationing/neighborhood); Age Exchange Dice Game ("My Town," era-based themes).
- **[A]** "I'd love to hear what your neighborhood was like back then."

### Relationships & people (person-topic, opt-in only per AGENTS.md §6.1)
Sources: "This Is Me" / Dementia UK relationship sections; the golden-path's own Maya opener.
- **[A]** "I'd love to hear about Maya." *(this is the exact wording AGENTS.md §6.1 specifies as the compliant version of a person-topic opener — never "Who is Maya?")*

### Later life & present-day
Sources: Dementia UK "later life" section; Haight LREF summary/evaluation stage (closing integrative questions).
- **[A]** "Tell me what a good day looks like for you now."
- **[A]** integrative/meaning question, adapted from Haight/Maercker's verbatim closing questions ("What have you learned in life?", "What would you describe as the three most important things in your life?"): "I'd love to hear what matters most to you these days."

**On the integrative/"meaning" questions specifically:** Haight's structured protocol ends its multi-session arc with explicit meaning-making questions. Those are real and citable, but they're written for a clinician running a scheduled closing session, not a warm phone call — use the softened version above, and don't lean on this category often; it's the heaviest one in the bank.

## 4. Making this actually work in a hackathon build — plain version

You asked whether the model could be trained on these questions until it "finds a pattern." Short answer: **don't fine-tune, and you don't need to.** Here's why, and what to do instead.

**Fine-tuning** means retraining the model's weights on your question bank. It's the wrong tool here for a practical reason, not a cop-out: it needs a properly formatted training dataset, a training run, and evaluation/iteration cycles — each of those alone can eat hours, and most APIs you'd use in a hackathon either don't expose general fine-tuning or need turnaround measured in more than a day. On top of that, your question bank (tens of examples, not thousands) is exactly the wrong size for training — too small to train reliably, but plenty for the next option.

**Few-shot prompting** is the right tool, and it's exactly what §3 above is for. You put a curated set of your best examples — 15 to 30, spanning categories — directly in the model's system prompt, and it picks up the pattern (the tone, the structure, the "invitation not interrogation" style) and generates new ones in the same style for topics not explicitly in the bank. This is a standard, well-documented technique (it's literally called "in-context learning"), and research on it (Min et al., 2022) found something reassuring for a hand-written hackathon dataset: what matters most is that your examples are *consistent in format*, not that there are a lot of them or that they're perfectly curated. Keep every example in §3 in the same shape (a declarative opener + optional follow-up) and the model will generalize the pattern reliably.

**One lightweight addition worth the extra hour: category-tag retrieval.** Rather than stuffing every example from §3 into every prompt, tag each one by category (already done above — "Childhood," "Work," "Holidays," etc.) and, at runtime, pull only the 5-10 examples matching whatever topic `get_next_recall_topic` selected into that specific prompt. This is retrieval-augmented generation (RAG) in its simplest form — plain keyword/category-tag matching against a JSON file, not a vector database or embeddings. That's a deliberate simplification: your question bank is small (tens of items), and at that size, embeddings buy you almost nothing over a tag lookup, while costing real setup time you don't have. A JSON file of `{category, opener, followups, source}` objects and a `topic → category` lookup is enough; this can realistically be built in under an hour.

**Put together:** keep a static core few-shot set always in the system prompt (10-15 examples covering the most common categories, so the model's baseline tone is anchored even before retrieval runs), and layer the category-matched retrieval on top for whatever topic is live in a given call. That hybrid is the most robust option for the time you have, and it's consistent with how recent published prototypes in this exact space (reminiscence-therapy AI agents) are built — none of the ones found in this research round report fine-tuning as their technique; the field has converged on generative/prompted approaches for the same reasons above.

**What this doesn't replace:** the fixed, tested lines in `call-script.json` for the judged path (rule 7/§8/§9 of AGENTS.md) — those stay hard-coded and deterministic, no model generation involved, for reliability under judging. This few-shot + retrieval setup is for the live side-demo model and for pre-generating a larger topic-specific cue library ahead of time (which you can then hand-review before it ever gets fixed into script form) — not for live, unreviewed generation inside the judged 90 seconds.

## 5. What's still a genuine gap

Carried over honestly rather than smoothed over:
- **[G]** No source gives per-stage/per-category question item lists at the granularity of "exactly what's asked under childhood, sub-item by sub-item" for Haight's LREF specifically — the primary instrument PDF wasn't machine-readable in this research pass. The category-level structure above is solid; the exact clinical instrument wording within each stage isn't fully reproduced.
- **[G]** No source addresses sequencing by emotional risk (e.g., "do childhood before loss/illness") as an explicit rule — only the byproduct of chronological ordering naturally front-loading lower-risk content. Relay's category set above is not risk-tiered; treat health/loss-adjacent topics (not included in §3's bank at all, deliberately) as ones to introduce only from a family-contributed or explicitly-set-up source, never generated speculatively.
- **[G]** No source benchmarks how many few-shot examples are actually needed for *this* task (question-style generation specifically, as opposed to classification tasks the "3/5/10-shot" guidance comes from). Treat 15-30 as a starting point to test during the build, not a validated number.
