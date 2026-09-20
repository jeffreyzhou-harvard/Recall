import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GET, POST } from "@/app/api/circle/[...path]/route";
import { getOnboarding } from "@/server/onboarding";
import { issueAccount, revokeAccount } from "@/server/accounts";
import { sessionCookie } from "@/server/session";
import { emptyCircle, readCircle, updateCircle } from "@/server/circle/store";
import { projectGraphStories, queryAnswerSchema, rankQuerySources, validateQueryAnswer } from "@/server/circle/graph-query";
import { runJudgedPath } from "@/fixtures/harness";
import { SqliteGraphStore } from "@/server/graph-store";
import type { FamilyQuerySource } from "@/lib/knowledge/family-query";

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
      expect(projectGraphStories(altered, policy, "person:maya", emptyCircle(), run.clock.iso())
        .some(source => source.attribution.includes("shared Recall call")), `${target}: ${JSON.stringify(change)}`).toBe(false);
    }
  });
  it("exposes only confirmed shared words and excludes call records, private claims, and another member's accounts", async () => {
    const run = await runJudgedPath(), graph = await run.graph.snapshot(), policy = run.setup.current();
    const sources = projectGraphStories(graph, policy, "person:maya", emptyCircle(), run.clock.iso());
    expect(sources.some(source => source.text === "We went to Cape May every summer.")).toBe(true);
    expect(sources.every(source => ["story", "relationship"].includes(source.kind))).toBe(true);
    expect(JSON.stringify(sources)).not.toContain("literal_transcript");
    expect(projectGraphStories(graph, policy, "person:stranger", emptyCircle(), run.clock.iso())).toEqual([]);
    for (const share of graph.nodes) if (share.type === "ShareConfirmation") share.props.decision = "no";
    expect(projectGraphStories(graph, policy, "person:maya", emptyCircle(), run.clock.iso()).some(source => source.attribution.includes("shared Recall call"))).toBe(false);
  });
  it("honors revoked dashboard access, blocked topics, mismatched confirmations and deleted shared stories", async () => {
    const run = await runJudgedPath(), graph = await run.graph.snapshot(), policy = run.setup.current();
    const revoked = structuredClone(policy); revoked.dashboard.grants = [];
    expect(projectGraphStories(graph, revoked, "person:maya", emptyCircle(), run.clock.iso())).toEqual([]);
    const blocked = structuredClone(policy); blocked.topics.block.push(...blocked.topics.allow);
    expect(projectGraphStories(graph, blocked, "person:maya", emptyCircle(), run.clock.iso()).some(source => source.attribution.includes("shared Recall call"))).toBe(false);
    const contribution = graph.nodes.find(node => node.type === "Contribution")!;
    const state = emptyCircle(); state.demoCall = { topics: {}, sharedContributions: [contribution.id] };
    expect(projectGraphStories(graph, policy, "person:maya", state, run.clock.iso()).some(source => source.attribution.includes("shared Recall call"))).toBe(false);
    for (const share of graph.nodes) if (share.type === "ShareConfirmation") share.props.contribution_hash = "mismatched";
    expect(projectGraphStories(graph, policy, "person:maya", emptyCircle(), run.clock.iso()).some(source => source.attribution.includes("shared Recall call"))).toBe(false);
  });
});
