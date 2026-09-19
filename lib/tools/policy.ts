/**
 * Access policy: the document the family agreed in the one-time joint setup,
 * and the pure function that evaluates an ask against it.
 *
 * Policy fixtures define the safety gates; changes need a second reviewer
 * (AGENTS.md section 13).
 */
import { z } from "zod";
import { SOURCE_CLASSES } from "@/lib/graph/types";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const policySchema = z
  .strictObject({
    policy_id: z.string().min(1),
    version: z.literal(1),
    description: z.string(),
    person_id: z.string().min(1),
    established_by: z.string().min(1),
    approved_people: z.array(z.string()),
    approved_audiences: z.array(z.string()),
    purposes: z.array(z.enum(["answer_current_ask"])),
    timezone: z.string().min(1),
    call_windows: z.array(z.strictObject({ days: z.array(z.enum(DAYS)), start: hhmm, end: hhmm })),
    topics: z.strictObject({ allow: z.array(z.string()), block: z.array(z.string()) }),
    allowed_source_classes: z.array(z.enum(SOURCE_CLASSES)),
    forbidden_claims: z.array(z.string()),
    blocked_terms: z.array(z.string()),
    speech: z.strictObject({ pace: z.enum(["slow", "standard"]), max_call_minutes: z.number().int().positive() }),
    review: z.strictObject({ voice_assent_required: z.literal(true), caregiver_review_before_send: z.boolean() }),
    token_ttl_minutes: z.number().int().positive(),
    /** How long a forwarded ask stays usable. After this it is no longer evidence for anything. */
    ask_ttl_hours: z.number().int().positive(),
    /** Who receives the non-clinical support receipt after a delivery. Sent to them directly, never to the thread. */
    support_receipt: z.strictObject({ recipients: z.array(z.string()) }),
  })
  .refine((p) => p.support_receipt.recipients.every((r) => p.approved_people.includes(r)), {
    message: "support receipt recipients must be approved people",
    path: ["support_receipt", "recipients"],
  });
export type AccessPolicy = z.infer<typeof policySchema>;

export const DENIAL_REASONS = [
  "person_not_covered",
  "asker_not_approved",
  "audience_not_approved",
  "purpose_not_permitted",
  "topic_blocked",
  "topic_not_allowed",
  "outside_call_window",
  "ask_expired",
] as const;
export type DenialReason = (typeof DENIAL_REASONS)[number];

export interface PolicyRequest {
  person_id: string;
  asker_id: string;
  purpose: string;
  audience: string;
  topic_ids: string[];
  ask_expires_at: string | null;
  now_iso: string;
}

export type PolicyDecision = { decision: "granted" } | { decision: "denied"; reason: DenialReason; detail: string };

/** Local weekday and minutes-past-midnight for an instant in a named zone. Pure: formats a given instant. */
function localTime(iso: string, timeZone: string): { day: (typeof DAYS)[number]; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  const day = get("weekday").toLowerCase().slice(0, 3) as (typeof DAYS)[number];
  return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

const toMinutes = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/**
 * Deny-by-default. The checks run in a fixed order and the first failure
 * wins, so the same request always produces the same reason.
 */
export function evaluatePolicy(policy: AccessPolicy, req: PolicyRequest): PolicyDecision {
  const deny = (reason: DenialReason, detail: string): PolicyDecision => ({ decision: "denied", reason, detail });

  if (req.person_id !== policy.person_id) return deny("person_not_covered", `no policy covers ${req.person_id}`);
  if (!policy.approved_people.includes(req.asker_id)) {
    return deny("asker_not_approved", `${req.asker_id} is not an approved person`);
  }
  if (!policy.approved_audiences.includes(req.audience)) {
    return deny("audience_not_approved", `${req.audience} is not an approved audience`);
  }
  if (!(policy.purposes as string[]).includes(req.purpose)) {
    return deny("purpose_not_permitted", `purpose "${req.purpose}" is not permitted`);
  }
  const blocked = req.topic_ids.find((t) => policy.topics.block.includes(t));
  if (blocked) return deny("topic_blocked", `${blocked} is on the block list`);
  const unlisted = req.topic_ids.find((t) => !policy.topics.allow.includes(t));
  if (unlisted) return deny("topic_not_allowed", `${unlisted} is not on the allow list`);
  if (req.ask_expires_at !== null && req.ask_expires_at <= req.now_iso) {
    return deny("ask_expired", "the forwarded ask has expired");
  }
  const { day, minutes } = localTime(req.now_iso, policy.timezone);
  const inWindow = policy.call_windows.some(
    (w) => w.days.includes(day) && minutes >= toMinutes(w.start) && minutes < toMinutes(w.end),
  );
  if (!inWindow) return deny("outside_call_window", "now is outside the agreed call windows");
  return { decision: "granted" };
}
