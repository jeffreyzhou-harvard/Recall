/**
 * Request intake (product flow spec, nodes A -> D): one forwarded ask, up to
 * one photo, and nothing else from the thread.
 */
import { describe, expect, it } from "vitest";
import { buildFixtureRig, runFixture } from "@/fixtures/harness";
import { MAX_PHOTOS_PER_ASK, forwardedAskSchema } from "@/lib/intake/contract";
import { NOTICE_TEXT } from "@/lib/bridge/thread-bridge";
import { BLOCKED_TOPIC_FORWARD, THREAD, diwaliForward } from "./fixtures";

const ASK = "ask:fwd-diwali-dessert";
const PHOTO = "artifact:photo:fwd-diwali-dessert:photo-desserts";

describe("a forwarded ask", () => {
  it("becomes a CurrentAsk with its message, its one photo, and provenance on everything written", async () => {
    const rig = await buildFixtureRig();
    const before = await rig.graph.snapshot();
    const out = await rig.service.forwardAsk(rig.forward);
    expect(out).toMatchObject({ accepted: true, created: true, ask_id: ASK, thread_id: THREAD });

    const after = await rig.graph.snapshot();
    const added = after.nodes.filter((n) => !before.nodes.some((b) => b.id === n.id));
    expect(added.map((n) => `${n.type}:${n.id}`).sort()).toEqual(["Artifact:artifact:msg:fwd-diwali-dessert", `Artifact:${PHOTO}`, `CurrentAsk:${ASK}`]);
    for (const item of [...added, ...after.edges.filter((e) => !before.edges.some((b) => b.id === e.id))]) {
      expect(item.prov.author, item.id).toBe("person:anika");
      expect(item.prov.audience_scope, item.id).toEqual([THREAD]);
      expect(item.prov.expires_at, item.id).toBe("2026-11-07T17:25:00.000Z"); // received_at + the policy's 48 hours
    }
    expect((await rig.graph.getNode(PHOTO))!.prov).toMatchObject({ source_class: "ask_artifact", asset_id: "photo-desserts", media_hash: rig.assets.get("photo-desserts").sha256 });
  });

  it("is understood only through the asker's own words matched against names the graph already knows", async () => {
    const rig = await buildFixtureRig();
    const out = await rig.service.forwardAsk(rig.forward);
    expect(out.accepted && out.interpretation).toEqual({
      option_topic_ids: ["topic:kheer", "topic:halwa"], // from the caption, in the order she wrote them
      subject_topic_ids: ["topic:dessert"], // what both options are a kind of
      event_ids: ["event:diwali-2026"], // named in the message
      depicts: { "photo-desserts": ["topic:kheer", "topic:halwa"] },
    });
    const about = (await rig.graph.edgesOf(ASK)).filter((e) => e.type === "ABOUT");
    expect(about.every((e) => e.prov.extraction_method === "lexical_match" && e.prov.source_class === "current_ask")).toBe(true);
    expect(Object.fromEntries(about.map((e) => [e.to, e.props.role]))).toEqual({
      "topic:kheer": "option",
      "topic:halwa": "option",
      "topic:dessert": "subject",
      "event:diwali-2026": "occasion",
    });
  });

  it("matches a blocked topic too, so the policy - not intake - is what refuses it", async () => {
    const rig = await buildFixtureRig({ forward: BLOCKED_TOPIC_FORWARD });
    const out = await rig.service.forwardAsk(rig.forward);
    expect(out.accepted && out.interpretation!.subject_topic_ids).toEqual(["topic:finances"]);
  });

  it("is idempotent: a bridge redelivering the same forward changes nothing", async () => {
    const rig = await buildFixtureRig();
    await rig.service.forwardAsk(rig.forward);
    const once = await rig.graph.snapshot();
    expect(await rig.service.forwardAsk(rig.forward)).toMatchObject({ accepted: true, created: false });
    expect(await rig.graph.snapshot()).toEqual(once);
  });

  it("replaces the thread's previous ask as the current one", async () => {
    const rig = await buildFixtureRig();
    await rig.service.forwardAsk(rig.forward);
    await rig.service.forwardAsk(diwaliForward({ forward_id: "fwd-later", received_at: "2026-11-05T17:28:00.000Z" }));
    expect((await rig.graph.findCurrentAsk(THREAD))!.id).toBe("ask:fwd-later");
  });
});

describe("what intake refuses", () => {
  const refused = async (forward: unknown) => {
    const rig = await buildFixtureRig({ forward });
    const before = await rig.graph.snapshot();
    const out = await rig.service.forwardAsk(forward);
    expect(await rig.graph.snapshot(), "a refused forward must leave no trace in the graph").toEqual(before);
    return { out, rig };
  };

  it(`more than ${MAX_PHOTOS_PER_ASK} photo`, async () => {
    const two = diwaliForward({ photos: [{ asset_id: "photo-desserts", caption: "Kheer" }, { asset_id: "photo-desserts", caption: "Halwa" }] });
    expect((await refused(two)).out).toMatchObject({ accepted: false, code: "too_many_photos" });
  });

  it("anything beyond the ask itself: there is no field for chat history, contacts, or location", async () => {
    for (const extra of [{ history: ["earlier message"] }, { location: "home" }, { contacts: [] }, { health_notes: "x" }]) {
      expect((await refused(diwaliForward(extra))).out).toMatchObject({ accepted: false, code: "invalid_payload" });
    }
    expect(Object.keys(forwardedAskSchema.shape).sort()).toEqual(
      ["addressee_id", "asker_id", "forward_id", "photos", "received_at", "requested_audience", "text", "thread_id"].sort(),
    );
  });

  it("media that is not in the manifest", async () => {
    const out = (await refused(diwaliForward({ photos: [{ asset_id: "photo-unknown", caption: "Kheer and halwa" }] }))).out;
    expect(out).toMatchObject({ accepted: false, code: "unknown_asset" });
  });

  it("someone the joint setup does not know - and it asks the family's thread to clarify", async () => {
    const { out, rig } = await refused(diwaliForward({ asker_id: "person:stranger" }));
    expect(out).toMatchObject({ accepted: false, code: "unknown_party", clarify_posted: true });
    expect(rig.bridge.posted()).toMatchObject([{ kind: "family_notice", notice: "clarify", text: NOTICE_TEXT.clarify, to: { thread_id: THREAD } }]);
  });

  it("a forward from a thread nobody set up - and then it says nothing to anyone", async () => {
    const { out, rig } = await refused(diwaliForward({ thread_id: "artifact:unknown-thread", requested_audience: "artifact:unknown-thread" }));
    expect(out).toMatchObject({ accepted: false, code: "unknown_party", clarify_posted: false });
    expect(rig.bridge.posted()).toEqual([]);
  });
});

describe("an ask Relay cannot make sense of", () => {
  it("stops safely before any call and asks the family to clarify, rather than guessing what it is about", async () => {
    const run = await runFixture({ forward: diwaliForward({ forward_id: "fwd-vague", text: "Mom, what do you think?", photos: [] }), transcript: null });
    expect(run.intake).toMatchObject({ accepted: true });
    expect(run.recording.final_state).toBe("blocked");
    expect(run.recording.call).toBeNull();
    expect(run.recording.messages).toMatchObject([{ kind: "family_notice", notice: "clarify" }]);
  });
});
