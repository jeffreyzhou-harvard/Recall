/**
 * Onboarding records: who is in a household, how they are related, what they
 * agreed together, and who was invited (AGENTS.md rules 8, 14, 15, 16; section 7,
 * "ask, don't assert").
 *
 * This is the operational record - identities and the joint setup. It is kept
 * apart from the memory graph on purpose: nothing she remembers lives here, and
 * nothing here can be read through a family surface except a member's own name.
 *
 * Data minimization is the shape of these types (rule 8). There is no field for a
 * diagnosis, a stage, a health record, a location, or a date of birth, so none can
 * be collected. A phone number exists for ONE person in a household - hers, because
 * Recall has to be able to call her. Family members have no contact field: Recall
 * never calls, texts, or emails them (rule 5).
 */
import { z } from "zod";
import { KIN_WORDS, RELATIONS } from "@/lib/graph/relations";
import { policySchema } from "@/lib/tools/policy";

const id = z.string().min(1);
const iso = z.iso.datetime();
/** Trimmed, non-empty, and short: a name, not a note. */
const name = z.string().trim().min(1).max(80);

export const HOUSEHOLD_STATUSES = ["onboarding", "active", "paused"] as const;
export const householdSchema = z.strictObject({ household_id: id, created_at: iso, status: z.enum(HOUSEHOLD_STATUSES) });
export type Household = z.infer<typeof householdSchema>;

/** `participant` is her. `caregiver` sets Recall up with her and can be a designated caregiver. `family` is anyone else she and her caregiver approve. */
export const PERSON_ROLES = ["participant", "caregiver", "family"] as const;
export type PersonRole = (typeof PERSON_ROLES)[number];

/** E.164. Stored for the participant only, and only so that Recall can call her. */
export const phoneSchema = z.string().regex(/^\+[1-9]\d{6,14}$/, "a phone number in international form, like +16095550123");

export const personSchema = z
  .strictObject({
    person_id: id,
    household_id: id,
    role: z.enum(PERSON_ROLES),
    display_name: name,
    /** As the person says it. Never guessed from a name. */
    subject_pronoun: z.string().trim().min(1).max(20).nullable(),
    phone: phoneSchema.nullable(),
    added_by: id.nullable(),
    added_at: iso,
    removed_at: iso.nullable(),
  })
  .refine((p) => p.phone === null || p.role === "participant", { message: "only her number is kept: Recall never contacts family (rule 5)", path: ["phone"] })
  .refine((p) => p.role !== "participant" || p.phone !== null, { message: "Recall needs her number to call her", path: ["phone"] });
export type Person = z.infer<typeof personSchema>;

/** Relations between two people, from the graph's closed vocabulary. The word the person used ("daughter") is kept beside it. */
const PERSON_RELATIONS = (Object.keys(RELATIONS) as Array<keyof typeof RELATIONS>).filter((r) => (RELATIONS[r].to as readonly string[]).includes("Person"));
export const relationshipSchema = z
  .strictObject({
    household_id: id,
    /** Reads from -> to as "to is from's <relation>": Susan --child--> Maya means Maya is Susan's child. */
    from_person_id: id,
    to_person_id: id,
    relation: z.enum(PERSON_RELATIONS as [string, ...string[]]),
    said_as: z.string().trim().min(1).max(40).nullable(),
    /** Ask, don't assert: a relationship enters only because a named person said so (section 7). */
    stated_by: id,
    stated_at: iso,
  })
  .refine((r) => r.from_person_id !== r.to_person_id, { message: "a relationship is between two people", path: ["to_person_id"] })
  .refine((r) => r.said_as === null || KIN_WORDS[r.said_as.toLowerCase()] === undefined || KIN_WORDS[r.said_as.toLowerCase()] === r.relation, {
    message: "the word used does not mean that relation",
    path: ["said_as"],
  });
export type Relationship = z.infer<typeof relationshipSchema>;

/**
 * One version of the joint setup. Append-only: a change is a new version, never an edit, so there is always
 * a record of what was agreed, by whom, and when (rule 14).
 *   joint       agreed by her AND a caregiver, together. The only way anything is ever added or widened.
 *   tightening  recorded by her OR a caregiver alone. It can only take away: revoke, narrow, pause (rule 12).
 */
export const SETUP_KINDS = ["joint", "tightening"] as const;
export const setupVersionSchema = z.strictObject({
  household_id: id,
  version: z.number().int().positive(),
  kind: z.enum(SETUP_KINDS),
  document: policySchema,
  agreed_by: z.array(id).min(1),
  recorded_by: id,
  recorded_at: iso,
  note: z.string().max(280).nullable(),
});
export type SetupVersion = z.infer<typeof setupVersionSchema>;

export const CONSENT_KINDS = ["joint_setup_agreed", "setup_tightened", "reconfirmed", "invitation_accepted", "member_removed"] as const;
export const consentEventSchema = z.strictObject({ household_id: id, person_id: id, kind: z.enum(CONSENT_KINDS), at: iso, recorded_by: id });
export type ConsentEvent = z.infer<typeof consentEventSchema>;

export const INVITATION_STATUSES = ["pending", "accepted", "withdrawn"] as const;
export const invitationSchema = z.strictObject({
  invitation_id: id,
  household_id: id,
  display_name: name,
  role: z.enum(["caregiver", "family"]),
  invited_by: id,
  invited_at: iso,
  /** sha256 of the invitation token. The token itself is shown once, to the inviter, and never stored. */
  token_hash: z.string().regex(/^[0-9a-f]{64}$/),
  status: z.enum(INVITATION_STATUSES),
  resolved_at: iso.nullable(),
  person_id: id.nullable(),
});
export type Invitation = z.infer<typeof invitationSchema>;

export type OnboardingErrorCode = "not_found" | "not_a_member" | "not_allowed" | "invalid" | "already_exists" | "needs_joint_agreement" | "clinical_language";

export class OnboardingError extends Error {
  constructor(
    public readonly code: OnboardingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OnboardingError";
  }
}
