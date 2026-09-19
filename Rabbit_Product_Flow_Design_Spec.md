# Rabbit — product flow design spec

> **Product thesis:** Rabbit helps a person participate in one live, current family interaction. Access changes; authorship does not.

## Reference flow

```mermaid
flowchart LR
    subgraph FAMILY[Family's existing thread]
        A[Anika sends a current question<br/>plus up to one photo]
        B[Family receives Mom's<br/>verbatim voice contribution]
        C[Approved relative receives<br/>a non-clinical support receipt]
    end

    subgraph RABBIT[Rabbit web experience]
        D[Request intake<br/>Current ask · audience · artifacts]
        E[Live session view<br/>Call stage · cues · human-readable trace]
        F[Receipt and provenance<br/>Source · trims · assent · destination]
    end

    subgraph GATES[Enforced orchestration]
        G{Identity and<br/>audience verified?}
        H{Access policy<br/>permits this ask?}
        I[Query only permitted<br/>current evidence]
        J[Select least-helpful scaffold<br/>Repeat → asker → choices → cited cue]
        K[Capture exact contribution<br/>Silence/disfluency trims only]
        L{Mom assents to this exact<br/>artifact and audience?}
        M[Publish to the<br/>original thread]
    end

    subgraph CALL[Mom's ordinary phone]
        N[Rabbit explains<br/>who is asking and why]
        O[Mom asks for help<br/>or answers]
        P[Mom hears her exact<br/>recording played back]
        Q[Mom says<br/>yes · no · unclear]
    end

    subgraph GRAPH[Compact private context graph]
        R[Current ask and artifacts]
        S[Verified people and relationships]
        T[Source-backed family claims]
        U[Access policy and audience scope]
    end

    A --> D --> G
    G -- No --> X[Stop safely<br/>Ask family to clarify]
    G -- Yes --> H
    H -- No --> Y[No call placed]
    H -- Yes --> I
    R --> I
    S --> G
    T --> I
    U --> H
    I --> E --> N --> O
    O -- Thread is clear --> K
    O -- Asked for repeat / no answer --> J --> N
    J -. after two lost-thread signals .-> Z[Close kindly<br/>Neutral “not this time”]
    K --> P --> Q --> L
    L -- No / unclear --> W[Discard or hold<br/>Nothing is sent]
    L -- Yes; hash and audience match --> M --> B
    M --> F --> C

    classDef family fill:#F6F1E8,stroke:#18342F,color:#18342F,stroke-width:2px;
    classDef rabbit fill:#B9CEC3,stroke:#18342F,color:#18342F,stroke-width:2px;
    classDef gate fill:#FFF7E3,stroke:#D5A64A,color:#18342F,stroke-width:2px;
    classDef human fill:#FFF2EE,stroke:#E4775B,color:#18342F,stroke-width:2px;
    classDef graph fill:#EEF3F0,stroke:#648376,color:#18342F,stroke-width:1.5px;
    classDef stop fill:#FAECE8,stroke:#A44935,color:#6B2B20,stroke-width:1.5px;

    class A,B,C family;
    class D,E,F rabbit;
    class G,H,L gate;
    class I,J,K,M rabbit;
    class N,O,P,Q human;
    class R,S,T,U graph;
    class X,Y,Z,W stop;
```

## What each surface is for

| Surface | Primary user | Purpose | Must not become |
|---|---|---|---|
| Family thread | Anika / approved relatives | Forward one current ask; receive Mom's approved contribution | Bulk chat ingestion or autonomous outreach |
| Ordinary phone call | Mom | Hear the ask, receive the minimum needed cue, answer in her own words, approve delivery | Companion calls, memory tests, voice cloning, or app navigation |
| Rabbit web experience | Demo operator / approved relative | Show the live interaction, observable support steps, and provenance receipt | Medical dashboard, diagnosis, mood/cognition scoring, or decline tracking |
| Context graph | Rabbit's gated services | Retrieve only permitted current evidence and source-backed cues | Life archive, patient profile, or inferred clinical record |

## Hard product rules

1. Rabbit never generates, rewrites, or polishes first-person words for Mom.
2. Nothing publishes without recorded assent to the exact artifact and exact audience.
3. Rabbit speaks only cited, policy-permitted context.
4. Missing identity, policy, evidence, or assent stops the flow safely.
5. The graph stores compact provenance and consented evidence—not health inferences or a longitudinal “memory score.”
6. Calls happen only because an approved person forwarded a current ask.

## Translation from the notebook sketch

| Sketch label | Current design-spec interpretation |
|---|---|
| “Web app / dashboard” | Live session view plus caregiver/provenance receipt |
| “Graph / tracker” | Compact, private context and provenance graph; no symptom or progress tracking |
| “Telegram bot” | Neutral bridge to the family's existing thread; avoid a branded or mocked integration in the judged path |
| “Call → patient” | One request-triggered ordinary phone call for participation and assent |
| “Text → patient” | Not a primary patient surface; the phone call remains the accessible interface |
| “Text → family” | Ask intake, approved delivery, and non-clinical receipt |
| “Medical info / alerts” | Excluded from the current product |
| “Companionship / scheduled calls” | Excluded from the current product |

## Golden-path state sequence

`idle → ask_received → policy_passed → connected → following → lost → reanchored → contributed → playback → assented → delivered`

