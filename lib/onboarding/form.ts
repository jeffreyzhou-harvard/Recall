/** A small, explicit UI projection of the joint setup. No contacts, calendar, or photo-library imports. */
import { z } from "zod";
import { policySchema, type AccessPolicy } from "@/lib/tools/policy";
export const preferencesSchema = z.strictObject({
  days: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).min(1),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().min(1), max_minutes: z.number().int().min(1).max(10),
  max_calls_per_week: z.number().int().min(1).max(7), min_hours_between_calls: z.number().int().min(24),
  pace: z.enum(["slow", "standard"]), emergency_number: z.string().trim().min(1).max(20),
  saved_contact_name: z.string().trim().max(80), number_saved: z.boolean(), photo_saved: z.boolean(), introduced: z.boolean(),
  dashboard: z.enum(["none", "weekly_note", "weekly_note_and_record"]),
  patient_agreed: z.literal(true), caregiver_agreed: z.literal(true),
  expected_version: z.number().int().nonnegative(),
}).refine((p) => p.start < p.end, { message: "Choose an end time after the start time.", path: ["end"] });
export type Preferences = z.infer<typeof preferencesSchema>;
export function setupFromPreferences(input: Preferences, identity: { household: string; participant: string; caregiver: string }, at: string, previous?: AccessPolicy): AccessPolicy {
  const { household, participant, caregiver } = identity;
  const p = preferencesSchema.parse(input);
  const grants = (previous?.dashboard.grants ?? []).map((g) => g.member_id === caregiver && g.revoked_at === null ? { ...g, revoked_at: at } : g);
  if (p.dashboard !== "none") grants.push({ member_id: caregiver, detail_level: p.dashboard, granted_at: at, revoked_at: null });
  return policySchema.parse({
    ...previous,
    policy_id: `policy:${household}`, version: 2, description: "Joint setup", person_id: participant,
    established_by: [participant, caregiver], established_at: at, recall_set_up_by: caregiver,
    approved_people: previous?.approved_people ?? [caregiver], approved_audiences: [participant],
    timezone: p.timezone, call_windows: [{ days: p.days, start: p.start, end: p.end }],
    call_frequency: { max_calls_per_week: p.max_calls_per_week, min_hours_between_calls: p.min_hours_between_calls },
    // There is no live transport or external safety channel yet. Saving preferences never enables calls.
    calls_paused: true,
    topics: previous?.topics ?? { allow: [], block: [], person_topics_enabled: false },
    allowed_source_classes: previous?.allowed_source_classes ?? ["joint_setup", "family_contribution", "recall_call", "session_audit"],
    blocked_terms: previous?.blocked_terms ?? [], speech: { pace: p.pace, max_call_minutes: p.max_minutes },
    review: { store_confirmation_required: true, share_confirmation_required: true },
    safety: previous?.safety ?? { designated_caregivers: [{ person_id: caregiver, alert_channel: "dashboard" }], emergency_number: p.emergency_number },
    attestations: { number_saved_in_her_phone: p.number_saved, saved_contact_name: p.saved_contact_name, saved_contact_photo: p.photo_saved, recall_introduced_to_her: p.introduced, introduced_by: p.introduced ? caregiver : null },
    dashboard: { grants, reconfirm_every_days: previous?.dashboard.reconfirm_every_days ?? 90, last_reconfirmed_at: at },
    token_ttl_minutes: previous?.token_ttl_minutes ?? 15,
    discovery: previous?.discovery ?? { enabled: false, photo_access_granted_by: [], observe: { faces: false, places: false, times: false, themes: false }, invite_her_confirmation: false },
  });
}
