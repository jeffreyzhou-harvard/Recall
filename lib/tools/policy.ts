/**
 * The joint setup: the one document she and her family agreed together, and
 * the pure functions that check a call, or a family view, against it
 * (AGENTS.md rules 5, 8, 12, 14, 15, 16).
 *
 * It is read fresh every time - `SetupStore.current()` - so a revocation takes
 * effect before the next call and before the next dashboard load.
 *
 * Policy fixtures define the safety gates; changes need a second reviewer
 * (AGENTS.md section 13).
 */
import { z } from "zod";
import { SOURCE_CLASSES } from "@/lib/graph/types";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const iso = z.iso.datetime();

export const DETAIL_LEVELS = ["weekly_note", "weekly_note_and_record"] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];

export const policySchema = z
  .strictObject({
    policy_id: z.string().min(1),
    version: z.literal(2),
    description: z.string(),
    person_id: z.string().min(1),
    established_by: z.array(z.string().min(1)).min(1),
    established_at: iso,
    /** The family member named in the first line of every call, and in the identity line (rule 16). */
    relay_set_up_by: z.string().min(1),
    /** Approved contributors: the only people who may tell Relay a memory, or be granted the family view. */
    approved_people: z.array(z.string()),
    /** Who a stored fact may be used with. For recall calls that is her, and only her. */
    approved_audiences: z.array(z.string()),
    timezone: z.string().min(1),
    call_windows: z.array(z.strictObject({ days: z.array(z.enum(DAYS)), start: hhmm, end: hhmm })),
    call_frequency: z.strictObject({ max_calls_per_week: z.number().int().positive(), min_hours_between_calls: z.number().int().nonnegative() }),
    /** Caregiver pause (rule 12). While true no call is placed, and a call already under way ends at once. */
    calls_paused: z.boolean(),
    topics: z.strictObject({
      allow: z.array(z.string()),
      block: z.array(z.string()),
      /** A Person is a topic only if the caregiver turns that on (section 6.1). */
      person_topics_enabled: z.boolean(),
    }),
    allowed_source_classes: z.array(z.enum(SOURCE_CLASSES)),
    blocked_terms: z.array(z.string()),
    /**
     * 10 minutes is a ceiling, not a target: 5-8 is the default to set (EVIDENCE.md, section E). `pace` is kept for
     * her comfort, but it is sentence length - not speed - that the evidence ties to being understood.
     */
    speech: z.strictObject({ pace: z.enum(["slow", "standard"]), max_call_minutes: z.number().int().positive().max(10) }),
    review: z.strictObject({ store_confirmation_required: z.literal(true), share_confirmation_required: z.literal(true) }),
    safety: z.strictObject({
      designated_caregivers: z.array(z.strictObject({ person_id: z.string().min(1), alert_channel: z.string().min(1) })).min(1),
      emergency_number: z.string().min(1),
    }),
    /** Rule 16: what a family member has attested before Relay's first call. `place_recall_call` refuses without every one of them. */
    attestations: z.strictObject({
      number_saved_in_her_phone: z.boolean(),
      saved_contact_name: z.string(),
      saved_contact_photo: z.boolean(),
      relay_introduced_to_her: z.boolean(),
      introduced_by: z.string().nullable(),
    }),
    dashboard: z.strictObject({
      grants: z.array(z.strictObject({ member_id: z.string().min(1), detail_level: z.enum(DETAIL_LEVELS), granted_at: iso, revoked_at: iso.nullable() })),
      reconfirm_every_days: z.number().int().positive(),
      last_reconfirmed_at: iso,
    }),
    token_ttl_minutes: z.number().int().positive(),
    /**
     * Learning her world from photos the family shares. Off unless the joint setup turned it on. Face
     * grouping and bulk photo-library ingestion are non-goals (section 14); this block only gates the
     * ask-don't-assert questions in lib/discovery.
     */
    discovery: z.strictObject({
      enabled: z.boolean(),
      photo_access_granted_by: z.array(z.string()),
      observe: z.strictObject({ faces: z.boolean(), places: z.boolean(), times: z.boolean(), themes: z.boolean() }),
      invite_her_confirmation: z.boolean(),
    }),
  })
  .refine((p) => p.established_by.includes(p.person_id), { message: "the joint setup is hers too: she must be one of the people who established it", path: ["established_by"] })
  .refine((p) => p.approved_people.includes(p.relay_set_up_by), { message: "the person named as having set Relay up must be an approved person", path: ["relay_set_up_by"] })
  .refine((p) => p.safety.designated_caregivers.every((c) => p.approved_people.includes(c.person_id)), { message: "designated caregivers must be approved people", path: ["safety", "designated_caregivers"] })
  .refine((p) => p.dashboard.grants.every((g) => p.approved_people.includes(g.member_id)), { message: "the family view can be granted to approved people only", path: ["dashboard", "grants"] })
  .refine((p) => p.discovery.photo_access_granted_by.every((g) => g === p.person_id || p.approved_people.includes(g)), {
    message: "photo access can only be granted by her or by an approved person",
    path: ["discovery", "photo_access_granted_by"],
  });
export type AccessPolicy = z.infer<typeof policySchema>;

export const DENIAL_REASONS = [
  "person_not_covered",
  "calls_paused",
  "setup_attestations_missing",
  "topic_blocked",
  "topic_not_allowed",
  "person_topics_not_enabled",
  "outside_call_window",
  "too_soon_after_last_call",
  "weekly_call_limit_reached",
] as const;
export type DenialReason = (typeof DENIAL_REASONS)[number];

export interface CallRequest {
  person_id: string;
  topic_id: string;
  topic_type: string;
  now_iso: string;
  /** When earlier calls to her started. From Session records; used only for the agreed frequency. */
  earlier_call_starts: readonly string[];
}

export type PolicyDecision = { decision: "granted" } | { decision: "denied"; reason: DenialReason; detail: string };

/** Local weekday and minutes-past-midnight for an instant in a named zone. Pure: formats a given instant. */
function localTime(isoInstant: string, timeZone: string): { day: (typeof DAYS)[number]; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(isoInstant));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  const day = get("weekday").toLowerCase().slice(0, 3) as (typeof DAYS)[number];
  return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

const toMinutes = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const HOUR_MS = 3_600_000;

/** Rule 16. Every attestation, or no call. */
export function attestationsMissing(policy: AccessPolicy): string[] {
  const a = policy.attestations;
  const missing: string[] = [];
  if (!a.number_saved_in_her_phone) missing.push("the number is not saved in her phone");
  if (a.saved_contact_name.trim() === "") missing.push("the saved contact has no family-chosen name");
  if (!a.saved_contact_photo) missing.push("the saved contact has no family-chosen photo");
  if (!a.relay_introduced_to_her || a.introduced_by === null) missing.push("no family member has introduced Relay to her");
  else if (!policy.approved_people.includes(a.introduced_by)) missing.push("Relay was introduced by someone who is not an approved person");
  return missing;
}

/**
 * May Relay call her now, about this? Deny-by-default. The checks run in a fixed order and the first
 * failure wins, so the same request always produces the same reason.
 */
export function evaluateCallPolicy(policy: AccessPolicy, req: CallRequest): PolicyDecision {
  const deny = (reason: DenialReason, detail: string): PolicyDecision => ({ decision: "denied", reason, detail });

  if (req.person_id !== policy.person_id) return deny("person_not_covered", `no joint setup covers ${req.person_id}: Relay calls only her`);
  if (policy.calls_paused) return deny("calls_paused", "her caregiver has paused Relay's calls");
  const missing = attestationsMissing(policy);
  if (missing.length > 0) return deny("setup_attestations_missing", missing.join("; "));
  if (policy.topics.block.includes(req.topic_id)) return deny("topic_blocked", `${req.topic_id} is on the block list`);
  if (!policy.topics.allow.includes(req.topic_id)) return deny("topic_not_allowed", `${req.topic_id} is not on the allow list`);
  if (req.topic_type === "Person" && !policy.topics.person_topics_enabled) return deny("person_topics_not_enabled", "people are not topics unless the joint setup turns that on");

  const { day, minutes } = localTime(req.now_iso, policy.timezone);
  const inWindow = policy.call_windows.some((w) => w.days.includes(day) && minutes >= toMinutes(w.start) && minutes < toMinutes(w.end));
  if (!inWindow) return deny("outside_call_window", "now is outside the agreed call windows");

  const now = Date.parse(req.now_iso);
  const earlier = req.earlier_call_starts.map((s) => Date.parse(s)).filter((t) => t <= now);
  const last = Math.max(-Infinity, ...earlier);
  if (now - last < policy.call_frequency.min_hours_between_calls * HOUR_MS) return deny("too_soon_after_last_call", "the agreed time between calls has not passed");
  if (earlier.filter((t) => now - t < 7 * 24 * HOUR_MS).length >= policy.call_frequency.max_calls_per_week) {
    return deny("weekly_call_limit_reached", "the agreed number of calls this week has been reached");
  }
  return { decision: "granted" };
}

/** Rule 14: who may open the family view, and how much of it. Null means no access, which is the default. */
export function dashboardAccess(policy: AccessPolicy, memberId: string): DetailLevel | null {
  if (!policy.approved_people.includes(memberId)) return null;
  const grant = policy.dashboard.grants.find((g) => g.member_id === memberId && g.revoked_at === null);
  return grant?.detail_level ?? null;
}

/** Rule 14: the setup prompts a periodic re-confirmation with her and her caregiver. Pure: compares two given instants. */
export const reconfirmationDue = (policy: AccessPolicy, nowIso: string): boolean =>
  Date.parse(nowIso) - Date.parse(policy.dashboard.last_reconfirmed_at) >= policy.dashboard.reconfirm_every_days * 24 * HOUR_MS;

/**
 * The live joint setup. Everything reads `current()` at the moment it needs it, so a change made here is
 * in force before the next call is placed and before the next dashboard load (rule 12). Every change is
 * re-validated as a whole: a setup can never be edited into a shape the schema would refuse.
 */
export class SetupStore {
  private policy: AccessPolicy;

  constructor(raw: unknown) {
    this.policy = policySchema.parse(raw);
  }

  current(): AccessPolicy {
    return structuredClone(this.policy);
  }

  private change(next: AccessPolicy): void {
    this.policy = policySchema.parse(next);
  }

  pauseCalls(paused: boolean): void {
    this.change({ ...this.policy, calls_paused: paused });
  }

  revokeTopic(topicId: string): void {
    this.change({ ...this.policy, topics: { ...this.policy.topics, allow: this.policy.topics.allow.filter((t) => t !== topicId), block: [...new Set([...this.policy.topics.block, topicId])] } });
  }

  /** Revoking a contributor also ends their family view: it is for approved members only. */
  revokeContributor(personId: string, atIso: string): void {
    const p = this.policy;
    if (p.relay_set_up_by === personId || p.safety.designated_caregivers.some((c) => c.person_id === personId)) {
      throw new Error(`${personId} is named in the greeting or as a designated caregiver; change that in the joint setup first`);
    }
    this.change({
      ...p,
      approved_people: p.approved_people.filter((id) => id !== personId),
      dashboard: { ...p.dashboard, grants: p.dashboard.grants.map((g) => (g.member_id === personId && g.revoked_at === null ? { ...g, revoked_at: atIso } : g)) },
    });
  }

  /** For one member, or - with "all" - for everyone. */
  revokeDashboardAccess(memberId: string | "all", atIso: string): void {
    const p = this.policy;
    this.change({ ...p, dashboard: { ...p.dashboard, grants: p.dashboard.grants.map((g) => ((memberId === "all" || g.member_id === memberId) && g.revoked_at === null ? { ...g, revoked_at: atIso } : g)) } });
  }

  setCallWindows(windows: AccessPolicy["call_windows"]): void {
    this.change({ ...this.policy, call_windows: windows });
  }

  recordReconfirmation(atIso: string): void {
    this.change({ ...this.policy, dashboard: { ...this.policy.dashboard, last_reconfirmed_at: atIso } });
  }
}
