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
import { CALL_SCRIPT, MANIFEST, POLICY } from "@/fixtures";
import { buildFixtureRig, type FixtureRig } from "@/fixtures/harness";
import { UngroundedFactError, applyAnswer, type Answer, type ProposedFact } from "@/lib/discovery/answers";
import { anchors, findGaps } from "@/lib/discovery/gaps";
import { DiscoveryError, type LibraryObservations } from "@/lib/discovery/ingest";
import { assertSpeakable, nextRung, questionFor } from "@/lib/discovery/questions";
import { LadybugGraphStore } from "@/lib/graph/ladybug-store";
import { RelationError, assertRelation } from "@/lib/graph/relations";
import type { SeedFile } from "@/lib/graph/seed";
import type { AssetManifest } from "@/lib/provenance/assets";
import { endsInOpenQuestion, lintConduct, lintLines } from "@/lib/script/lint";
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
  recall_set_up_by: ANIKA,
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

  it("a third name for a face already in dispute is set aside too, never read as the answer", async () => {
    const rig = await rigWithLibrary();
    const [who] = await rig.service.nextQuestions(1);
    await rig.service.answerQuestion(who!, says(ANIKA, "That's Maya.", "a1"));
    await rig.service.answerQuestion(who!, says(MOM, "That's Priya.", "a2"));
    const third = await rig.service.answerQuestion(who!, says(ANIKA, "That's Rose.", "a3"));
    const rose = "IDENTIFIED_AS:cluster:face:f1->person:rose";
    expect((await rig.graph.getEdge(rose))!.prov.status).toBe("disputed");
    expect(third.disputed).toEqual([rose]);
    expect(third.created).not.toContain(rose);
    // The two already set aside are not disputed a second time: each still carries exactly what was said about it.
    expect((await rig.graph.getEdge("IDENTIFIED_AS:cluster:face:f1->person:maya"))!.prov.confirmations).toHaveLength(1);
    expect((await rig.graph.getEdge("IDENTIFIED_AS:cluster:face:f1->person:priya"))!.prov.confirmations).toHaveLength(0);
    expect((await rig.service.nextQuestions(1))[0]!.gap).toMatchObject({ kind: "unidentified", cluster_id: "cluster:face:f1" });
  });

  it("restating a tie the setup already holds confirms that edge, rather than writing a second one beside it", async () => {
    const seeded = "RELATED_TO:person:mom->person:anika";
    const seed: SeedFile = { ...SEED, edges: [...SEED.edges, { type: "RELATED_TO", from: MOM, to: ANIKA, source: "artifact:setup-record", props: { relation: "grandchild", said_as: "granddaughter" } }] };
    const rig = await buildFixtureRig({ policy: discoveryOn(), manifest, seed });
    await rig.service.ingestLibrary(OBSERVED, ANIKA);
    expect((await rig.graph.getEdge(seeded))!.prov.status).toBe("family_confirmed");
    const [who] = await rig.service.nextQuestions(1);
    const result = await rig.service.answerQuestion(who!, says(MOM, "That's my granddaughter Anika."));
    expect(result.confirmed).toEqual([seeded]);
    expect((await rig.graph.getEdge(seeded))!.prov).toMatchObject({ status: "participant_confirmed", patient_confirmed: true });
    expect((await rig.graph.snapshot()).edges.filter((e) => e.type === "RELATED_TO" && e.from === MOM && e.to === ANIKA).map((e) => e.id)).toEqual([seeded]);
  });
});

describe("the lexical reader proposes only what the words carry", () => {
  const ask = async (policy: unknown = discoveryOn()) => {
    const rig = await rigWithLibrary(policy);
    const [who] = await rig.service.nextQuestions(1);
    return { rig, who: who! };
  };
  const people = async (rig: FixtureRig): Promise<string[]> => (await rig.graph.nodesOfType("Person")).map((p) => p.id).sort();
  const ties = async (rig: FixtureRig): Promise<string[]> => (await rig.graph.snapshot()).edges.filter((e) => e.type === "RELATED_TO").map((e) => e.id);

  it("takes a name only from a capitalized word: 'my daughter on the beach' names nobody", async () => {
    const { rig, who } = await ask();
    const result = await rig.service.answerQuestion(who, says(MOM, "That's my daughter on the beach."));
    expect(result.created).toEqual([]);
    expect(await people(rig)).toEqual([ANIKA, MOM]);
    expect(await ties(rig)).toEqual([]);
  });

  it("'her', said by her, is somebody else: 'Maya and her daughter Anika' ties nobody to Mom", async () => {
    const { rig, who } = await ask();
    const result = await rig.service.answerQuestion(who, says(MOM, "That's Maya and her daughter Anika."));
    expect(result.created).toEqual([]); // two people, and nothing in the words says which one this face is
    expect(await ties(rig)).toEqual([]);
    // Said by family after another name, "her" most likely means that person. It is not taken as a tie to Mom either.
    const family = await ask();
    await family.rig.service.answerQuestion(family.who, says(ANIKA, "That's Maya and her daughter Rose."));
    expect(await ties(family.rig)).toEqual([]);
    // With no other name before it, "her", said by family, is Mom - as it always was.
    const plain = await ask();
    await plain.rig.service.answerQuestion(plain.who, says(ANIKA, "That's her daughter Maya."));
    expect(await ties(plain.rig)).toEqual(["RELATED_TO:child:person:mom->person:maya"]);
  });

  it("the person named after \"that's\" is who the photo shows, not the person tied to the speaker", async () => {
    const { rig, who } = await ask();
    const result = await rig.service.answerQuestion(who, says(MOM, "That's Maya with my sister Priya."));
    expect(result.created).toEqual(["person:maya", "IDENTIFIED_AS:cluster:face:f1->person:maya", "person:priya", "RELATED_TO:sibling:person:mom->person:priya"]);
    expect(await rig.graph.getEdge("IDENTIFIED_AS:cluster:face:f1->person:priya")).toBeNull();
  });

  it("proposes nothing from a denial, a doubt, or an echo of Recall's own question - so it can never promote the family's answer", async () => {
    for (const text of ["No, that's not Priya, that's Maya.", "That isn't Priya.", "Maya or Priya?", "Looks like Priya.", "I think that's Priya.", "Maybe Priya."]) {
      const { rig, who } = await ask();
      await rig.service.answerQuestion(who, says(ANIKA, "That's Priya.", "a1"));
      const result = await rig.service.answerQuestion(who, says(MOM, text, "a2"));
      expect([result.created, result.confirmed, result.disputed], text).toEqual([[], [], []]);
      expect((await rig.graph.getEdge("IDENTIFIED_AS:cluster:face:f1->person:priya"))!.prov, text).toMatchObject({ status: "family_confirmed", patient_confirmed: false, confirmations: [] });
    }
  });

  it("does not take a sentence opener, or a possessive, for a name", async () => {
    for (const [text, expected] of [
      ["Hmm, Maya.", [ANIKA, "person:maya", MOM]],
      ["Definitely Maya.", [ANIKA, "person:maya", MOM]],
      ["Looks like Maya.", [ANIKA, MOM]],
      ["That's Maya's friend.", [ANIKA, MOM]],
    ] as const) {
      const { rig, who } = await ask();
      await rig.service.answerQuestion(who, says(MOM, text));
      expect(await people(rig), text).toEqual(expected);
    }
  });

  it("her naming the face on an invite_her_word question is recorded as her own word", async () => {
    const rig = await rigWithLibrary(discoveryOn({ invite_her_confirmation: true }));
    const [q1] = await rig.service.nextQuestions(1);
    await rig.service.answerQuestion(q1!, says(ANIKA, "That's her daughter Maya.", "a1"));
    const invite = (await rig.service.nextQuestions(10)).find((q) => q.gap.kind === "invite_her_word")!;
    expect(invite.gap.cluster_id).toBe("cluster:face:f1");
    const result = await rig.service.answerQuestion(invite, says(MOM, "That's Maya.", "a2"));
    const id = "IDENTIFIED_AS:cluster:face:f1->person:maya";
    expect(result.confirmed).toEqual([id]);
    expect((await rig.graph.getEdge(id))!.prov).toMatchObject({ status: "participant_confirmed", patient_confirmed: true });
    expect((await findGaps(rig.graph, { participant_id: MOM, invite_her_confirmation: true })).filter((g) => g.kind === "invite_her_word")).toEqual([]); // asked until she has said it once, and never again
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

  it("keeps her words out of the error when a proposal is refused (rule 8)", async () => {
    const { who, deps } = await setup();
    const invented: ProposedFact[] = [{ kind: "identify", as: { type: "Person", name: "Rose" } }];
    const refused: unknown = await applyAnswer(who, says(MOM, "That's my daughter Maya, down at the shore."), invented, deps).then(
      () => null,
      (e: unknown) => e,
    );
    expect(refused).toBeInstanceOf(UngroundedFactError);
    const { message } = refused as Error;
    expect(message).toContain('"Rose" does not appear in what was said');
    for (const hers of ["Maya", "daughter", "shore"]) expect(message).not.toContain(hers);
  });

  it("refuses a relation that contradicts the word she used for it", async () => {
    const { rig, who, deps } = await setup();
    const before = await persisted(rig);
    const twisted: ProposedFact[] = [{ kind: "relate", from: { id: MOM }, relation: "sibling", to: { type: "Person", name: "Maya" }, said_as: "daughter", basis: "stated" }];
    await expect(applyAnswer(who, says(MOM, "That's my daughter Maya."), twisted, deps)).rejects.toBeInstanceOf(UngroundedFactError);
    expect(await persisted(rig)).toBe(before);
  });

  it("takes 'stated' from the words, never on the proposer's say-so", async () => {
    const { rig, who, deps } = await setup();
    // No word of hers carries the tie.
    await applyAnswer(who, says(MOM, "That's Maya.", "a1"), [{ kind: "relate", from: { id: MOM }, relation: "child", to: { type: "Person", name: "Maya" }, said_as: null, basis: "stated" }], deps);
    expect((await rig.graph.getEdge("RELATED_TO:child:person:mom->person:maya"))!.prov).toMatchObject({ status: "inferred", patient_confirmed: false, extraction_method: "rule_deduction" });
    // She never mentioned Anika, so a tie from Anika is not something she said, whatever word is offered with it.
    await applyAnswer(who, says(MOM, "That's my daughter Maya.", "a2"), [{ kind: "relate", from: { id: ANIKA }, relation: "child", to: { type: "Person", name: "Maya" }, said_as: "daughter", basis: "stated" }], deps);
    expect((await rig.graph.getEdge("RELATED_TO:child:person:anika->person:maya"))!.prov).toMatchObject({ status: "inferred", patient_confirmed: false });
    // Her word, her tie, and everyone in it named or present: that one is hers.
    await applyAnswer(who, says(MOM, "My sister Priya.", "a3"), [{ kind: "relate", from: { id: MOM }, relation: "sibling", to: { type: "Person", name: "Priya" }, said_as: "sister", basis: "stated" }], deps);
    expect((await rig.graph.getEdge("RELATED_TO:sibling:person:mom->person:priya"))!.prov.status).toBe("participant_confirmed");
  });

  it("checks the shape of every planned edge, and that the speaker is in the graph, before writing anything", async () => {
    const { rig, who, deps } = await setup();
    const before = await persisted(rig);
    // A story can be about a person, a place, an event or an activity - not a preference, and not a policy record.
    await expect(applyAnswer(who, says(MOM, "She loved kheer."), [{ kind: "story", about: [{ type: "PreferenceExpertise", name: "kheer" }] }], deps)).rejects.toBeInstanceOf(UngroundedFactError);
    await expect(applyAnswer(who, says(MOM, "She loved kheer."), [{ kind: "story", about: [{ id: "policy:mom-setup" }] }], deps)).rejects.toBeInstanceOf(UngroundedFactError);
    // Approved on paper, but not a person in the graph: there is nobody for the story to be spoken by.
    const ghost = { ...deps, policy: { ...deps.policy, approved_people: [...deps.policy.approved_people, "person:ghost"] } };
    await expect(applyAnswer(who, says("person:ghost", "Maya loved the shore."), [{ kind: "story", about: [{ type: "Person", name: "Maya" }] }], ghost)).rejects.toBeInstanceOf(UngroundedFactError);
    // A question about a cluster that is not there.
    const nowhere = { ...who, gap: { ...who.gap, cluster_id: "cluster:face:none" } };
    await expect(applyAnswer(nowhere, says(MOM, "That's Maya."), [{ kind: "identify", as: { type: "Person", name: "Maya" } }], deps)).rejects.toBeInstanceOf(UngroundedFactError);
    expect(await persisted(rig), "nothing is half-written").toBe(before);
  });

  it("refuses to reuse an answer id for different words, so one answer's facts never cite another's", async () => {
    const { rig, who, deps } = await setup();
    const maya: ProposedFact[] = [{ kind: "identify", as: { type: "Person", name: "Maya" } }];
    await applyAnswer(who, says(MOM, "That's Maya.", "a1"), maya, deps);
    const before = await persisted(rig);
    await expect(applyAnswer(who, says(MOM, "That's Priya.", "a1"), [{ kind: "identify", as: { type: "Person", name: "Priya" } }], deps)).rejects.toThrow(/answer id/);
    await expect(applyAnswer(who, says(ANIKA, "That's Maya.", "a1"), maya, deps)).rejects.toThrow(/answer id/);
    expect(await persisted(rig)).toBe(before);
    // The same words from the same person under the same id is a retry, not a collision.
    await expect(applyAnswer(who, says(MOM, "That's Maya.", "a1"), maya, deps)).resolves.toMatchObject({ confirmed: ["IDENTIFIED_AS:cluster:face:f1->person:maya"] });
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

  it("refuses to state, unattributed, what only the family has said (rule 13)", async () => {
    const { rig, who } = await setup();
    await rig.service.answerQuestion(who, says(ANIKA, "That's Maya."));
    const forged = structuredClone(who);
    forged.rungs[0]!.segments.push({ text: " This is Maya.", kind: "fact", citation_ids: ["IDENTIFIED_AS:cluster:face:f1->person:maya"] });
    await expect(assertSpeakable(forged, rig.graph)).rejects.toThrow(/only family_confirmed/);
    // Once she has said so herself, the same line is hers to hear.
    await rig.service.answerQuestion(who, says(MOM, "Maya.", "a2"));
    await expect(assertSpeakable(forged, rig.graph)).resolves.toBeUndefined();
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

  it("inviting her own word is off by default; when on, the family's answer is only ever an attributed cue before an open question (rule 13)", async () => {
    const invited = async (invite: boolean, tie = "daughter") => {
      const rig = await rigWithLibrary(discoveryOn({ invite_her_confirmation: invite }));
      const [q1, q2] = await rig.service.nextQuestions(2);
      await rig.service.answerQuestion(q1!, says(ANIKA, `That's her ${tie} Maya.`, "a1"));
      await rig.service.answerQuestion(q2!, says(ANIKA, "That's her sister Priya.", "a2"));
      const gap = (await findGaps(rig.graph, { participant_id: MOM, invite_her_confirmation: invite })).find((g) => g.kind === "invite_her_word" && g.cluster_id === "cluster:face:f1");
      return { rig, gap };
    };
    expect((await invited(false)).gap).toBeUndefined();

    // Whatever the family said the tie is, their answer is never a forced-choice option and is never stated outright.
    for (const tie of ["daughter", "friend"]) {
      const { rig, gap } = await invited(true, tie);
      const q = await questionFor(gap!, rig.graph, MOM);
      await assertSpeakable(q, rig.graph);
      expect(q.rungs.map((r) => `${r.level}: ${r.text}`), tie).toEqual([
        "open: This person appears in several of your photos. Who is this?",
        "cue: Anika mentioned this might be Maya. What comes to mind?",
      ]);
      expect(q.rungs.flatMap((r) => r.segments).filter((s) => s.kind === "fact"), "nothing of the family's is voiced as a fact").toEqual([]);
      expect(nextRung(q, "open")!.level).toBe("cue");
      expect(nextRung(q, "cue")).toBeNull(); // the end of the ladder is not a failure; Recall moves on
    }
  });

  it("every question that leans on the family's word says whose word it is; her own word is simply said", async () => {
    const rig = await rigWithLibrary(discoveryOn({ invite_her_confirmation: true }));
    const [face] = await rig.service.nextQuestions(1);
    await rig.service.answerQuestion(face!, says(ANIKA, "That's Maya.", "a1"));
    const textsByKind = async (): Promise<Record<string, string[]>> => {
      const out: Record<string, string[]> = {};
      for (const q of await rig.service.nextQuestions(10)) out[`${q.gap.kind} ${q.gap.cluster_id}`] = q.rungs.map((r) => r.text); // nextQuestions runs assertSpeakable on each
      return out;
    };
    const familyOnly = await textsByKind();
    expect(familyOnly["how_related cluster:face:f1"]).toEqual(["Anika mentioned this might be Maya. How do you know Maya?"]);
    expect(familyOnly["unidentified cluster:place:p1"]).toEqual(["This place appears in some of your photos. Where is this?"]); // not "Maya is in some of these too": she has not said so
    const spoken = Object.values(familyOnly).flat().map((text, i) => ({ id: `discovery:${i}`, text, surface: "call" as const }));
    expect([...lintLines(spoken, CALL_SCRIPT.banned), ...lintConduct(spoken, CALL_SCRIPT.conduct)]).toEqual([]);
    for (const line of spoken.filter((l) => l.text.includes("mentioned"))) expect(endsInOpenQuestion(line.text), line.text).toBe(true);

    const invite = (await rig.service.nextQuestions(10)).find((q) => q.gap.kind === "invite_her_word")!;
    await rig.service.answerQuestion(invite, says(MOM, "That's Maya.", "a2"));
    const hers = await textsByKind();
    expect(hers["how_related cluster:face:f1"]).toEqual(["This is Maya. How do you know Maya?"]);
    expect(hers["unidentified cluster:place:p1"]).toEqual(["This place appears in some of your photos. Maya is in some of these too. Where is this?"]);

    // A recurring, tied person nobody has told a story about: an invitation, attributed while only the family has named her.
    const told = await rigWithLibrary();
    const [first] = await told.service.nextQuestions(1);
    await told.service.answerQuestion(first!, says(ANIKA, "That's her daughter Maya.", "a1"));
    const about = (await told.service.nextQuestions(10)).find((q) => q.gap.kind === "tell_me_about")!;
    expect(about.rungs.map((r) => r.text)).toEqual(["Anika mentioned this might be Maya. What would you like to tell me about this photo?"]);
    expect(endsInOpenQuestion(about.rungs[0]!.text)).toBe(true);
  });

  it("a ladder missing a rung skips past it, and never circles back to asking her again", async () => {
    const rig = await rigWithLibrary();
    const [real] = await rig.service.nextQuestions(1);
    const at = (level: "open" | "cue" | "recognition") => ({ level, text: "", segments: [] });
    const noCue = { ...real!, rungs: [at("open"), at("recognition")] };
    expect(nextRung(noCue, "open")!.level).toBe("recognition");
    expect(nextRung(noCue, "cue")!.level).toBe("recognition");
    expect(nextRung(noCue, "recognition")).toBeNull();
    const openOnly = { ...real!, rungs: [at("open")] };
    expect(nextRung(openOnly, "cue")).toBeNull();
    expect(nextRung(openOnly, "recognition")).toBeNull();
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
        // The question she is actually asked next about this face - not the stale "unidentified" one - so her confirmation runs the real path.
        const invite = (await rig.service.nextQuestions(10)).find((q) => q.gap.kind === "invite_her_word" && q.gap.cluster_id === who!.gap.cluster_id)!;
        await rig.service.answerQuestion(invite, says(MOM, "My daughter Maya.", "a2"));
        return rig.graph.snapshot();
      };
      const policy = discoveryOn({ invite_her_confirmation: true });
      const onLbug = await run(await buildFixtureRig({ policy, manifest, seed: SEED, graph: store }));
      const inMemory = await run(await buildFixtureRig({ policy, manifest, seed: SEED }));
      expect(onLbug).toEqual(inMemory);
      expect(onLbug.edges.find((e) => e.type === "IDENTIFIED_AS")!.prov).toMatchObject({ status: "participant_confirmed", confirmations: [{ by: MOM, stance: "confirms" }] });
      expect(onLbug.edges.find((e) => e.id === "RELATED_TO:child:person:mom->person:maya")!.prov.status).toBe("participant_confirmed");
    } finally {
      await store.close();
    }
  });
});
