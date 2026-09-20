import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GET, POST } from "@/app/api/circle/[...path]/route";
import { getOnboarding } from "@/server/onboarding";
import { issueAccount, revokeAccount } from "@/server/accounts";
import { sessionCookie } from "@/server/session";
import { emptyCircle, readCircle, updateCircle } from "@/server/circle/store";
import { projectCollectionGraph, projectGraphSources, queryAnswerSchema, rankQuerySources, validateQueryAnswer } from "@/server/circle/graph-query";
import { runJudgedPath } from "@/fixtures/harness";
import { SqliteGraphStore } from "@/server/graph-store";
import type { FamilyQuerySource } from "@/lib/knowledge/family-query";
import type { GraphData, Provenance } from "@/lib/graph/types";
import { setupFromPreferences } from "@/lib/onboarding/form";

let root: string, household: string, member: string, cookie: string, patient: string;
const context = { params: Promise.resolve({ path: ["graph-query"] }) };
const request = (body: unknown, auth = cookie, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/circle/graph-query", {
  method: "POST", headers: { Origin: origin, Cookie: auth, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const ask = (question = "What happened in Cape May?") => POST(request({ question }), context);
const source: FamilyQuerySource = { id: "known", kind: "story", title: "Cape May", text: "We built a sandcastle beside the pier.", attribution: "Maya", date: null, momentId: "moment-one" };

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), "recall-query-"));
  vi.stubEnv("RECALL_DATA_DIR", root);
  vi.stubEnv("RECALL_ONBOARDING_DB", path.join(root, "onboarding.db"));
  vi.stubEnv("RECALL_CIRCLE_DB", path.join(root, "circle.db"));
  for (const key of ["MUSE_API_KEY", "RECALL_OPERATOR_SECRET", "RECALL_FAMILY_SECRET"]) vi.stubEnv(key, "");
  vi.stubEnv("RECALL_FAMILY_CREDENTIALS", "{}");
  delete (globalThis as any).__recallOnboarding;
  const made = await getOnboarding().createHousehold({ participant: { display_name: "Susan", phone: "+15555550101" }, caregiver: { display_name: "Maya" } });
  household = made.household.household_id; member = made.caregiver.person_id; patient = made.participant.person_id;
  issueAccount(household, member, "family"); issueAccount(household, patient, "patient");
  cookie = sessionCookie({ role: "family", member_id: member }, request({}, "")).split(";")[0]!;
  updateCircle(household, state => {
    state.moments.push({ id: "moment-one", title: "Cape May summer", place: "Cape May", photoIds: [], coverId: "", startAt: "2025-07-20T00:00:00.000Z", endAt: null, latitude: null, longitude: null, people: ["Maya"], description: "", revision: 0, question: "", titleSource: "family", peopleCount: 1, analysis: "complete", participantIds: [], evidence: [] });
    state.stories.push({ id: "one", eventId: "moment-one", author: "Maya", owner: member, requestId: "one", text: source.text, source: "written", createdAt: "2025-07-21T00:00:00.000Z" });
    state.drafts = [{ id: "private-draft", owner: member, mime: "audio/wav", text: "SECRET_UNCONFIRMED_WORDS", createdAt: "2025-07-21T00:00:00.000Z" }];
  });
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); delete (globalThis as any).__recallOnboarding;
  rmSync(root, { recursive: true, force: true });
});

function provider(onRequest?: (payload: any) => void | Promise<void>, bad = false) {
  vi.stubEnv("MUSE_API_KEY", "test-server-only-key");
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const payload = JSON.parse(String(init.body));
    await onRequest?.(payload);
    const data = JSON.parse(payload.messages[1].content);
    const story = data.sources.find((s: FamilyQuerySource) => s.kind === "story") || data.sources[0];
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      answer: [{ text: "Maya shared a story about building a sandcastle.", citations: [{ sourceId: bad ? "foreign-source" : story.id, quote: story.text }] }],
      matches: [story.id], ideas: [{ question: "What comes to mind about that day?", sourceIds: [story.id] }],
    }) } }] }) };
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("family graph questions", () => {
  it("reads the agreed base graph before the first call without creating a graph database", async () => {
    const onboarding = getOnboarding();
    const setup = setupFromPreferences({ days: ["mon"], start: "09:00", end: "12:00", timezone: "UTC", max_minutes: 8,
      max_calls_per_week: 3, min_hours_between_calls: 24, pace: "standard", emergency_number: "911",
      saved_contact_name: "Recall", number_saved: true, photo_saved: true, introduced: true,
      dashboard: "weekly_note_and_record", patient_agreed: true, caregiver_agreed: true, expected_version: 0,
    }, { household, participant: patient, caregiver: member }, new Date().toISOString());
    await onboarding.recordJointSetup(household, setup, [patient, member], member);
    await onboarding.stateRelationship(household, { from_person_id: patient, to_person_id: member, relation: "child", said_as: "daughter" }, member);
    updateCircle(household, state => { state.stories = []; state.moments = []; });
    const graphPath = path.join(root, "recall-graph.db");
    expect(existsSync(graphPath)).toBe(false);
    const response = await ask("Who is Susan?"), body = await response.json();
    expect(response.status).toBe(200);
    expect(body.sources.some((item: FamilyQuerySource) => item.kind === "person" && item.title === "Susan")).toBe(true);
    expect(body.sources.some((item: FamilyQuerySource) => item.text === "Maya is Susan’s daughter.")).toBe(true);
    expect(existsSync(graphPath)).toBe(false);
  });
  it("answers a base graph question with cited connections before any story exists", async () => {
    updateCircle(household, state => { state.demo = true; state.stories = []; state.moments[0]!.title = "Home Garden Morning"; });
    const before = readCircle(household);
    vi.stubEnv("MUSE_API_KEY", "test-server-only-key");
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body)), data = JSON.parse(payload.messages[1].content);
      const sources = data.sources as FamilyQuerySource[];
      expect(sources.some(item => item.kind === "story")).toBe(false);
      expect(sources.filter(item => item.kind === "person").map(item => item.title).sort()).toEqual(["Anika", "Maya", "Priya", "Susan"]);
      const tie = sources.find(item => item.text === "Maya is Susan’s daughter.")!;
      expect(tie.attribution).toBe("Fictional sample family connections");
      const link = sources.find(item => item.text.startsWith("The family graph connects Susan to"))!;
      expect(link.momentId).toBe("moment-one");
      expect(payload.messages[0].content).toContain("even when no story exists");
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({
        answer: [{ text: "In the sample family, Maya is Susan’s daughter.", citations: [{ sourceId: tie.id, quote: tie.text }] }], matches: [tie.id], ideas: [],
      }) } }] }) };
    });
    vi.stubGlobal("fetch", fetch);
    const response = await ask("How are Susan and Maya related?"), body = await response.json();
    expect(response.status).toBe(200);
    expect(body.answer[0].text).toBe("In the sample family, Maya is Susan’s daughter.");
    expect(body.sources[0].kind).toBe("relationship");
    expect(readCircle(household)).toEqual(before);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("searches people, locations, and photo-group links without stories or a Muse key", async () => {
    updateCircle(household, state => { state.stories = []; });
    const response = await ask("Maya"), body = await response.json();
    expect(body.mode).toBe("search");
    expect(body.sources.some((item: FamilyQuerySource) => item.kind === "person" && item.title === "Maya")).toBe(true);
    expect(body.sources.some((item: FamilyQuerySource) => item.kind === "relationship" && item.momentId === "moment-one")).toBe(true);
    const places = await (await ask("Cape May")).json();
    expect(places.sources.some((item: FamilyQuerySource) => item.kind === "place" && item.title === "Cape May")).toBe(true);
    expect(JSON.stringify(body)).not.toContain("Fictional");
  });
  it("includes graph links beyond the first four displayed moments and does not invent attendance", () => {
    const state = readCircle(household); state.stories = [];
    state.moments = Array.from({ length: 6 }, (_, index) => ({ ...state.moments[0]!, id: `moment-${index}`, title: `Moment ${index}`, people: [index === 5 ? "Priya" : "Maya"] }));
    const sources = projectCollectionGraph(state);
    const link = sources.find(item => item.kind === "relationship" && item.title === "Priya & Moment 5")!;
    expect(link.momentId).toBe("moment-5");
    expect(link.text).toContain("does not establish that they attended");
    expect(sources.filter(item => item.kind === "place")).toHaveLength(1);
    expect(sources.some(item => item.kind === "story")).toBe(false);
  });
  it("uses Muse with a bounded household projection and validates the cited result without writing memories", async () => {
    const before = readCircle(household);
    const fetch = provider(payload => {
      expect(payload.model).toBe("muse-spark-1.3");
      expect(payload.response_format.type).toBe("json_schema");
      expect(JSON.stringify(payload)).not.toContain("SECRET_UNCONFIRMED_WORDS");
      expect(JSON.stringify(payload)).not.toContain("+15555550101");
      expect(JSON.stringify(payload)).not.toContain("test-server-only-key");
    });
    const response = await ask(), body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toMatchObject({ mode: "muse", answer: [{ citations: [{ quote: source.text }] }], ideas: [{ question: "What comes to mind about that day?" }] });
    expect(body.sources[0]).toMatchObject({ text: source.text, momentId: "moment-one", attribution: "Maya · shared story" });
    expect(readCircle(household)).toEqual(before);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("offers honest source-only search when Muse is not configured", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const response = await ask("sandcastle"), body = await response.json();
    expect(body).toMatchObject({ mode: "search", answer: [], ideas: [], sources: [{ text: source.text }] });
    expect(fetch).not.toHaveBeenCalled();
    expect((await (await ask("spaceship")).json()).sources).toEqual([]);
  });
  it("rejects anonymous, patient, cross-origin, and caller-selected household requests", async () => {
    const fetch = provider();
    const patientCookie = sessionCookie({ role: "patient", member_id: patient }, request({})).split(";")[0]!;
    expect((await POST(request({ question: "Cape May" }, ""), context)).status).toBe(401);
    expect((await POST(request({ question: "Cape May" }, patientCookie), context)).status).toBe(403);
    expect((await POST(request({ question: "Cape May" }, cookie, "https://other.test"), context)).status).toBe(403);
    expect((await POST(request({ question: "Cape May", household: "foreign" }), context)).status).toBe(400);
    expect((await ask("x".repeat(601))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("never sends another household or a cached unshared call story to Muse", async () => {
    updateCircle("other-household", state => { state.stories.push({ ...readCircle(household).stories[0]!, text: "FOREIGN_PRIVATE_STORY" }); });
    updateCircle(household, state => { state.stories.push({ ...state.stories[0]!, id: "cached", sharedFromCall: "unverified", text: "UNSHARED_PATIENT_WORDS" }); });
    provider(payload => { expect(JSON.stringify(payload)).not.toMatch(/FOREIGN_PRIVATE_STORY|UNSHARED_PATIENT_WORDS|SECRET_UNCONFIRMED_WORDS/); });
    expect((await ask()).status).toBe(200);
  });
  it("discards an answer after credential revocation while Muse was running", async () => {
    provider(() => revokeAccount(member));
    const response = await ask();
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain(source.text);
  });
  it("discards an answer after a story is deleted or edited during retrieval", async () => {
    provider(() => updateCircle(household, state => { state.stories = []; }));
    const response = await ask();
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain(source.text);
  });
  it("discards an answer when a base graph link changes during retrieval", async () => {
    updateCircle(household, state => { state.stories = []; });
    provider(() => updateCircle(household, state => { state.moments[0]!.people = ["Priya"]; }));
    expect((await ask("Who is connected to Cape May?")).status).toBe(409);
  });
  it("rejects invented citations and provider failures without echoing private errors", async () => {
    provider(undefined, true);
    expect((await ask()).status).toBe(502);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("SECRET_PROVIDER_PAYLOAD")));
    const response = await ask();
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("SECRET_PROVIDER_PAYLOAD");
  });
  it("requires exact evidence quotes and known sources for answers and ideas", () => {
    const answer = queryAnswerSchema.parse({ answer: [{ text: "A shared story.", citations: [{ sourceId: "known", quote: source.text }] }], matches: [], ideas: [] });
    expect(validateQueryAnswer(answer, [source]).sources).toEqual([source]);
    answer.answer[0]!.citations[0]!.quote = "She went sailing in Spain.";
    expect(() => validateQueryAnswer(answer, [source])).toThrow("Unsupported citation");
    expect(() => validateQueryAnswer({ answer: [], matches: [], ideas: [{ question: "A question?", sourceIds: ["unknown"] }] }, [source])).toThrow("Unknown source");
    expect(() => validateQueryAnswer({ answer: [], matches: [], ideas: [{ question: "Is her memory getting worse?", sourceIds: ["known"] }] }, [source])).toThrow("Unsupported generated language");
  });
  it("ranks names and places across graph source labels and original words", () => {
    expect(rankQuerySources("Cape May", [{ ...source, id: "library", title: "Library", text: "Books" }, source])[0]!.source.id).toBe("known");
  });
});

function addBaseFacts(graph: GraphData, prov: Provenance) {
  graph.nodes.push(
    { id: "place:garden", type: "Place", label: "Maple Garden", props: { aliases: [] }, prov: structuredClone(prov) },
    { id: "event:reunion", type: "Event", label: "Family reunion", props: { date: "2025-07-20", wikidata_id: null }, prov: structuredClone(prov) },
  );
  graph.edges.push(
    { id: "edge:reunion-place", type: "RELATED_TO", from: "event:reunion", to: "place:garden", props: { relation: "took_place_at" }, prov: structuredClone(prov) },
    { id: "edge:susan-place", type: "RELATED_TO", from: "person:susan", to: "place:garden", props: { relation: "visited" }, prov: structuredClone(prov) },
  );
}

describe("base graph projection", () => {
  it("exposes sourced people, places, events and directional links without story claims", async () => {
    const run = await runJudgedPath(), graph = await run.graph.snapshot(), policy = run.setup.current();
    graph.nodes = graph.nodes.filter(node => !["EpisodicClaim", "Contribution", "Story"].includes(node.type));
    addBaseFacts(graph, graph.nodes.find(node => node.id === "person:susan")!.prov);
    const sources = projectGraphSources(graph, policy, "person:maya", emptyCircle(), run.clock.iso());
    expect(sources.some(item => item.kind === "person" && item.title === "Susan")).toBe(true);
    expect(sources.some(item => item.kind === "event" && item.text.includes("2025-07-20"))).toBe(true);
    expect(sources.some(item => item.kind === "place" && item.title === "Maple Garden")).toBe(true);
    expect(sources.some(item => item.text === "Family reunion took place at Maple Garden.")).toBe(true);
    expect(sources.some(item => item.text === "Susan visited Maple Garden.")).toBe(true);
    expect(sources.some(item => item.kind === "story")).toBe(false);
  });
  it("supports the member's confirmed graph contributions without exposing another member's contributions", async () => {
    const run = await runJudgedPath(), graph = await run.graph.snapshot(), policy = run.setup.current();
    const prov: Provenance = { ...structuredClone(graph.nodes.find(node => node.id === "person:susan")!.prov), source_class: "family_contribution", source_id: "artifact:base-facts", author: "person:maya" };
    graph.nodes.push({ id: prov.source_id, type: "Artifact", label: "Named places", props: { kind: "answer", text: "Maple Garden", alt: null }, prov: structuredClone(prov) });
    addBaseFacts(graph, prov);
    expect(projectGraphSources(graph, policy, "person:maya", emptyCircle(), run.clock.iso()).some(item => item.text === "Susan visited Maple Garden.")).toBe(true);
    for (const record of [...graph.nodes, ...graph.edges]) if (record.prov.source_id === prov.source_id) record.prov.author = "person:priya";
    expect(JSON.stringify(projectGraphSources(graph, policy, "person:maya", emptyCircle(), run.clock.iso()))).not.toContain("Maple Garden");
  });
  it("keeps private patient-derived, inferred, stale, contradicted and unsupported facts out of base sources", async () => {
    const run = await runJudgedPath(), graph = await run.graph.snapshot(), policy = run.setup.current();
    const prov: Provenance = { ...structuredClone(graph.nodes.find(node => node.id === "person:susan")!.prov), source_id: "artifact:base-facts" };
    graph.nodes.push({ id: prov.source_id, type: "Artifact", label: "Base setup facts", props: { kind: "setup_record", text: null, alt: null }, prov: structuredClone(prov) });
    addBaseFacts(graph, prov);
    for (const change of [
      { status: "inferred" as const }, { status: "disputed" as const }, { audience_scope: [] }, { expires_at: "2020-01-01T00:00:00.000Z" },
      { contradicts: ["conflict"] }, { author: "person:stranger" },
      { source_class: "recall_call" as const, author: policy.person_id, status: "participant_confirmed" as const, patient_confirmed: true },
      { source_class: "prior_claim_with_source" as const, author: policy.person_id, status: "participant_confirmed" as const, patient_confirmed: true },
    ]) {
      const altered = structuredClone(graph);
      for (const record of [...altered.nodes, ...altered.edges]) if (record.prov.source_id === prov.source_id) Object.assign(record.prov, change);
      expect(JSON.stringify(projectGraphSources(altered, policy, "person:maya", emptyCircle(), run.clock.iso())), JSON.stringify(change)).not.toContain("Maple Garden");
    }
    graph.nodes = graph.nodes.filter(node => node.id !== prov.source_id);
    expect(JSON.stringify(projectGraphSources(graph, policy, "person:maya", emptyCircle(), run.clock.iso()))).not.toContain("Maple Garden");
  });
  it("honors blocked entities, blocked terms, access revocation and invalid relation endpoints", async () => {
    const run = await runJudgedPath(), graph = await run.graph.snapshot(), policy = run.setup.current();
    addBaseFacts(graph, graph.nodes.find(node => node.id === "person:susan")!.prov);
    const blocked = structuredClone(policy); blocked.topics.block.push("place:garden");
    expect(JSON.stringify(projectGraphSources(graph, blocked, "person:maya", emptyCircle(), run.clock.iso()))).not.toContain("Maple Garden");
    const blockedTerm = structuredClone(policy); blockedTerm.blocked_terms.push("Maple");
    expect(JSON.stringify(projectGraphSources(graph, blockedTerm, "person:maya", emptyCircle(), run.clock.iso()))).not.toContain("Maple Garden");
    const revoked = structuredClone(policy); revoked.dashboard.grants = [];
    expect(projectGraphSources(graph, revoked, "person:maya", emptyCircle(), run.clock.iso())).toEqual([]);
    graph.edges.find(edge => edge.id === "edge:susan-place")!.props.relation = "child";
    expect(projectGraphSources(graph, policy, "person:maya", emptyCircle(), run.clock.iso()).some(item => item.text.includes("Susan’s child"))).toBe(false);
    const evidence = graph.nodes.find(node => node.id === graph.nodes.find(node => node.id === "place:garden")!.prov.source_id)!;
    evidence.prov.author = "person:stranger";
    expect(JSON.stringify(projectGraphSources(graph, policy, "person:maya", emptyCircle(), run.clock.iso()))).not.toContain("Maple Garden");
  });
});

describe("shared call graph projection", () => {
  it("changes the client revision on graph-only permission revocation, while unchanged polls are stable", async () => {
    const run = await runJudgedPath(), policy = structuredClone(run.setup.current());
    policy.approved_people.push(member);
    policy.dashboard.grants = policy.dashboard.grants.map(grant => ({ ...grant, member_id: member }));
    const database = new SqliteGraphStore(path.join(root, "recall-graph.db"), household, false);
    try { await database.seed(await run.graph.snapshot()); } finally { database.close(); }
    vi.spyOn(getOnboarding(), "currentSetup").mockImplementation(async () => ({ household_id: household, version: 1, kind: "joint", document: policy,
      agreed_by: [member], recorded_by: member, recorded_at: run.clock.iso(), note: null }));
    const state = async () => {
      const response = await GET(new Request("http://localhost:3000/api/circle/state", { headers: { Cookie: cookie } }), { params: Promise.resolve({ path: ["state"] }) });
      expect(response.status).toBe(200);
      return response.json();
    };
    const before = await state();
    expect(before.graphQueryRevision).toMatch(/^[a-f0-9]{64}$/);
    expect((await state()).graphQueryRevision).toBe(before.graphQueryRevision);
    policy.dashboard.grants = [];
    const after = await state();
    expect(after.graphQueryRevision).not.toBe(before.graphQueryRevision);
    expect(after.moments).toEqual(before.moments);
    expect(after.stories).toEqual(before.stories);
  });
  it.each(["ShareConfirmation", "SHARE_CONFIRMED_BY", "DERIVED_FROM"])("rejects an invalid %s receipt or link", async target => {
    const run = await runJudgedPath(), graph = await run.graph.snapshot(), policy = run.setup.current();
    for (const change of [
      { status: "disputed" as const }, { audience_scope: [] }, { contradicts: ["conflicting-receipt"] },
      { expires_at: "2020-01-01T00:00:00.000Z" }, { author: "person:maya" },
    ]) {
      const altered = structuredClone(graph);
      const records = target === "ShareConfirmation" ? altered.nodes.filter(node => node.type === target) : altered.edges.filter(edge => edge.type === target);
      expect(records.length).toBeGreaterThan(0);
      for (const record of records) Object.assign(record.prov, change);
      expect(projectGraphSources(altered, policy, "person:maya", emptyCircle(), run.clock.iso())
        .some(source => source.attribution.includes("shared Recall call")), `${target}: ${JSON.stringify(change)}`).toBe(false);
    }
  });
  it("exposes only confirmed shared words and excludes call records, private claims, and another member's accounts", async () => {
    const run = await runJudgedPath(), graph = await run.graph.snapshot(), policy = run.setup.current();
    const sources = projectGraphSources(graph, policy, "person:maya", emptyCircle(), run.clock.iso());
    expect(sources.some(source => source.text === "We went to Cape May every summer.")).toBe(true);
    expect(sources.every(source => ["person", "place", "event", "story", "relationship"].includes(source.kind))).toBe(true);
    expect(JSON.stringify(sources)).not.toContain("literal_transcript");
    expect(projectGraphSources(graph, policy, "person:stranger", emptyCircle(), run.clock.iso())).toEqual([]);
    for (const share of graph.nodes) if (share.type === "ShareConfirmation") share.props.decision = "no";
    expect(projectGraphSources(graph, policy, "person:maya", emptyCircle(), run.clock.iso()).some(source => source.attribution.includes("shared Recall call"))).toBe(false);
  });
  it("honors revoked dashboard access, blocked topics, mismatched confirmations and deleted shared stories", async () => {
    const run = await runJudgedPath(), graph = await run.graph.snapshot(), policy = run.setup.current();
    const revoked = structuredClone(policy); revoked.dashboard.grants = [];
    expect(projectGraphSources(graph, revoked, "person:maya", emptyCircle(), run.clock.iso())).toEqual([]);
    const blocked = structuredClone(policy); blocked.topics.block.push(...blocked.topics.allow);
    expect(projectGraphSources(graph, blocked, "person:maya", emptyCircle(), run.clock.iso()).some(source => source.attribution.includes("shared Recall call"))).toBe(false);
    const contribution = graph.nodes.find(node => node.type === "Contribution")!;
    const state = emptyCircle(); state.demoCall = { topics: {}, sharedContributions: [contribution.id] };
    expect(projectGraphSources(graph, policy, "person:maya", state, run.clock.iso()).some(source => source.attribution.includes("shared Recall call"))).toBe(false);
    for (const share of graph.nodes) if (share.type === "ShareConfirmation") share.props.contribution_hash = "mismatched";
    expect(projectGraphSources(graph, policy, "person:maya", emptyCircle(), run.clock.iso()).some(source => source.attribution.includes("shared Recall call"))).toBe(false);
  });
});
