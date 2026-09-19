## **Locked product design**

**Relay is a digital memory-retention system for people living with dementia.**

It has two fundamental pieces:

**1\. Build and preserve the person's memory model.**  
The person and the people who know them contribute memories while those memories are still accessible. They can do this through photos, voice, simple questions, and family contributions. Relay organizes this information into a provenance-backed memory graph: people, relationships, places, events, stories, preferences, and the evidence connecting them.

**2\. Use that model to help the person continue retrieving those memories.**  
Relay periodically engages the person through an ordinary **phone call**. A conversational agent uses the memory graph to choose personally meaningful memories to revisit and adapts how much help it gives: free recall first, then a contextual cue, then recognition when necessary. The objective is not to grade them. It is to repeatedly bring important parts of their own life back into use.

So your core loop is:

**CAPTURE → ORGANIZE → RETRIEVE → REINFORCE → LEARN → REPEAT**

Not:

**CAPTURE → simulate the person.**

That distinction should govern basically every design decision.

---

### **Component 1: Memory capture**

The onboarding shouldn't feel like:

> “Tell the AI everything about yourself so it can become you.”

It should feel like:

> **“What are the people and memories you never want to lose?”**

A family member can connect a photo library. Open-source vision clusters recurring faces and events; timestamps/location metadata provide candidate context.

But the AI doesn't decide:

> “This is Maya, Susan's daughter.”

It asks:

> “Who is this?”

Susan says:

> “That's Maya, my daughter.”

Now you have:

`Susan — mother of → Maya`

with:

`source: Susan · voice recording · Sept 19`

Maya can supplement:

> “This was at my wedding in New Jersey in 2008.”

Now:

`Maya → wedding → 2008 → New Jersey`

with a different provenance.

The graph can therefore reconcile contributions without pretending everything the model infers is true.

And questions naturally expand it:

`Who is Maya?`

→ daughter

→ `What do you remember doing together?`

→ “We went to Cape May every summer.”

→ Cape May node

→ `Who else went?`

→ Priya

→ another relationship

→ etc.

So the graph expands through **human memory**, not AI fabrication.

---

## **Component 2: The Recall Engine**

This is where the phone-call decision matters.

**Locked patient experience: a normal phone call.**

No Telegram.  
&nbsp;No dashboard they must navigate.  
&nbsp;No WebRTC interface as the primary experience.  
&nbsp;No knowledge graph visible to them.

Their phone rings.

> **Relay calling**

They answer.

> “Hi Susan. I wanted to revisit someone important to you today. Who is Maya?”

Susan answers.

If she knows:

> “She's my daughter.”

Great. Continue naturally.

If she struggles, Relay doesn't say **wrong**.

It moves down a support ladder:

**Free recall**

> “Who is Maya?”

↓

**Context**

> “She's someone in your family.”

↓

**Association**

> “You and Maya used to spend summers together at Cape May.”

↓

**Recognition**

> “Is Maya your sister or your daughter?”

↓

**Reorientation**

> “Maya is your daughter. You told me about your summers together at Cape May.”

Then perhaps:

> “What do you remember about those summers?”

That is much closer to the experience you want than a quiz app.

### **And this is where personalization actually matters.**

Relay can learn:

> Susan remembers Maya's identity immediately but struggles with dates.

> Photographs are particularly effective cues for Susan.

> Cape May reliably evokes Maya.

> Susan remembers her old workplace when prompted by coworkers rather than by the building.

So next time it can choose a more effective retrieval path.

The system isn't merely storing a graph.

It's learning the **routes through the graph that help Susan reach memories.**

That is technically more interesting too.

---

# **The graph should therefore have two layers**

You don't just want:

`Susan → daughter → Maya`

You want:

**Memory graph**

```
Susan
 ├── daughter → Maya
 │               ├── wedding → 2008
 │               └── summers → Cape May
 │
 ├── sister → Priya
 ├── worked at → Lincoln Elementary
 └── lived at → Princeton
```

plus a **retrieval layer**:

```
Maya
├── recalled unassisted: frequently
├── useful cue: Cape May
├── useful cue: family photograph #183
└── ineffective cue: wedding year
```

Now Relay learns **how to help this person remember**, rather than merely what they have told it.

That is a much stronger technical thesis.

---

## **Component 3 should exist, but I'd keep it secondary**

Your caregiver-facing tracking idea can work, but I'd be careful with its positioning.

I would **not** initially say:

> “Relay measures the rate at which your mother's dementia is deteriorating.”

That turns Relay from a memory-support product into a medical assessment system very quickly.

Instead:

### **Caregiver Insights**

Relay can transparently report observations:

> **Maya**  
> &nbsp;Recognized independently in 8/9 recent conversations.

> **Cape May**  
> &nbsp;Usually recalled after one contextual cue.

> **Lincoln Elementary**  
> &nbsp;Increasingly requires recognition prompts.

> **Recent change**  
> &nbsp;Susan required substantially more prompting across several familiar people this week.

You can show trends without declaring:

> “Dementia severity: 67%.”

That would violate your own philosophy.

And if there is an abrupt or meaningful change, the product can say something like:

> **We've noticed a change in Susan's responses compared with her usual pattern. Consider sharing this history with her caregiver or clinician.**

Actual cognitive assessment and diagnosis belong with validated instruments and clinicians; the Alzheimer's Association likewise treats cognitive screening as a step toward further clinical evaluation, not a standalone diagnosis.&nbsp;

So I'd phrase this feature as:

> **Relay creates a longitudinal record of memory retrieval patterns that families can choose to share with clinicians.**

Much safer and more credible than “AI detects medical deterioration.”

---

# **The humanity constraints become explicit product rules**

I would actually put these into the design spec.

**Relay remembers information so the person can keep remembering—not so Relay can replace the person.**

Therefore:

* Relay **never impersonates the person**.  
* Relay never generates first-person memories they did not provide.  
* There is no “chat with Susan” interface for relatives.  
* Family members are encouraged to call and speak with Susan themselves.  
* Family members can contribute memories but provenance remains visible.  
* AI-inferred relationships are never silently promoted to facts.  
* Recall sessions are supportive, not scored exams.  
* The patient-facing experience does not expose a “decline score.”  
* The patient or caregiver controls when recurring calls happen.  
* Stored voice is evidence/context, **not material for cloning the person's voice**.

And I would preserve your earlier Kitwood principle:

> **The AI should create reasons for humans to interact, not reasons to stop interacting.**

So if Maya wants to hear Susan's story about her wedding, Relay should **not answer Maya from the database**.

It can say:

> “Susan has talked about this before. Want to ask her about it?”

That is a huge philosophical differentiator from the increasingly common idea of building digital replicas of people.

---

# **Where the earlier family-decision feature fits**

Keep it.

It's just no longer the fundamental product.

The graph knows:

`Maya → daughter`  
&nbsp;`Anika → granddaughter`  
&nbsp;`Anika → wedding`

Maya can ask:

> “Can Relay ask Mom which sari Anika should wear?”

Relay calls Susan.

Now the same memory-support infrastructure creates **participation in current life**.

So you get two outputs from the same graph:

**Remember your life**

> “Who is Maya?”  
> &nbsp;“What do you remember about Cape May?”

and

**Stay part of life now**

> “Maya wants your opinion on Anika's wedding.”

That's beautiful because the system isn't preserving memories merely as museum pieces.

**It preserves the context necessary to remain connected to the people those memories are about.**

---

## **I would crystallize the pitch to this**

> **Relay helps people with dementia hold on to the people and moments that make up their lives. Families and patients gradually build a private memory graph from photographs, stories, relationships and everyday conversations. Relay then calls the person like an ordinary phone call and uses that graph to revisit important memories—starting with recall and providing progressively more context only when needed. Over time, it learns not just what matters to someone, but which cues help them reach those memories. Families can see longitudinal changes and contribute missing context, but Relay never speaks in the patient's name or becomes a digital copy of them. The goal is the opposite: use AI to preserve the context that makes continued human connection possible.**

And your cleanest one-line product description may now be:

> **Relay remembers with you, so the people you love stay familiar for longer.**

I would build everything else around that conception.

&nbsp;

&nbsp;