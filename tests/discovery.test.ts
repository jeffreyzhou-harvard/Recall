/**
 * The discovery loop: photos -> observations -> knowledge gaps -> questions ->
 * answers -> a richer graph that the participation loop can use.
 *
 * No photo fixtures: an analyzer's output is a few lines of inline data, and
 * the photos are synthetic manifest entries. Nothing here touches /fixtures.
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
import { retrieveCandidates } from "@/lib/graph/retrieval";
import type { AssetManifest } from "@/lib/provenance/assets";
import { policySchema } from "@/lib/tools";
import { THREAD, diwaliForward } from "./fixtures";
import { benchOn } from "./helpers";

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
const discoveryOn = (over: Record<string, unknown> = {}) => ({
  ...(POLICY as object),
  discovery: { enabled: true, photo_access_granted_by: [ANIKA], observe: { faces: true, places: true, times: true, themes: true }, invite_her_confirmation: false, ...over },
});

const rigWithLibrary = async (policy: unknown = discoveryOn()): Promise<FixtureRig> => {
  const rig = await buildFixtureRig({ policy, manifest });
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

  it("a ladder missing a rung skips past it, and never circles back to asking her again", async () => {
    const rig = await rigWithLibrary(discoveryOn({ invite_her_confirmation: true }));
    const [q1, q2] = await rig.service.nextQuestions(2);
    await rig.service.answerQuestion(q1!, says(ANIKA, "That's her friend Maya.", "a1")); // a friend is not "someone in your family": no cue rung
    await rig.service.answerQuestion(q2!, says(ANIKA, "That's her sister Priya.", "a2"));
    const gap = (await findGaps(rig.graph, { participant_id: MOM, invite_her_confirmation: true })).find((g) => g.kind === "invite_her_word" && g.cluster_id === "cluster:face:f1");
    const q = await questionFor(gap!, rig.graph, MOM);
    expect(q.rungs.map((r) => r.level)).toEqual(["open", "recognition", "tell"]);
    expect(nextRung(q, "open")!.level).toBe("recognition");
    expect(nextRung(q, "cue")!.level).toBe("recognition");
    expect(nextRung(q, "recognition")!.level).toBe("tell");
    for (const only of [q.rungs.slice(0, 1), q.rungs.slice(0, 2)]) {
      expect(nextRung({ ...q, rungs: only }, "cue")?.level ?? null).toBe(only.length === 2 ? "recognition" : null);
      expect(nextRung({ ...q, rungs: only }, "recognition")).toBeNull();
    }
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

describe("what discovery gives the participation loop", () => {
  it("an ask can simply name someone she told Relay about; nothing unconfirmed is ever matchable or reachable", async () => {
    const rig = await rigWithLibrary();
    const [who] = await rig.service.nextQuestions(1);
    await rig.service.answerQuestion(who!, says(MOM, "That's my daughter Maya."));

    const out = await rig.service.forwardAsk(diwaliForward({ forward_id: "fwd-maya", text: "Mom, should Maya bring the kheer or the halwa for Diwali?", photos: [] }));
    expect(out.accepted && out.interpretation).toMatchObject({ mention_ids: ["person:maya"], option_topic_ids: ["topic:kheer", "topic:halwa"] });

    // An unnamed face, however often it recurs, can never be what an ask is about or context for one.
    const result = await retrieveCandidates(rig.graph, { ask_id: "ask:fwd-maya", policy_id: "policy:mom-default", audience: THREAD, allowed_sources: ["photo_library", "discovery_answer"], max_hops: 2, now_iso: AT });
    expect(result.candidates.filter((c) => c.root_type === "Cluster")).toEqual([]);
  });

  it("a tie she stated in discovery can verify an asker - but only the policy decides whether they may ask", async () => {
    const policy = { ...(discoveryOn() as Record<string, unknown>), approved_people: [ANIKA, "person:maya"] };
    const rig = await rigWithLibrary(policy);
    const [who] = await rig.service.nextQuestions(1);
    await rig.service.answerQuestion(who!, says(MOM, "That's my daughter Maya."));
    // Maya joins the family thread (setup), and forwards an ask. Her tie to Mom came from Mom's own words.
    const maya = (await rig.graph.getNode("person:maya"))!;
    await rig.graph.putEdge({ id: `MEMBER_OF_THREAD:person:maya->${THREAD}`, type: "MEMBER_OF_THREAD", from: "person:maya", to: THREAD, props: {}, prov: maya.prov });
    await rig.service.forwardAsk(diwaliForward({ forward_id: "fwd-from-maya", asker_id: "person:maya" }));
    const { runtime } = benchOn(rig, { policy });
    const ask = await runtime.call("inspect_request", { thread_id: THREAD });
    const identity = await runtime.call("resolve_identity_and_relationships", { ask_id: ask.ask_id, participants: ask.participants });
    expect(identity).toMatchObject({ verified: true, relationships: [{ kind: "child", verified_by: "artifact:answer:a1" }] });
    const granted = await runtime.call("get_access_policy", { ask_id: ask.ask_id, person: MOM, purpose: "answer_current_ask", audience: THREAD });
    expect(granted.decision).toBe("granted");

    // Same tie, but the joint setup never approved Maya to ask: verified, and still refused.
    const strict = await rigWithLibrary();
    const [q] = await strict.service.nextQuestions(1);
    await strict.service.answerQuestion(q!, says(MOM, "That's my daughter Maya."));
    await strict.graph.putEdge({ id: `MEMBER_OF_THREAD:person:maya->${THREAD}`, type: "MEMBER_OF_THREAD", from: "person:maya", to: THREAD, props: {}, prov: maya.prov });
    await strict.service.forwardAsk(diwaliForward({ forward_id: "fwd-from-maya", asker_id: "person:maya" }));
    const b = benchOn(strict, { policy: discoveryOn() });
    const ask2 = await b.runtime.call("inspect_request", { thread_id: THREAD });
    await b.runtime.call("resolve_identity_and_relationships", { ask_id: ask2.ask_id, participants: ask2.participants });
    expect(await b.runtime.call("get_access_policy", { ask_id: ask2.ask_id, person: MOM, purpose: "answer_current_ask", audience: THREAD })).toMatchObject({ decision: "denied", reason: "asker_not_approved" });
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
      const onLbug = await run(await buildFixtureRig({ policy: discoveryOn(), manifest, graph: store }));
      const inMemory = await run(await buildFixtureRig({ policy: discoveryOn(), manifest }));
      expect(onLbug).toEqual(inMemory);
      expect(onLbug.edges.find((e) => e.type === "IDENTIFIED_AS")!.prov.confirmations).toHaveLength(1);
    } finally {
      await store.close();
    }
  });
});
