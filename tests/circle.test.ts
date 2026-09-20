import {tickCircleReminders} from '@/server/circle/messages';
import {
  beforeAll,
  afterAll,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { getOnboarding, newInvitationToken } from "@/server/onboarding";
import { accountForMember, issueAccount, revokeAccount } from "@/server/accounts";
import { sessionCookie, sameOrigin } from "@/server/session";
import {
  circleIdentity,
  saveLogin,
  passwordPrincipal,
  createLink,
  claimLink,
  readLink,
  digest,
} from "@/server/circle/access";
import {
  withCircleDb,
  updateCircle,
  readCircle,
  emptyCircle,
  type CirclePhoto,
} from "@/server/circle/store";
import { fallbackGroups, mergeGroups, uploadPhotos } from "@/server/circle/photos";
import { analyzePhotos } from "@/server/circle/ai";
import { GET, POST } from "@/app/api/circle/[...path]/route";
const root = mkdtempSync(path.join(tmpdir(), "recall-circle-test-"));
let household = "",
  member = "",
  patient = "",
  other = "",
  cookie = "";
const request = (action: string, body?: unknown, auth = cookie) =>
  new Request("http://localhost:3000/api/circle/" + action, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: "http://localhost:3000",
      Cookie: auth,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const context = (action: string) => ({
  params: Promise.resolve({ path: action.split("/") }),
});
beforeAll(async () => {
  vi.stubEnv("RECALL_DATA_DIR", root);
  vi.stubEnv("RECALL_CIRCLE_DB", path.join(root, "circle.db"));
  vi.stubEnv("RECALL_ONBOARDING_DB", path.join(root, "onboarding.db"));
  delete (globalThis as any).__recallOnboarding;
  const made = await getOnboarding().createHousehold({
    participant: { display_name: "Susan Test", phone: "+15555550101" },
    caregiver: { display_name: "Maya Test" },
  });
  household = made.household.household_id;
  member = made.caregiver.person_id;
  patient = made.participant.person_id;
  issueAccount(household, member, "family");
  cookie = sessionCookie(
    { role: "family", member_id: member },
    request("state"),
  ).split(";")[0]!;
  const second = await getOnboarding().createHousehold({
    participant: { display_name: "Other", phone: "+15555550102" },
    caregiver: { display_name: "Other organizer" },
  });
  other = second.household.household_id;
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  vi.unstubAllEnvs();
  delete (globalThis as any).__recallOnboarding;
  rmSync(root, { recursive: true, force: true });
});
describe("private photo-first collection", () => {
  it("keeps password hashes private and authenticates exact passwords", async () => {
    await saveLogin(member, "MAYA@example.test", "test password 123 ");
    expect(
      await passwordPrincipal("maya@example.test", "test password 123 "),
    ).toMatchObject({ member_id: member });
    await expect(
      passwordPrincipal("maya@example.test", "wrong"),
    ).rejects.toThrow("doesn’t match");
    const row = withCircleDb((db) =>
      db.prepare("SELECT * FROM logins").get(),
    ) as any;
    expect(row.password).not.toContain("test password");
    expect(row.salt).toHaveLength(32);
  });
  it("isolates collections and rejects anonymous reads", async () => {
    updateCircle(household, (s) => {
      s.demo = true;
    });
    expect(readCircle(other).demo).toBe(false);
    expect(
      (await GET(request("state", undefined, ""), context("state"))).status,
    ).toBe(401);
    expect(await circleIdentity(request("state"))).toMatchObject({
      household,
      canManage: true,
    });
  });
  it("validates browser host even when Next normalizes its internal URL", () => {
    expect(
      sameOrigin(
        new Request("http://localhost:3000/x", {
          headers: { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" },
        }),
      ),
    ).toBe(true);
    expect(
      sameOrigin(
        new Request("http://localhost:3000/x", {
          headers: { origin: "https://evil.test", host: "localhost:3000" },
        }),
      ),
    ).toBe(false);
  });
  it("rejects cross-origin mutations", async () => {
    const r = new Request("http://localhost:3000/api/circle/preferences", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://evil.test" },
      body: "{}",
    });
    expect((await POST(r, context("preferences"))).status).toBe(403);
  });
  it("accepts a family invitation once, with no access key and no default reminders", async () => {
    const invitation = newInvitationToken();
    await getOnboarding().invite(
      household,
      { display_name: "Priya Test", role: "family" },
      member,
      invitation.token_hash,
    );
    const token = createLink({
      household,
      member: null,
      invitation: invitation.token_hash,
      name: "Priya Test",
      phone: "+15555550103",
      role: "family",
      destination: "/caregiver",
    });
    expect(readLink(token).used).toBeNull();
    const result = await claimLink(token, false);
    expect(result.destination).toBe("/caregiver");
    expect(result.principal.role).toBe("family");
    expect(() => readLink(token)).toThrow("expired");
    const contact = withCircleDb((db) =>
      db
        .prepare("SELECT reminders FROM contacts WHERE member=?")
        .get(result.principal.member_id),
    ) as any;
    expect(contact.reminders).toBe(0);
  });
  it("expires links and opens the patient view with a scoped session", async () => {
    const args = {
      household,
      member: patient,
      invitation: null,
      name: "Susan Test",
      phone: null,
      role: "patient" as const,
      destination: "/revisit",
    };
    const expired = createLink(args, -1);
    expect(() => readLink(expired)).toThrow("expired");
    const token = createLink(args);
    const opened = await claimLink(token, false);
    expect(opened).toMatchObject({
      destination: "/revisit",
      principal: { role: "patient", member_id: patient },
    });
  });
  it("groups dates only when locations agree; undated photos are never fused blindly", () => {
    const p = (id: string, date: string | null, lat: number): CirclePhoto => ({
      id,
      name: id,
      url: id,
      hash: id,
      owner: member,
      contributor: "Maya",
      capturedAt: date,
      addedAt: "2026-01-01",
      latitude: lat,
      longitude: 0,
      namedPeople: [],
    });
    const groups = fallbackGroups([
      p("1", "2025-01-01T12:00Z", 0),
      p("2", "2025-01-01T13:00Z", 0),
      p("3", "2025-01-01T13:00Z", 45),
      p("4", null, 0),
      p("5", null, 0),
    ]);
    expect(groups.map((g) => g.photoIds)).toEqual([
      ["1", "2"],
      ["3"],
      ["4"],
      ["5"],
    ]);
  });
  it("preserves photos through AI failure, skips duplicates, rejects corrupt files and retries idempotently", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const bytes = await sharp({
      create: { width: 12, height: 12, channels: 3, background: "#345d39" },
    })
      .jpeg()
      .toBuffer();
    const file = new File([bytes], "garden.jpg", { type: "image/jpeg" });
    const receipt = await uploadPhotos(
      household,
      member,
      "Maya",
      [file, file, new File(["bad"], "bad.jpg")],
      "test-import",
    );
    expect(receipt).toMatchObject({ added: 1, duplicates: 1, moments: 1 });
    expect(receipt.rejected).toHaveLength(1);
    expect(receipt.warning).toContain("photos are safe");
    const retry = await uploadPhotos(
      household,
      member,
      "Maya",
      [file],
      "test-import",
    );
    expect(retry.added).toBe(1);
    expect(readCircle(household).photos).toHaveLength(1);
    expect(
      (await uploadPhotos(household, member, "Maya", [file], "new-import"))
        .duplicates,
    ).toBe(1);
  });
  it("rejects AI output that omits or duplicates a photograph", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          output: [
            {
              content: [
                { type: "output_text", text: JSON.stringify({ groups: [] }) },
              ],
            },
          ],
        }),
      ),
    );
    const bytes = await sharp({
      create: { width: 12, height: 12, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer();
    await expect(
      analyzePhotos([
        { id: "1", bytes, capturedAt: null, latitude: null, longitude: null },
      ]),
    ).rejects.toThrow("grouping needs another pass");
  });
  it("saves original stories once, without claiming the writer was in the photo", async () => {
    const moment = readCircle(household).moments[0]!;
    const body = {
      momentId: moment.id,
      text: "Test story, unchanged.",
      requestId: "story-once",
      confirmed: true,
    };
    const one = await POST(request("story", body), context("story"));
    expect(one.status).toBe(200);
    await POST(request("story", body), context("story"));
    const state = readCircle(household);
    expect(state.stories).toHaveLength(1);
    expect(state.stories[0]!.text).toBe(body.text);
    expect(state.moments[0]!.participantIds).toEqual([]);
  });
  it("blocks stale moment edits and cross-household media reads", async () => {
    const state = readCircle(household),
      moment = state.moments[0]!;
    const stale = await POST(
      request("moment", {
        id: moment.id,
        title: "A better title",
        people: [],
        revision: -1,
      }),
      context("moment"),
    );
    expect(stale.status).toBe(409);
    const otherMember = (await getOnboarding().people(other)).find(
      (p) => p.role === "caregiver",
    )!.person_id;
    issueAccount(other, otherMember, "family");
    const otherCookie = sessionCookie(
      { role: "family", member_id: otherMember },
      request("state"),
    ).split(";")[0]!;
    const action = "media/" + state.photos[0]!.id;
    expect(
      (await GET(request(action, undefined, otherCookie), context(action)))
        .status,
    ).toBe(404);
  });
  it("invalidates a browser session when its account is revoked", async () => {
    const token = createLink({
      household,
      member: patient,
      invitation: null,
      name: "Susan",
      phone: null,
      role: "patient",
      destination: "/revisit",
    });
    const result = await claimLink(token, false);
    const patientCookie = sessionCookie(
      result.principal,
      request("state"),
    ).split(";")[0]!;
    revokeAccount(patient);
    await expect(
      circleIdentity(request("state", undefined, patientCookie)),
    ).rejects.toThrow("Sign in");
  });

  it('combines later family uploads by capture time and GPS even when suggested titles differ',()=>{
    const state=emptyCircle();const photo=(id:string):CirclePhoto=>({id,name:id,url:id,hash:id,owner:member,contributor:'Maya',capturedAt:'2025-07-01T12:00:00Z',addedAt:'2026-01-01',latitude:40,longitude:-74,namedPeople:[]});
    const one=photo('one'),two=photo('two');state.photos.push(one,two);
    const group=(id:string,title:string)=>({photoIds:[id],title,description:'An afternoon outside.',place:'Garden',question:'What comes to mind?',peopleCount:0,captions:[]});
    mergeGroups(state,[group('one','Garden Afternoon')],[one],true);
    mergeGroups(state,[group('two','Flowers by the House')],[two],true);
    expect(state.moments).toHaveLength(1);expect(state.moments[0]!.photoIds).toEqual(['one','two']);
  });

  it('sends only opted-in, explicitly connected reminders and claims a due item only once',async()=>{
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-20T16:00:00Z'));
    vi.stubEnv('LINQ_API_KEY','test-linq');vi.stubEnv('RECALL_PUBLIC_URL','https://recall.example.test');
    const contact=withCircleDb(db=>db.prepare('SELECT member FROM contacts LIMIT 1').get()) as {member:string};
    const mock=vi.fn().mockResolvedValue(new Response('{}',{status:202}));vi.stubGlobal('fetch',mock);
    try{
      updateCircle(household,s=>{s.demo=false;s.moments[0]!.participantIds=[contact.member];});
      withCircleDb(db=>db.prepare('UPDATE contacts SET next_at=?,reminders=0,paused=0').run(Date.now()-1000));
      expect((await tickCircleReminders()).sent).toBe(0);
      withCircleDb(db=>db.prepare('UPDATE contacts SET reminders=1').run());
      expect((await tickCircleReminders()).sent).toBe(1);expect((await tickCircleReminders()).sent).toBe(0);expect(mock).toHaveBeenCalledTimes(1);
      const sent=JSON.parse(mock.mock.calls[0]![1].body);expect(sent.to).toEqual(['+15555550103']);expect(sent.message.parts[0].value).toContain('/open#');
    }finally{vi.useRealTimers();updateCircle(household,s=>{s.demo=true;});}
  });

  it("does not let pending links restore revoked or rotated account access", async () => {
    const args = { household, member: patient, invitation: null, name: "Susan", phone: null, role: "patient" as const, destination: "/revisit" };
    const revoked = createLink(args);
    revokeAccount(patient);
    await expect(claimLink(revoked)).rejects.toThrow("access has changed");
    expect(accountForMember(patient)).toBeUndefined();
    const rotated = createLink(args);
    issueAccount(household, patient, "patient");
    await expect(claimLink(rotated)).rejects.toThrow("access has changed");
    expect((await claimLink(createLink(args))).principal.member_id).toBe(patient);
  });

  it("preserves reminder consent when a returning link does not change preferences", async () => {
    const contact = withCircleDb(db => db.prepare("SELECT member,phone FROM contacts LIMIT 1").get()) as { member: string; phone: string };
    withCircleDb(db => db.prepare("UPDATE contacts SET reminders=1 WHERE member=?").run(contact.member));
    const args = { household, member: contact.member, invitation: null, name: "Priya", phone: contact.phone, role: "family" as const, destination: "/caregiver" };
    const token = createLink(args);
    const preview = await POST(request("link", { token }), context("link"));
    expect(await preview.json()).toMatchObject({ reminders: true });
    await claimLink(token);
    const preferences = () => withCircleDb(db => db.prepare("SELECT reminders FROM contacts WHERE member=?").get(contact.member)) as { reminders: number };
    expect(preferences().reminders).toBe(1);
    await claimLink(createLink(args), false);
    expect(preferences().reminders).toBe(0);
  });

  it("does not text or restore a revoked member through reminders or phone sign-in", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-20T16:00:00Z"));
    const contact = withCircleDb(db => db.prepare("SELECT member,phone FROM contacts LIMIT 1").get()) as { member: string; phone: string };
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    try {
      revokeAccount(contact.member);
      updateCircle(household, s => { s.demo = false; s.moments[0]!.participantIds = [contact.member]; });
      withCircleDb(db => db.prepare("UPDATE contacts SET next_at=?,reminders=1,paused=0,last_moment=NULL WHERE member=?").run(Date.now()-1000, contact.member));
      expect((await tickCircleReminders()).sent).toBe(0);
      expect((await POST(request("phone-sign-in", { phone: contact.phone }, ""), context("phone-sign-in"))).status).toBe(200);
      expect(send).not.toHaveBeenCalled();
      expect(accountForMember(contact.member)).toBeUndefined();
    } finally { vi.useRealTimers(); updateCircle(household, s => { s.demo = true; }); }
  });
});
