/** Local rehearsal transport. The real call engine and confirmation gates use the sample household's durable graph. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setupFromPreferences } from "@/lib/onboarding/form";
import { dashboardAccess, type AccessPolicy } from "@/lib/tools/policy";
import { edgeId, sessionIdAt } from "@/lib/graph/seed";
import DEMO from "@/fixtures/sample-family-demo.json";
import { getOnboarding } from "./onboarding";
import { createLiveRecall, type LiveRecall } from "./recall-live";
import { dataDirectory } from "./data-directory";
import { CircleError, readCircle, updateCircle, type CircleState, type CircleMoment } from "./circle/store";
import { sampleDemoMoments } from "./circle/sample";
import { mediaFolder } from "./circle/photos";
import { createTopic } from "./topics";

const DAY = 86400000;

const cache = globalThis as typeof globalThis & { __sampleCalls?: Map<string, Promise<LiveRecall>>; __sampleWork?: Map<string, Promise<unknown>>; __sampleRunning?: Map<string, Promise<unknown>>; __sampleErrors?: Map<string, string> };
const keyFor = (household: string) => `${dataDirectory(process.cwd())}:${household}`;
function requireSample(household: string) {
  if (process.env.NODE_ENV !== "development" || !readCircle(household).demo) throw new CircleError("Open a local sample family first.", 403);
}
async function locked<T>(household: string, work: () => Promise<T>) {
  const jobs = cache.__sampleWork ??= new Map(), key = keyFor(household);
  const next = (jobs.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
  jobs.set(key, next);
  try { return await next; } finally { if (jobs.get(key) === next) jobs.delete(key); }
}
async function ensureSampleSetup(household: string) {
  requireSample(household);
  const onboarding = getOnboarding();
  if (await onboarding.currentSetup(household)) return;
  const people = await onboarding.people(household), participant = people.find(p => p.role === "participant")!, caregiver = people.find(p => p.role === "caregiver")!;
  const at = new Date().toISOString();
  const policy = setupFromPreferences({ days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], start: "00:00", end: "23:59", timezone: "America/New_York", max_minutes: 8, max_calls_per_week: 7, min_hours_between_calls: 24, pace: "standard", emergency_number: "911", saved_contact_name: "Recall (from Maya)", number_saved: false, photo_saved: false, introduced: true, dashboard: "weekly_note_and_record", patient_agreed: true, caregiver_agreed: true, expected_version: 0 }, { household, participant: participant.person_id, caregiver: caregiver.person_id }, at);
  policy.description = "Fictional sample setup for the local browser-call demo.";
  policy.calls_paused = false;
  policy.call_frequency = { max_calls_per_week: 1000, min_hours_between_calls: 0 };
  await onboarding.recordJointSetup(household, policy, [participant.person_id, caregiver.person_id], caregiver.person_id, "Fictional demo agreement; no real patient consent or external calls.");
}
export async function getSampleRecall(household: string): Promise<LiveRecall> {
  requireSample(household);
  const calls = cache.__sampleCalls ??= new Map(), key = keyFor(household);
  if (!calls.has(key)) calls.set(key, (async () => {
    await ensureSampleSetup(household);
    return createLiveRecall({ root: process.cwd(), household, onboardingDb: process.env.RECALL_ONBOARDING_DB, callMode: "web", sampleDemo: true });
  })().catch(error => { calls.delete(key); throw error; }));
  return calls.get(key)!;
}

/** One topic node per named photo group, reused by the call and by the fictional call history. */
async function ensureSampleTopic(live: LiveRecall, policy: AccessPolicy, household: string, moment: CircleMoment): Promise<string | null> {
  const known = readCircle(household).demoCall?.topics[moment.id];
  if (known) return known;
  const label = moment.title.replace(/[?!.{}\n\r]/g, "").split(/\s+/).slice(0, 8).join(" ").slice(0, 80).trim();
  if (!label) return null;
  const topic = await createTopic(live.graph, policy, { contributor_id: policy.recall_set_up_by, label, story: `Photographs from ${label}.` });
  updateCircle(household, current => {
    current.demoCall ??= { topics: {}, sharedContributions: [] };
    current.demoCall.topics[moment.id] = topic.id;
  });
  return topic.id;
}

/** Named sample photo groups become attributed photo cues, never patient-confirmed memories. */
export async function prepareSampleCall(household: string) {
  return locked(household, async () => {
    const live = await getSampleRecall(household);
    if (live.currentCall()) return live;
    await live.refreshSetup();
    const policy = live.setup.current(), state = readCircle(household);
    const topics = { ...state.demoCall?.topics };
    for (const moment of state.moments) {
      const photos = moment.photoIds.map(id => state.photos.find(photo => photo.id === id)).filter(photo => !!photo);
      if (!photos.length) continue;
      const made = await ensureSampleTopic(live, policy, household, moment);
      if (!made) continue;
      topics[moment.id] = made;
      const topicId = made, topic = (await live.graph.getNode(topicId))!;
      for (const photo of photos) {
        const artifactId = `artifact:sample-photo:${photo.id}:${topicId}`;
        if (await live.graph.getNode(artifactId)) continue;
        const bytes = await readFile(path.join(mediaFolder(household), photo.id + ".jpg"));
        const media = live.media!.make(bytes, policy.recall_set_up_by, "image/jpeg", null);
        const prov = { ...topic.prov, source_id: artifactId, asset_id: media.entry.id, media_hash: media.entry.sha256 };
        const write = async () => {
          await live.media!.save(media, true);
          await live.graph.putNode({ id: artifactId, type: "Artifact", label: "Sample family photograph", props: { kind: "photo", text: null, alt: topic.label }, prov });
          for (const [type, to] of [["DEPICTS", topicId], ["EVIDENCE_FOR", `claim:${topicId}`], ["PERMITTED_IN", policy.policy_id]] as const) await live.graph.putEdge({ id: edgeId(type, artifactId, to), type, from: artifactId, to, props: {}, prov });
        };
        if (live.graph.atomic) await live.graph.atomic(write); else await write();
      }
    }
    const current = readCircle(household);
    const allow = current.moments.filter(moment => moment.photoIds.length).flatMap(moment => topics[moment.id] ? [topics[moment.id]!] : []).sort();
    if (JSON.stringify([...policy.topics.allow].sort()) !== JSON.stringify(allow)) {
      const next = { ...policy, topics: { ...policy.topics, allow } };
      await getOnboarding().recordJointSetup(household, next, policy.established_by, policy.recall_set_up_by, "Photo topics for the fictional sample call.");
      await live.refreshSetup();
    }
    return live;
  });
}

/**
 * A fictional run of earlier calls for the sample family, so the session shelf, the per-topic record
 * and the doctor's copy have something in them before anyone rehearses a call. It writes the same
 * TopicOutcome nodes a real call would (AGENTS.md section 7) and nothing else: no transcript, no
 * contribution, no claim in her name. Sample households only, and once per photo group.
 */
export async function ensureSampleCallHistory(household: string) {
  const state = readCircle(household);
  if (!state.demo) return;
  const seeded = new Set(state.sampleHistory ?? []);
  // Oldest photo group first, so each group's calls sit a day apart on the shelf.
  const pending = sampleDemoMoments(state).sort((a, b) => (a.startAt ?? "").localeCompare(b.startAt ?? "") || a.id.localeCompare(b.id));
  if (pending.every(moment => seeded.has(moment.id))) return;
  await locked(household, async () => {
    const live = await getSampleRecall(household);
    await live.refreshSetup();
    const policy = live.setup.current();
    const done = new Set(readCircle(household).sampleHistory ?? []);
    const midnight = new Date();
    const anchor = Date.UTC(midnight.getUTCFullYear(), midnight.getUTCMonth(), midnight.getUTCDate(), DEMO.hour_utc);
    for (const [index, moment] of pending.entries()) {
      if (done.has(moment.id)) continue;
      const topicId = await ensureSampleTopic(live, policy, household, moment);
      const topic = topicId ? await live.graph.getNode(topicId) : null;
      if (!topicId || !topic) continue;
      done.add(moment.id);
      const rungs = DEMO.moments.find(entry => entry.title === moment.title)!.rungs as (number | null)[];
      for (const [call, rung] of rungs.entries()) {
        const at = new Date(anchor - index * DAY - (rungs.length - 1 - call) * DEMO.call_gap_days * DAY).toISOString();
        const sessionId = sessionIdAt(topicId, at), outcomeId = `outcome:${sessionId}`;
        if (await live.graph.getNode(outcomeId)) continue;
        const prov = { ...topic.prov, asset_id: null, media_hash: null, span: null, observed_at: at };
        const write = async () => {
          await live.graph.putNode({ id: sessionId, type: "Session", label: "Recall call", props: { topic_id: topicId, started_at: at, ended_at: at, outcome: rung === null ? "no_answer_today" : "stored" }, prov });
          // The ladder ends at rung 4 for an autobiographical topic (section 6.1), so an unreached call used 4.
          await live.graph.putNode({ id: outcomeId, type: "TopicOutcome", label: "Topic outcome", props: { session_id: sessionId, topic_id: topicId, first_rung_reached_unaided: rung, highest_rung_used: rung ?? 4, timestamp: at }, prov });
          await live.graph.putEdge({ id: edgeId("OUTCOME_OF", outcomeId, sessionId), type: "OUTCOME_OF", from: outcomeId, to: sessionId, props: {}, prov });
        };
        if (live.graph.atomic) await live.graph.atomic(write); else await write();
      }
    }
    updateCircle(household, current => { if (current.demo) current.sampleHistory = [...done]; });
  });
}

/** Only committed, explicitly shared literal words enter the caregiver's collection. */
export async function syncSampleSharedMemories(household: string) {
  requireSample(household);
  if (!readCircle(household).demoCall) return;
  const live = await getSampleRecall(household);
  await live.refreshSetup();
  const policy = live.setup.current();
  const read = async () => {
    const stories: CircleState["stories"] = [];
    const state = readCircle(household), byTopic = new Map(Object.entries(state.demoCall!.topics).map(([moment, topic]) => [topic, moment]));
    for (const contribution of await live.graph.nodesOfType("Contribution")) {
      const existing = state.stories.find(story => story.sharedFromCall === contribution.id);
      if ((state.demoCall!.sharedContributions.includes(contribution.id) && (!existing || existing.callEvidence)) || !contribution.props.shared || !contribution.prov.patient_confirmed || contribution.prov.author !== policy.person_id || contribution.prov.source_class !== "recall_call") continue;
      const edges = await live.graph.edgesOf(contribution.id);
      const shareEdge = edges.find(edge => edge.type === "SHARE_CONFIRMED_BY" && edge.from === contribution.id);
      const share = shareEdge ? await live.graph.getNode(shareEdge.to) : null;
      if (share?.type !== "ShareConfirmation" || share.props.decision !== "yes" || share.prov.author !== policy.person_id || share.props.contribution_hash !== contribution.props.content_hash) continue;
      const claimEdge = edges.find(edge => edge.type === "DERIVED_FROM" && edge.to === contribution.id);
      const claim = claimEdge ? await live.graph.getNode(claimEdge.from) : null;
      if (claim?.type !== "EpisodicClaim" || !claim.prov.patient_confirmed || claim.props.text !== contribution.props.literal_transcript) continue;
      const about = (await live.graph.edgesOf(claim.id)).find(edge => edge.type === "ABOUT" && edge.from === claim.id && byTopic.has(edge.to));
      const eventId = about && byTopic.get(about.to);
      if (!eventId || !state.moments.some(moment => moment.id === eventId) || !policy.topics.allow.includes(about!.to) || policy.topics.block.includes(about!.to)) continue;
      const person = await live.graph.getNode(policy.person_id);
      const author = person?.type === "Person" ? person.props.display_name : "Susan";
      stories.push({ id: `shared:${contribution.id}`, eventId, author, owner: policy.person_id, requestId: contribution.id, sharedFromCall: contribution.id, text: contribution.props.literal_transcript, source: "voice", createdAt: share.props.recorded_at, callEvidence: { edgeType: about!.type, properties: { ...about!.props }, source: "Shared Recall call", author, recordedAt: about!.prov.observed_at, status: about!.prov.status, shareConfirmedAt: share.props.recorded_at } });
    }
    return stories;
  };
  const stories = live.graph.atomic ? await live.graph.atomic(read) : await read();
  if (!stories.length) return;
  updateCircle(household, state => {
    if (!state.demo || !state.demoCall) return;
    for (const story of stories) {
      const moment = state.moments.find(moment => moment.id === story.eventId);
      const existing = state.stories.find(saved => saved.sharedFromCall === story.sharedFromCall);
      if (moment && existing) { existing.callEvidence = story.callEvidence; continue; }
      if (!moment || state.demoCall.sharedContributions.includes(story.sharedFromCall!)) continue;
      state.stories.push(story); state.demoCall.sharedContributions.push(story.sharedFromCall!); moment.revision++;
    }
  });
}
export async function visibleSampleStories(household: string, member: string, state: CircleState) {
  if (!state.stories.some(story => story.sharedFromCall)) return state.stories;
  const policy = (await getOnboarding().currentSetup(household))?.document;
  const allowed = policy && (member === policy.person_id || dashboardAccess(policy, member) !== null);
  return state.stories.filter(story => !story.sharedFromCall || allowed);
}
export const sampleCallError = (household: string) => cache.__sampleErrors?.get(keyFor(household));
export const sampleCallRunning = (household: string) => cache.__sampleRunning?.has(keyFor(household)) ?? false;
export async function startSampleCall(household: string) {
  requireSample(household);
  if (!process.env.DEEPGRAM_API_KEY) throw new CircleError("The demo voice connection needs a Deepgram API key.", 503);
  const running = cache.__sampleRunning ??= new Map(), errors = cache.__sampleErrors ??= new Map(), key = keyFor(household);
  if (running.has(key)) return;
  const live = await prepareSampleCall(household);
  if (running.has(key) || live.currentCall()) return;
  if (!live.setup.current().topics.allow.length) throw new CircleError("Add a photo group in the sample family before starting a call.", 409);
  errors.delete(key);
  const run = live.tick().then(() => syncSampleSharedMemories(household)).catch(() => { errors.set(key, "The sample call could not continue. Please start a new call."); }).finally(() => { running.delete(key); });
  running.set(key, run);
}
