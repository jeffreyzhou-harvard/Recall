/**
 * Ask, don't assert (AGENTS.md section 7): observations -> knowledge gaps -> questions -> answers -> a
 * richer graph. Inference never becomes fact; only a named person's own words do.
 *
 * This runs on a small seed of its own - one person and one approved relative - so that what the graph
 * learns here comes only from the answers given here. No photo fixtures: an analyzer's output is a few
 * lines of inline data, and the photos are synthetic manifest entries.
 *
 * Note for the team: bulk photo-library ingestion and face grouping are non-goals in section 14. This
 * module stays OFF unless the joint setup turns it on (`discovery.enabled`), and the judged setup does not.
 */
import { describe, expect, it } from "vitest";
import { MANIFEST, POLICY } from "@/fixtures";
import { buildFixtureRig, type FixtureRig } from "@/fixtures/harness";
import { UngroundedFactError, applyAnswer, type Answer, type ProposedFact } from "@/lib/discovery/answers";
import { anchors, findGaps } from "@/lib/discovery/gaps";
import { DiscoveryError, type LibraryObservations } from "@/lib/discovery/ingest";
import { assertSpeakable, nextRung, questionFor } from "@/lib/discovery/questions";
import { LadybugGraphStore } from "@/lib/graph/ladybug-store";
import { RelationError, assertRelation } from "@/lib/graph/relations";
import type { SeedFile } from "@/lib/graph/seed";
import type { AssetManifest } from "@/lib/provenance/assets";
import { policySchema } from "@/lib/tools";

const MOM = "person:mom";
const ANIKA = "person:anika";
const AT = "2026-11-01T15:00:00.000Z";

const photoIds = Array.from({ length: 8 }, (_, i) => `lib-${i + 1}`);
const manifest: AssetManifest = {
  ...MANIFEST,
  assets: [...MANIFEST.assets, ...photoIds.map((id, i) => ({ id, path: `(test) ${id}`, kind: "image" as const, sha256: (i + 1).toString(16).padStart(64, "a"), bytes: 1, duration_ms: null, status: "placeholder" as const, description: "synthetic" }))],
};
/** What an analyzer hands over: photos grouped by what recurs. No names, no identities - there is no field for one. */
const OBSERVED: LibraryObservations = {
  analyzer: "test-analyzer@1",
  observed_at: AT,
  photos: photoIds.map((asset_id) => ({ asset_id, taken_at: null })),
  clusters: [
    { cluster_key: "f1", kind: "face", photo_asset_ids: photoIds.slice(0, 6), confidence: 0.93 },
    { cluster_key: "f2", kind: "face", photo_asset_ids: photoIds.slice(3, 7), confidence: 0.88 },
    { cluster_key: "p1", kind: "place", photo_asset_ids: photoIds.slice(3, 6), confidence: 0.8 },
  ],
};
/** One person, one approved relative, and the joint setup between them. Everything else the graph learns, it learns from an answer. */
const SEED: SeedFile = {
  version: 1,
  description: "a joint setup and nothing else",
  sources: { "artifact:setup-record": { source_class: "joint_setup", asset_id: null, observed_at: "2026-10-12T15:00:00.000Z", author: ANIKA, extraction_method: "joint_setup", confidence: 1, audience_scope: [MOM], expires_at: null } },
  nodes: [
    { id: "artifact:setup-record", type: "Artifact", label: "Joint setup (Mom with Anika)", props: { kind: "setup_record", text: null, alt: null }, source: "artifact:setup-record" },
    { id: MOM, type: "Person", label: "Mom", props: { display_name: "Mom", role: "participant", subject_pronoun: "she" }, source: "artifact:setup-record" },
    { id: ANIKA, type: "Person", label: "Anika", props: { display_name: "Anika", role: "family" }, source: "artifact:setup-record" },
    { id: "policy:mom-setup", type: "AccessPolicy", label: "Mom's joint setup", props: { policy_ref: "(test)" }, source: "artifact:setup-record" },
  ],
  edges: [{ type: "PERMITTED_IN", from: ANIKA, to: "policy:mom-setup", source: "artifact:setup-record" }],
};
const SETUP = {
  ...(POLICY as Record<string, any>),
  policy_id: "policy:mom-setup",
  person_id: MOM,
  established_by: [MOM, ANIKA],
  relay_set_up_by: ANIKA,
  approved_people: [ANIKA],
  approved_audiences: [MOM],
  topics: { allow: [], block: [], person_topics_enabled: false },
  safety: { designated_caregivers: [{ person_id: ANIKA, alert_channel: "dashboard" }], emergency_number: "911" },
  attestations: { ...(POLICY as Record<string, any>).attestations, introduced_by: ANIKA },
  dashboard: { ...(POLICY as Record<string, any>).dashboard, grants: [] },
};
const discoveryOn = (over: Record<string, unknown> = {}) => ({
  ...SETUP,
  discovery: { enabled: true, photo_access_granted_by: [ANIKA], observe: { faces: true, places: true, times: true, themes: true }, invite_her_confirmation: false, ...over },
});

const rigWithLibrary = async (policy: unknown = discoveryOn()): Promise<FixtureRig> => {
  const rig = await buildFixtureRig({ policy, manifest, seed: SEED });
  await rig.service.ingestLibrary(OBSERVED, ANIKA);
  return rig;
};
const says = (by: string, text: string, id = "a1"): Answer => ({ answer_id: id, by, text, at: AT, recording: null });
const persisted = async (rig: FixtureRig): Promise<string> => JSON.stringify(await rig.graph.snapshot());

describe("ingesting a photo library", () => {
  it("writes observations only: recurring faces and places, numbered by how often they recur, named as nothing", async () => {
    const rig = await rigWithLibrary();
    const clusters = await rig.graph.nodesOfType("Cluster");
    expect(clusters.map((c) => `${c.label} (${c.props.kind}, ${c.props.photo_count})`)).toEqual(["Person 1 (face, 6)", "Person 2 (face, 4)", "Place 1 (place, 3)"]);
    for (const c of clusters) {
      expect(c.prov).toMatchObject({ status: "observed", source_class: "photo_library", extraction_method: "photo_analysis" });
      expect((await rig.graph.edgesOf(c.id)).filter((e) => e.type === "IDENTIFIED_AS")).toEqual([]);
    }
    expect((await rig.graph.nodesOfType("Person")).map((p) => p.id).sort()).toEqual([ANIKA, MOM]); // nobody was invented
  });

  it("is off unless the joint setup turned it on, and each kind of looking is its own consent", async () => {
    const off = await buildFixtureRig({ manifest });
    await expect(off.service.ingestLibrary(OBSERVED, ANIKA)).rejects.toMatchObject({ code: "discovery_disabled" });

    const noFaces = await buildFixtureRig({ manifest, policy: discoveryOn({ observe: { faces: false, places: true, times: true, themes: true } }) });
    const before = await persisted(noFaces);
    await expect(noFaces.service.ingestLibrary(OBSERVED, ANIKA)).rejects.toMatchObject({ code: "kind_not_permitted" });
    expect(await persisted(noFaces), "a refused ingest leaves nothing behind").toBe(before);

    const rig = await buildFixtureRig({ manifest, policy: discoveryOn() });
    await expect(rig.service.ingestLibrary(OBSERVED, "person:stranger")).rejects.toBeInstanceOf(DiscoveryError);
  });

  it("has no field an analyzer could use to smuggle in a name, an identity, or a face embedding", async () => {
    const rig = await buildFixtureRig({ manifest, policy: discoveryOn() });
    for (const extra of [{ name: "Maya" }, { identity: MOM }, { embedding: [0.1, 0.2] }, { relationship: "daughter" }]) {
      const tampered = { ...OBSERVED, clusters: [{ ...OBSERVED.clusters[0]!, ...extra }] };
      await expect(rig.service.ingestLibrary(tampered, ANIKA)).rejects.toMatchObject({ code: "invalid_observations" });
    }
    expect(() => policySchema.parse(discoveryOn({ photo_access_granted_by: ["person:stranger"] }))).toThrow();
  });
});

describe("knowledge gaps and the questions they become", () => {
  it("starts from the anchors: the most present unnamed things, worded as observations", async () => {
    const rig = await rigWithLibrary();
    const gaps = await findGaps(rig.graph, { participant_id: MOM, invite_her_confirmation: false });
    expect(anchors(gaps).map((g) => g.cluster_id)).toEqual(["cluster:face:f1", "cluster:face:f2", "cluster:place:p1"]);

    const [first] = await rig.service.nextQuestions(1);
    expect(first!.rungs.map((r) => r.text)).toEqual(["This person appears in several of your photos. Who is this?"]);
    expect(first!.show_photo_id).toBe("artifact:library:lib-1"); // one photo, never a carousel
    // It does not say "she", "your daughter", or anything else nobody has told it.
    expect(first!.rungs[0]!.segments.filter((s) => s.kind === "fact")).toEqual([]);
  });

  it("the full loop: an answer names the face, ties her to Mom in Mom's own word, and sharpens the next question", async () => {
    const rig = await rigWithLibrary();
    const [who] = await rig.service.nextQuestions(1);
    const result = await rig.service.answerQuestion(who!, says(MOM, "That's my daughter Maya."));
    expect(result.created).toEqual(["person:maya", "IDENTIFIED_AS:cluster:face:f1->person:maya", "RELATED_TO:child:person:mom->person:maya"]);

    const tie = (await rig.graph.getEdge("RELATED_TO:child:person:mom->person:maya"))!;
    expect(tie.props).toEqual({ relation: "child", said_as: "daughter" }); // a plain relation, and her word beside it
    expect(tie.prov).toMatchObject({ status: "participant_confirmed", source_class: "discovery_answer", author: MOM, source_id: "artifact:answer:a1" });
    expect((await rig.graph.getNode("artifact:answer:a1"))!.props).toMatchObject({ kind: "answer", text: "That's my daughter Maya." }); // verbatim

    // Graph-guided: the next question about the place already knows Maya is in those photos.
    const place = (await rig.service.nextQuestions(5)).find((q) => q.expects === "Place")!;
    expect(place.rungs[0]!.text).toBe("This place appears in some of your photos. Maya is in some of these too. Where is this?");
    await rig.service.answerQuestion(place, says(MOM, "We used to go to Cape May every summer.", "a2"));
    expect((await rig.graph.getNode("place:cape-may"))!.label).toBe("Cape May");
  });

  it("joins a face to someone she already mentioned, rather than making a second person", async () => {
    const rig = await rigWithLibrary();
    const [q1, q2] = await rig.service.nextQuestions(2);
    await rig.service.answerQuestion(q1!, says(MOM, "That's my daughter Maya, and my granddaughter Priya is somewhere too."));
    expect((await rig.graph.nodesOfType("Person")).map((p) => p.id)).toContain("person:priya");
    await rig.service.answerQuestion(q2!, says(MOM, "Priya.", "a2"));
    expect((await rig.graph.nodesOfType("Person")).filter((p) => p.props.display_name === "Priya")).toHaveLength(1);
    expect(await rig.graph.getEdge("IDENTIFIED_AS:cluster:face:f2->person:priya")).not.toBeNull();
  });

  it("a second person saying so adds a source to the same fact: 'Confirmed by Anika'", async () => {
    const rig = await rigWithLibrary();
    const [who] = await rig.service.nextQuestions(1);
    await rig.service.answerQuestion(who!, says(ANIKA, "That's Maya.", "a1"));
    const id = "IDENTIFIED_AS:cluster:face:f1->person:maya";
    expect((await rig.graph.getEdge(id))!.prov.status).toBe("family_confirmed");
    const again = await rig.service.answerQuestion(who!, says(MOM, "Maya.", "a2"));
    expect(again.confirmed).toEqual([id]);
    expect((await rig.graph.getEdge(id))!.prov).toMatchObject({ status: "participant_confirmed", confirmations: [{ by: MOM, role: "participant", stance: "confirms", source_id: "artifact:answer:a2" }] });
  });

  it("does not choose between people: if two say different things, both are set aside", async () => {
    const rig = await rigWithLibrary();
    const [who] = await rig.service.nextQuestions(1);
    await rig.service.answerQuestion(who!, says(ANIKA, "That's Maya.", "a1"));
    const clash = await rig.service.answerQuestion(who!, says(MOM, "That's Priya.", "a2"));
    expect(clash.disputed).toHaveLength(2);
    expect((await rig.graph.getEdge("IDENTIFIED_AS:cluster:face:f1->person:maya"))!.prov.status).toBe("disputed");
    expect((await rig.service.nextQuestions(1))[0]!.gap.kind).toBe("unidentified"); // a gap again, until a person settles it
  });
});

describe("inference never silently becomes fact", () => {
  const setup = async () => {
    const rig = await rigWithLibrary();
    const [who] = await rig.service.nextQuestions(1);
    return { rig, who: who!, deps: { graph: rig.graph, policy: policySchema.parse(discoveryOn()) } };
  };

  it("rejects any proposed fact whose name is not in the person's literal words - whatever proposed it", async () => {
    const { rig, who, deps } = await setup();
    const before = await persisted(rig);
    const invented: ProposedFact[] = [
      { kind: "identify", as: { type: "Person", name: "Maya" } },
      { kind: "relate", from: { type: "Person", name: "Maya" }, relation: "lived_in", to: { type: "Place", name: "Boston" }, said_as: null, basis: "stated" },
    ];
    await expect(applyAnswer(who, says(MOM, "That's my daughter Maya."), invented, deps)).rejects.toThrow(/"Boston" does not appear in what was said/);
    expect(await persisted(rig), "nothing at all is written when any proposal is ungrounded").toBe(before);
    const putWordsInHerMouth: ProposedFact[] = [{ kind: "relate", from: { id: MOM }, relation: "child", to: { type: "Person", name: "Maya" }, said_as: "beloved daughter", basis: "stated" }];
    await expect(applyAnswer(who, says(MOM, "That's my daughter Maya."), putWordsInHerMouth, deps)).rejects.toBeInstanceOf(UngroundedFactError);
  });

  it("writes what was worked out as `inferred`, and keeps it out of questions, retrieval, and identity", async () => {
    const { rig, who, deps } = await setup();
    // "She lives with my granddaughter Anika" - so presumably Anika's mother. Presumably is not a fact.
    const proposals: ProposedFact[] = [
      { kind: "identify", as: { type: "Person", name: "Maya" } },
      { kind: "relate", from: { type: "Person", name: "Maya" }, relation: "child", to: { id: ANIKA }, said_as: null, basis: "inferred" },
    ];
    await applyAnswer(who, says(MOM, "That's Maya. She lives with my granddaughter Anika."), proposals, deps);
    const guess = (await rig.graph.getEdge("RELATED_TO:child:person:maya->person:anika"))!;
    expect(guess.prov).toMatchObject({ status: "inferred", extraction_method: "rule_deduction" });

    // A guessed edge is not a path, and only a person can change that.
    await expect(rig.graph.confirm(guess.id, { by: ANIKA, role: "family", stance: "confirms", source_id: "", at: AT })).rejects.toThrow(/needs a source/);
    await rig.graph.confirm(guess.id, { by: ANIKA, role: "family", stance: "confirms", source_id: "artifact:answer:a1", at: AT });
    expect((await rig.graph.getEdge(guess.id))!.prov.status).toBe("family_confirmed");
  });

  it("only lets relations from the closed list through, between the kinds of thing they make sense for", () => {
    expect(() => assertRelation("child", "Person", "Person")).not.toThrow();
    expect(() => assertRelation("secretly_resents", "Person", "Person")).toThrow(RelationError);
    expect(() => assertRelation("lived_in", "Person", "Person")).toThrow(/cannot connect/);
  });

  it("will not take an answer from someone who is neither her nor approved", async () => {
    const { who, deps } = await setup();
    await expect(applyAnswer(who, says("person:stranger", "That's Maya."), [{ kind: "identify", as: { type: "Person", name: "Maya" } }], deps)).rejects.toThrow(/neither her nor an approved person/);
  });

  it("refuses to voice a question that states something only observed or inferred", async () => {
    const { rig, who } = await setup();
    const forged = structuredClone(who);
    forged.rungs[0]!.segments.push({ text: " This is your daughter.", kind: "fact", citation_ids: ["cluster:face:f1"] });
    await expect(assertSpeakable(forged, rig.graph)).rejects.toThrow(/only observed/);
  });
});

describe("never a test", () => {
  it("never asks again about something she has already said", async () => {
    const rig = await rigWithLibrary(discoveryOn({ invite_her_confirmation: true }));
    const [who] = await rig.service.nextQuestions(1);
    await rig.service.answerQuestion(who!, says(MOM, "That's my daughter Maya."));
    const later = await findGaps(rig.graph, { participant_id: MOM, invite_her_confirmation: true });
    expect(later.filter((g) => g.cluster_id === "cluster:face:f1").map((g) => g.kind)).toEqual(["tell_me_about"]); // an invitation, not a check
  });

  it("inviting her own word is off by default, and when on it climbs a ladder of support that ends by simply telling her", async () => {
    const tellHer = async (invite: boolean) => {
      const rig = await rigWithLibrary(discoveryOn({ invite_her_confirmation: invite }));
      const [q1, q2] = await rig.service.nextQuestions(2);
      await rig.service.answerQuestion(q1!, says(ANIKA, "That's her daughter Maya.", "a1"));
      await rig.service.answerQuestion(q2!, says(ANIKA, "That's her sister Priya.", "a2"));
      const gap = (await findGaps(rig.graph, { participant_id: MOM, invite_her_confirmation: invite })).find((g) => g.kind === "invite_her_word" && g.cluster_id === "cluster:face:f1");
      return { rig, gap };
    };
    expect((await tellHer(false)).gap).toBeUndefined();

    const { rig, gap } = await tellHer(true);
    const q = await questionFor(gap!, rig.graph, MOM);
    await assertSpeakable(q, rig.graph);
    expect(q.rungs.map((r) => `${r.level}: ${r.text}`)).toEqual([
      "open: This person appears in several of your photos. Who is this?",
      "cue: This is someone in your family.",
      "recognition: Is this Maya or Priya?",
      "tell: This is Maya, your daughter.",
    ]);
    expect(nextRung(q, "open")!.level).toBe("cue");
    expect(nextRung(q, "tell")).toBeNull(); // the end of the ladder is not a failure; Relay moves on
  });

  it("stores nothing about how a question went: no rung, no timing, no attempts - nothing a memory score could be built from", async () => {
    const rig = await rigWithLibrary();
    const [who] = await rig.service.nextQuestions(1);
    await rig.service.answerQuestion(who!, says(MOM, "That's my daughter Maya."));
    const keys = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (keys.add(k), walk(x));
    };
    walk(await rig.graph.snapshot());
    expect([...keys].filter((k) => /rung|level|attempt|tries|latency|duration|recall|remember|correct|score|accuracy|streak/i.test(k))).toEqual([]);
  });
});

describe("LadybugDB parity", () => {
  it("runs the same discovery loop, confirmations included, to the same graph", async () => {
    const store = await LadybugGraphStore.open(":memory:");
    try {
      const run = async (rig: FixtureRig) => {
        await rig.service.ingestLibrary(OBSERVED, ANIKA);
        const [who] = await rig.service.nextQuestions(1);
        await rig.service.answerQuestion(who!, says(ANIKA, "That's her daughter Maya.", "a1"));
        await rig.service.answerQuestion(who!, says(MOM, "My daughter Maya.", "a2"));
        return rig.graph.snapshot();
      };
      const onLbug = await run(await buildFixtureRig({ policy: discoveryOn(), manifest, seed: SEED, graph: store }));
      const inMemory = await run(await buildFixtureRig({ policy: discoveryOn(), manifest, seed: SEED }));
      expect(onLbug).toEqual(inMemory);
      expect(onLbug.edges.find((e) => e.type === "IDENTIFIED_AS")!.prov.confirmations).toHaveLength(1);
    } finally {
      await store.close();
    }
  });
});
