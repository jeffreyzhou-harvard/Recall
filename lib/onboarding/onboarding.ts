/**
 * Onboarding: the rules about who may do what, written once and run over either store.
 *
 *   createHousehold      her, and the caregiver setting Recall up with her
 *   invite / accept      anyone else joins by invitation from her or a caregiver - never by signing themselves up
 *   stateRelationship    ask, don't assert: a tie exists because a named member said so (AGENTS.md section 7)
 *   recordJointSetup     what they agree TOGETHER. The only way anything is ever added or widened
 *   tightenSetup         what she, or a caregiver, may do ALONE: revoke, narrow, pause. It can only take away
 *   status               which steps are done, and whether Recall may call her yet
 *   graphSeed            the identity layer of her memory graph, derived from these records
 *
 * Every version of the setup is kept, with who agreed and who recorded it (rule 14). Nothing here reads a
 * clock or makes an id at random: time comes from the injected clock, ids are counted, and an invitation's
 * token is made by the caller and arrives here already hashed.
 */
import type { Clock } from "@/lib/clock";
import { CLINICAL_TERMS, type SeedFile } from "@/lib/graph/seed";
import { attestationsMissing, policySchema, reconfirmationDue, type AccessPolicy } from "@/lib/tools/policy";
import type { OnboardingStore } from "./store";
import { OnboardingError, personSchema, relationshipSchema, type Household, type Invitation, type Person, type Relationship, type SetupVersion } from "./types";

export interface NewHousehold {
  participant: { display_name: string; subject_pronoun?: string | null; phone: string };
  caregiver: { display_name: string; subject_pronoun?: string | null };
}

export const ONBOARDING_STEPS = ["participant_added", "caregiver_added", "joint_setup_agreed", "contact_saved_and_recall_introduced", "designated_caregiver_named", "topics_allowed"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingStatus {
  household: Household;
  steps: Array<{ step: OnboardingStep; done: boolean; detail: string | null }>;
  /** Every step done and calls not paused. `place_recall_call` checks the same things again before any call. */
  ready_to_call: boolean;
  /** Rule 14: time to go over the settings again with her and her caregiver. */
  reconfirmation_due: boolean;
  pending_invitations: number;
}

const DETAIL_RANK = { weekly_note: 0, weekly_note_and_record: 1 } as const;
const minutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const subset = (a: readonly string[], b: readonly string[]): boolean => a.every((x) => b.includes(x));
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Everything in `next` that gives MORE than `prev` did. Empty means `next` only takes away, which she or a
 * caregiver may do alone (rule 12). Anything else needs the two of them together - above all the safety
 * block, which "can be removed only in the joint setup" (rule 15).
 */
export function loosenings(prev: AccessPolicy, next: AccessPolicy): string[] {
  const out: string[] = [];
  const fixed: Array<keyof AccessPolicy> = ["policy_id", "version", "person_id", "established_by", "established_at", "recall_set_up_by", "timezone", "review", "safety"];
  for (const key of fixed) if (!same(prev[key], next[key])) out.push(`${key} can only change in a joint setup`);
  if (!subset(next.approved_people, prev.approved_people)) out.push("an approved person was added");
  if (!subset(prev.formerly_approved, next.formerly_approved) || !subset(next.formerly_approved, [...prev.formerly_approved, ...prev.approved_people])) out.push("the list of formerly approved people can only gain someone who was approved");
  if (!subset(next.approved_audiences, prev.approved_audiences)) out.push("an audience was added");
  if (!subset(next.allowed_source_classes, prev.allowed_source_classes)) out.push("a source class was added");
  if (!subset(prev.blocked_terms, next.blocked_terms)) out.push("a blocked term was removed");
  if (!subset(next.topics.allow, prev.topics.allow)) out.push("a topic was allowed");
  if (!subset(prev.topics.block, next.topics.block)) out.push("a topic was unblocked");
  if (next.topics.person_topics_enabled && !prev.topics.person_topics_enabled) out.push("people were turned on as topics");
  if (prev.calls_paused && !next.calls_paused) out.push("calls were resumed");
  for (const w of next.call_windows) {
    const inside = prev.call_windows.some((p) => subset(w.days, p.days) && minutes(w.start) >= minutes(p.start) && minutes(w.end) <= minutes(p.end));
    if (!inside) out.push(`a call window was added or widened (${w.start}-${w.end})`);
  }
  if (next.call_frequency.max_calls_per_week > prev.call_frequency.max_calls_per_week) out.push("more calls per week");
  if (next.call_frequency.min_hours_between_calls < prev.call_frequency.min_hours_between_calls) out.push("less time between calls");
  if (next.speech.max_call_minutes > prev.speech.max_call_minutes) out.push("longer calls");
  if (next.token_ttl_minutes > prev.token_ttl_minutes) out.push("a longer-lived policy token");
  if (next.dashboard.reconfirm_every_days > prev.dashboard.reconfirm_every_days) out.push("re-confirmation less often");
  if (next.dashboard.last_reconfirmed_at < prev.dashboard.last_reconfirmed_at) out.push("the last re-confirmation was moved back");
  if (next.dashboard.grants.length !== prev.dashboard.grants.length) out.push("the list of family-view grants changed length: a grant is revoked, never deleted, and never added alone");
  for (const [i, g] of next.dashboard.grants.entries()) {
    const was = prev.dashboard.grants[i];
    if (!was || was.member_id !== g.member_id || was.granted_at !== g.granted_at) out.push(`the family-view grant for ${g.member_id} is not one that was agreed`);
    else if (was.revoked_at !== null && g.revoked_at === null) out.push(`the family view was restored for ${g.member_id}`);
    else if (DETAIL_RANK[g.detail_level] > DETAIL_RANK[was.detail_level]) out.push(`${g.member_id} was given more of the family view`);
  }
  for (const [key, was] of Object.entries(prev.attestations)) if (was === false && next.attestations[key as keyof AccessPolicy["attestations"]] === true) out.push(`an attestation was made (${key}): that is part of the joint setup`);
  if (!same(prev.discovery, next.discovery) && next.discovery.enabled) out.push("discovery settings changed while it is on");
  return out;
}

export class Onboarding {
  constructor(
    private readonly store: OnboardingStore,
    private readonly clock: Clock,
  ) {}

  // --- helpers ------------------------------------------------------------------------------------------------

  private async household(householdId: string): Promise<Household> {
    const h = await this.store.getHousehold(householdId);
    if (!h) throw new OnboardingError("not_found", `no household "${householdId}"`);
    return h;
  }

  /** People still in the household. */
  private async members(householdId: string): Promise<Person[]> {
    return (await this.store.people(householdId)).filter((p) => p.removed_at === null);
  }

  private async member(householdId: string, personId: string, roles?: readonly Person["role"][]): Promise<Person> {
    const p = (await this.members(householdId)).find((m) => m.person_id === personId);
    if (!p) throw new OnboardingError("not_a_member", `${personId} is not in this household`);
    if (roles && !roles.includes(p.role)) throw new OnboardingError("not_allowed", `only ${roles.join(" or ")} may do that`);
    return p;
  }

  /** The people still in the household. Her number comes with her record: a caller decides who, if anyone, is shown it. */
  async people(householdId: string): Promise<Person[]> {
    await this.household(householdId);
    return this.members(householdId);
  }

  /** Rule 4 and rule 8: no clinical or state language is ever stored, in a name or in a note. Blunt on purpose. */
  private static plain(...texts: Array<string | null | undefined>): void {
    for (const t of texts) if (t && CLINICAL_TERMS.test(t)) throw new OnboardingError("clinical_language", "Recall does not store clinical or state language, here or anywhere");
  }

  private static number = (householdId: string): string => householdId.slice("household:".length);

  // --- people -------------------------------------------------------------------------------------------------

  /** Her, and the caregiver setting Recall up with her. Both or neither. */
  async createHousehold(input: NewHousehold): Promise<{ household: Household; participant: Person; caregiver: Person }> {
    Onboarding.plain(input.participant.display_name, input.caregiver.display_name);
    return this.store.transaction(async () => {
      const at = this.clock.iso();
      const n = (await this.store.listHouseholds()).length + 1;
      const household: Household = { household_id: `household:${n}`, created_at: at, status: "onboarding" };
      const caregiver = this.parsePerson({ person_id: `person:h${n}:1`, household_id: household.household_id, role: "caregiver", display_name: input.caregiver.display_name, subject_pronoun: input.caregiver.subject_pronoun ?? null, phone: null, added_by: null, added_at: at, removed_at: null });
      const participant = this.parsePerson({ person_id: `person:h${n}:2`, household_id: household.household_id, role: "participant", display_name: input.participant.display_name, subject_pronoun: input.participant.subject_pronoun ?? null, phone: input.participant.phone, added_by: caregiver.person_id, added_at: at, removed_at: null });
      await this.store.addHousehold(household);
      await this.store.addPerson(caregiver);
      await this.store.addPerson(participant);
      return { household, participant, caregiver };
    });
  }

  private parsePerson(raw: unknown): Person {
    const parsed = personSchema.safeParse(raw);
    if (!parsed.success) throw new OnboardingError("invalid", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    return parsed.data;
  }

  /**
   * Nobody adds themselves. She, or a caregiver, invites a named person; the token is made by the caller,
   * shown once, and only its hash is kept. Being in the household grants nothing: what a member may see or
   * contribute is decided by the joint setup alone.
   */
  async invite(householdId: string, invitee: { display_name: string; role: "caregiver" | "family" }, invitedBy: string, tokenHash: string): Promise<Invitation> {
    Onboarding.plain(invitee.display_name);
    return this.store.transaction(async () => {
      await this.household(householdId);
      await this.member(householdId, invitedBy, ["participant", "caregiver"]);
      const k = (await this.store.invitations(householdId)).length + 1;
      const invitation: Invitation = { invitation_id: `invitation:h${Onboarding.number(householdId)}:${k}`, household_id: householdId, display_name: invitee.display_name.trim(), role: invitee.role, invited_by: invitedBy, invited_at: this.clock.iso(), token_hash: tokenHash, status: "pending", resolved_at: null, person_id: null };
      await this.store.addInvitation(invitation);
      return invitation;
    });
  }

  async acceptInvitation(tokenHash: string, about: { subject_pronoun?: string | null } = {}): Promise<Person> {
    return this.store.transaction(async () => {
      const invitation = await this.store.invitationByTokenHash(tokenHash);
      // One answer for "no such token" and "already used": an invitation cannot be probed.
      if (!invitation || invitation.status !== "pending") throw new OnboardingError("not_found", "that invitation is not open");
      const at = this.clock.iso();
      const k = (await this.store.people(invitation.household_id)).length + 1;
      const person = this.parsePerson({ person_id: `person:h${Onboarding.number(invitation.household_id)}:${k}`, household_id: invitation.household_id, role: invitation.role, display_name: invitation.display_name, subject_pronoun: about.subject_pronoun ?? null, phone: null, added_by: invitation.invited_by, added_at: at, removed_at: null });
      await this.store.addPerson(person);
      await this.store.resolveInvitation(invitation.invitation_id, "accepted", at, person.person_id);
      await this.store.appendConsent({ household_id: invitation.household_id, person_id: person.person_id, kind: "invitation_accepted", at, recorded_by: person.person_id });
      return person;
    });
  }

  async withdrawInvitation(householdId: string, invitationId: string, by: string): Promise<void> {
    return this.store.transaction(async () => {
      await this.member(householdId, by, ["participant", "caregiver"]);
      if (!(await this.store.invitations(householdId)).some((i) => i.invitation_id === invitationId)) throw new OnboardingError("not_found", "no such invitation in this household");
      await this.store.resolveInvitation(invitationId, "withdrawn", this.clock.iso(), null);
    });
  }

  /** Ask, don't assert. A tie between two members, in the word that was used for it, because a member said so. */
  async stateRelationship(householdId: string, tie: { from_person_id: string; to_person_id: string; relation: string; said_as?: string | null }, statedBy: string): Promise<Relationship> {
    Onboarding.plain(tie.said_as);
    return this.store.transaction(async () => {
      for (const id of [tie.from_person_id, tie.to_person_id, statedBy]) await this.member(householdId, id);
      const parsed = relationshipSchema.safeParse({ household_id: householdId, from_person_id: tie.from_person_id, to_person_id: tie.to_person_id, relation: tie.relation, said_as: tie.said_as?.trim().toLowerCase() || null, stated_by: statedBy, stated_at: this.clock.iso() });
      if (!parsed.success) throw new OnboardingError("invalid", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      await this.store.putRelationship(parsed.data);
      return parsed.data;
    });
  }

  // --- the joint setup ------------------------------------------------------------------------------------------

  async currentSetup(householdId: string): Promise<SetupVersion | null> {
    return (await this.store.setupVersions(householdId)).at(-1) ?? null;
  }

  /** The document must describe THIS household: her, and people who are actually in it. */
  private async checkAgainstHousehold(householdId: string, doc: AccessPolicy): Promise<void> {
    const members = await this.members(householdId);
    const her = members.find((m) => m.role === "participant");
    const others = members.filter((m) => m.role !== "participant").map((m) => m.person_id);
    const problems: string[] = [];
    if (doc.policy_id !== `policy:${householdId}`) problems.push(`policy_id must be "policy:${householdId}"`);
    if (!her || doc.person_id !== her.person_id) problems.push("the setup must be for this household's participant");
    const strangers = doc.approved_people.filter((id) => !others.includes(id));
    if (strangers.length > 0) problems.push(`not members of this household: ${strangers.join(", ")}`);
    if (her && !doc.approved_audiences.every((a) => a === her.person_id)) problems.push("what Recall stores is used with her, and only her");
    if (problems.length > 0) throw new OnboardingError("invalid", problems.join("; "));
    Onboarding.plain(doc.description, doc.attestations.saved_contact_name, ...doc.blocked_terms);
  }

  /**
   * What they agree together. `agreedBy` must include HER and at least one caregiver: it is a joint setup, and a
   * setup she is not part of is not one (rule 14). This is the only way to add, widen, resume, or change safety.
   */
  async recordJointSetup(householdId: string, document: unknown, agreedBy: readonly string[], recordedBy: string, note: string | null = null): Promise<SetupVersion> {
    Onboarding.plain(note);
    return this.store.transaction(async () => {
      // Who agreed comes first: without the two of them there is nothing to read.
      const agreed = [...new Set(agreedBy)];
      const people = await Promise.all(agreed.map((id) => this.member(householdId, id)));
      if (!people.some((p) => p.role === "participant")) throw new OnboardingError("needs_joint_agreement", "she has to be part of agreeing her own setup");
      if (!people.some((p) => p.role === "caregiver")) throw new OnboardingError("needs_joint_agreement", "a caregiver has to agree the setup with her");
      await this.member(householdId, recordedBy, ["participant", "caregiver"]);
      const doc = Onboarding.parseSetup(document);
      await this.checkAgainstHousehold(householdId, doc);
      if (!same([...doc.established_by].sort(), [...agreed].sort())) throw new OnboardingError("invalid", "established_by must name exactly the people who agreed");
      return this.append(householdId, "joint", doc, agreed, recordedBy, note, "joint_setup_agreed");
    });
  }

  /**
   * What she, or a caregiver, may do alone, at any time: revoke, narrow, pause (rule 12). The new document is
   * compared with the current one, and anything that gives more than before is refused by name.
   */
  async tightenSetup(householdId: string, document: unknown, by: string, note: string | null = null): Promise<SetupVersion> {
    Onboarding.plain(note);
    return this.store.transaction(async () => {
      await this.member(householdId, by, ["participant", "caregiver"]);
      const current = await this.currentSetup(householdId);
      if (!current) throw new OnboardingError("needs_joint_agreement", "there is no joint setup yet to tighten");
      const doc = Onboarding.parseSetup(document);
      await this.checkAgainstHousehold(householdId, doc);
      const looser = loosenings(current.document, doc);
      if (looser.length > 0) throw new OnboardingError("needs_joint_agreement", `that takes her and a caregiver together: ${looser.join("; ")}`);
      return this.append(householdId, "tightening", doc, [by], by, note, "setup_tightened");
    });
  }

  /** Rule 14: she and her caregiver went over the settings again. Recorded as a joint version with a new date. */
  async recordReconfirmation(householdId: string, agreedBy: readonly string[], recordedBy: string): Promise<SetupVersion> {
    const current = await this.currentSetup(householdId);
    if (!current) throw new OnboardingError("needs_joint_agreement", "there is no joint setup yet to re-confirm");
    const document = { ...current.document, established_by: [...new Set(agreedBy)], dashboard: { ...current.document.dashboard, last_reconfirmed_at: this.clock.iso() } };
    return this.recordJointSetup(householdId, document, agreedBy, recordedBy, "settings re-confirmed together");
  }

  private static parseSetup(document: unknown): AccessPolicy {
    const parsed = policySchema.safeParse(document);
    if (!parsed.success) throw new OnboardingError("invalid", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    return parsed.data;
  }

  private async append(householdId: string, kind: SetupVersion["kind"], document: AccessPolicy, agreedBy: string[], recordedBy: string, note: string | null, consent: "joint_setup_agreed" | "setup_tightened"): Promise<SetupVersion> {
    const at = this.clock.iso();
    const version: SetupVersion = { household_id: householdId, version: (await this.store.setupVersions(householdId)).length + 1, kind, document, agreed_by: agreedBy, recorded_by: recordedBy, recorded_at: at, note };
    await this.store.appendSetupVersion(version);
    for (const person_id of agreedBy) await this.store.appendConsent({ household_id: householdId, person_id, kind: consent, at, recorded_by: recordedBy });
    await this.store.setHouseholdStatus(householdId, document.calls_paused ? "paused" : (await this.computeSteps(householdId, document)).every((s) => s.done) ? "active" : "onboarding");
    return version;
  }

  /**
   * Someone leaves the household. Their permissions go first - the setup is tightened to drop them - and only
   * then are they marked as removed. Her own record, the person named in the greeting, and a designated
   * caregiver cannot be removed this way: those are changed in a joint setup, so that her safety alert
   * always has somewhere to go (rule 15).
   */
  async removeMember(householdId: string, personId: string, by: string): Promise<void> {
    await this.member(householdId, by, ["participant", "caregiver"]);
    const leaving = await this.member(householdId, personId);
    if (leaving.role === "participant") throw new OnboardingError("not_allowed", "the household is hers; it cannot go on without her");
    const current = await this.currentSetup(householdId);
    if (current) {
      const doc = current.document;
      if (doc.recall_set_up_by === personId || doc.safety.designated_caregivers.some((c) => c.person_id === personId) || doc.safety.backup_caregiver_id === personId) {
        throw new OnboardingError("needs_joint_agreement", `${leaving.display_name} is named in the greeting or as a designated caregiver; change that in a joint setup first`);
      }
      const at = this.clock.iso();
      const next: AccessPolicy = { ...doc, approved_people: doc.approved_people.filter((id) => id !== personId), formerly_approved: doc.approved_people.includes(personId) ? [...new Set([...doc.formerly_approved, personId])] : doc.formerly_approved, discovery: { ...doc.discovery, photo_access_granted_by: doc.discovery.photo_access_granted_by.filter((id) => id !== personId) }, dashboard: { ...doc.dashboard, grants: doc.dashboard.grants.map((g) => (g.member_id === personId && g.revoked_at === null ? { ...g, revoked_at: at } : g)) } };
      if (!same(next, doc)) await this.tightenSetup(householdId, next, by, `${leaving.display_name} left the household`);
    }
    await this.store.transaction(async () => {
      await this.store.markRemoved(personId, this.clock.iso());
      await this.store.appendConsent({ household_id: householdId, person_id: personId, kind: "member_removed", at: this.clock.iso(), recorded_by: by });
    });
  }

  // --- where onboarding stands --------------------------------------------------------------------------------------

  private async computeSteps(householdId: string, doc: AccessPolicy | null): Promise<OnboardingStatus["steps"]> {
    const members = await this.members(householdId);
    const missing = doc ? attestationsMissing(doc) : ["there is no joint setup yet"];
    const jointly = (await this.store.setupVersions(householdId)).some((v) => v.kind === "joint");
    return [
      { step: "participant_added", done: members.some((m) => m.role === "participant"), detail: null },
      { step: "caregiver_added", done: members.some((m) => m.role === "caregiver"), detail: null },
      { step: "joint_setup_agreed", done: jointly, detail: jointly ? null : "she and a caregiver have not yet agreed a setup together" },
      { step: "contact_saved_and_recall_introduced", done: missing.length === 0, detail: missing.length === 0 ? null : missing.join("; ") },
      { step: "designated_caregiver_named", done: (doc?.safety.designated_caregivers.length ?? 0) > 0, detail: null },
      { step: "topics_allowed", done: (doc?.topics.allow.length ?? 0) > 0, detail: doc && doc.topics.allow.length === 0 ? "no topic has been allowed yet, so there is nothing to call her about" : null },
    ];
  }

  async status(householdId: string): Promise<OnboardingStatus> {
    const household = await this.household(householdId);
    const doc = (await this.currentSetup(householdId))?.document ?? null;
    const steps = await this.computeSteps(householdId, doc);
    return {
      household,
      steps,
      ready_to_call: steps.every((s) => s.done) && doc !== null && !doc.calls_paused,
      reconfirmation_due: doc !== null && reconfirmationDue(doc, this.clock.iso()),
      pending_invitations: (await this.store.invitations(householdId)).filter((i) => i.status === "pending").length,
    };
  }

  // --- what her memory graph starts from ---------------------------------------------------------------------------

  /**
   * The identity layer of her graph, derived from these records: the people in the household, the ties that
   * were stated (each under the person who stated it), the joint setup, and who it permits. It holds no
   * memories - those enter only through her own confirmed words, or a family contribution in its author's name.
   */
  async graphSeed(householdId: string): Promise<SeedFile> {
    const setup = await this.currentSetup(householdId);
    if (!setup) throw new OnboardingError("needs_joint_agreement", "her graph starts from the joint setup; there is none yet");
    const members = await this.members(householdId);
    const her = members.find((m) => m.role === "participant")!;
    const active = new Set(members.map((m) => m.person_id));
    const ties = (await this.store.relationships(householdId)).filter((r) => active.has(r.from_person_id) && active.has(r.to_person_id) && active.has(r.stated_by));

    const SETUP = "artifact:setup-record";
    const saidBy = (personId: string): string => `artifact:onboarding:${personId}`;
    const source = (author: string, at: string): SeedFile["sources"][string] => ({ source_class: "joint_setup", asset_id: null, observed_at: at, author, extraction_method: "joint_setup", confidence: 1, audience_scope: [her.person_id], expires_at: null });
    const staters = [...new Set(ties.map((t) => t.stated_by))];
    const nameOf = (id: string): string => members.find((m) => m.person_id === id)!.display_name;

    return {
      version: 1,
      description: `The people in ${her.display_name}'s household and what they agreed together. No memories: those come only from her own confirmed words, or a family contribution in its author's name.`,
      sources: { [SETUP]: source(setup.recorded_by, setup.recorded_at), ...Object.fromEntries(staters.map((id) => [saidBy(id), source(id, ties.find((t) => t.stated_by === id)!.stated_at)])) },
      nodes: [
        { id: SETUP, type: "Artifact", label: "Joint setup", props: { kind: "setup_record", text: null, alt: null }, source: SETUP },
        ...staters.map((id) => ({ id: saidBy(id), type: "Artifact" as const, label: `What ${nameOf(id)} said at onboarding`, props: { kind: "setup_record", text: null, alt: null }, source: saidBy(id) })),
        ...members.map((m) => ({ id: m.person_id, type: "Person" as const, label: m.display_name, props: { display_name: m.display_name, role: m.role === "participant" ? "participant" : "family", ...(m.subject_pronoun ? { subject_pronoun: m.subject_pronoun } : {}) }, source: SETUP })),
        { id: setup.document.policy_id, type: "AccessPolicy", label: `${her.display_name}'s joint setup`, props: { policy_ref: `${householdId} v${setup.version}` }, source: SETUP },
      ],
      edges: [
        ...ties.map((t) => ({ type: "RELATED_TO" as const, from: t.from_person_id, to: t.to_person_id, source: saidBy(t.stated_by), props: { relation: t.relation, said_as: t.said_as } })),
        ...[SETUP, ...staters.map(saidBy)].map((a) => ({ type: "PERMITTED_IN" as const, from: a, to: setup.document.policy_id, source: SETUP })),
        ...setup.document.approved_people.filter((id) => active.has(id)).map((id) => ({ type: "PERMITTED_IN" as const, from: id, to: setup.document.policy_id, source: SETUP })),
      ],
    };
  }
}
