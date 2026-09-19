/**
 * The onboarding store boundary. Two implementations sit behind it:
 *   - MemoryOnboardingStore: browser-safe, zero I/O. Tests and the judged path use this.
 *   - SqliteOnboardingStore: SQLite through Node's built-in module. No new dependency. Node only, and live only.
 *
 * Stores hold rows and keep them consistent (one participant per household, a number used once, versions
 * that only ever grow). The rules about WHO may do WHAT live once, in ./onboarding.ts, and run identically
 * over either store; a parity test holds the two to the same answers.
 */
import { OnboardingError, type ConsentEvent, type Household, type Invitation, type Person, type Relationship, type SetupVersion } from "./types";

export interface OnboardingStore {
  /** Everything inside `work` is committed together or not at all, and no other transaction runs meanwhile. */
  transaction<T>(work: () => Promise<T>): Promise<T>;

  addHousehold(household: Household): Promise<void>;
  getHousehold(householdId: string): Promise<Household | null>;
  listHouseholds(): Promise<Household[]>;
  setHouseholdStatus(householdId: string, status: Household["status"]): Promise<void>;

  addPerson(person: Person): Promise<void>;
  /** Everyone who has ever been in the household, in the order they were added. A removed person keeps their row. */
  people(householdId: string): Promise<Person[]>;
  getPerson(personId: string): Promise<Person | null>;
  markRemoved(personId: string, at: string): Promise<void>;

  putRelationship(relationship: Relationship): Promise<void>;
  relationships(householdId: string): Promise<Relationship[]>;

  /** Append-only. The version must be exactly one more than the last. */
  appendSetupVersion(version: SetupVersion): Promise<void>;
  setupVersions(householdId: string): Promise<SetupVersion[]>;

  /** Append-only. */
  appendConsent(event: ConsentEvent): Promise<void>;
  consents(householdId: string): Promise<ConsentEvent[]>;

  addInvitation(invitation: Invitation): Promise<void>;
  invitations(householdId: string): Promise<Invitation[]>;
  invitationByTokenHash(tokenHash: string): Promise<Invitation | null>;
  resolveInvitation(invitationId: string, status: "accepted" | "withdrawn", at: string, personId: string | null): Promise<void>;
}

/** Transactions run one at a time, in the order they were asked for. Shared by both stores. */
export class Turnstile {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

const clone = <T>(v: T): T => structuredClone(v);

export class MemoryOnboardingStore implements OnboardingStore {
  private households = new Map<string, Household>();
  private persons = new Map<string, Person>();
  private rels: Relationship[] = [];
  private versions: SetupVersion[] = [];
  private consentLog: ConsentEvent[] = [];
  private invites = new Map<string, Invitation>();
  private readonly turnstile = new Turnstile();

  transaction<T>(work: () => Promise<T>): Promise<T> {
    return this.turnstile.run(async () => {
      const before = { households: clone(this.households), persons: clone(this.persons), rels: clone(this.rels), versions: clone(this.versions), consentLog: clone(this.consentLog), invites: clone(this.invites) };
      try {
        return await work();
      } catch (e) {
        Object.assign(this, before); // nothing half-done is left behind
        throw e;
      }
    });
  }

  async addHousehold(h: Household): Promise<void> {
    if (this.households.has(h.household_id)) throw new OnboardingError("already_exists", `household "${h.household_id}" already exists`);
    this.households.set(h.household_id, clone(h));
  }
  async getHousehold(id: string): Promise<Household | null> {
    const h = this.households.get(id);
    return h ? clone(h) : null;
  }
  async listHouseholds(): Promise<Household[]> {
    return [...this.households.values()].map(clone);
  }
  async setHouseholdStatus(id: string, status: Household["status"]): Promise<void> {
    const h = this.households.get(id);
    if (!h) throw new OnboardingError("not_found", `no household "${id}"`);
    h.status = status;
  }

  async addPerson(p: Person): Promise<void> {
    if (this.persons.has(p.person_id)) throw new OnboardingError("already_exists", `person "${p.person_id}" already exists`);
    if (!this.households.has(p.household_id)) throw new OnboardingError("not_found", `no household "${p.household_id}"`);
    const others = [...this.persons.values()];
    if (p.role === "participant" && others.some((o) => o.household_id === p.household_id && o.role === "participant")) throw new OnboardingError("already_exists", "a household has one participant");
    if (p.phone !== null && others.some((o) => o.phone === p.phone && o.removed_at === null)) throw new OnboardingError("already_exists", "that number already belongs to someone Recall calls");
    this.persons.set(p.person_id, clone(p));
  }
  async people(householdId: string): Promise<Person[]> {
    return [...this.persons.values()].filter((p) => p.household_id === householdId).map(clone);
  }
  async getPerson(id: string): Promise<Person | null> {
    const p = this.persons.get(id);
    return p ? clone(p) : null;
  }
  async markRemoved(id: string, at: string): Promise<void> {
    const p = this.persons.get(id);
    if (!p) throw new OnboardingError("not_found", `no person "${id}"`);
    p.removed_at = at;
  }

  async putRelationship(r: Relationship): Promise<void> {
    if (this.rels.some((x) => x.from_person_id === r.from_person_id && x.to_person_id === r.to_person_id && x.relation === r.relation)) throw new OnboardingError("already_exists", "that relationship has already been stated");
    this.rels.push(clone(r));
  }
  async relationships(householdId: string): Promise<Relationship[]> {
    return this.rels.filter((r) => r.household_id === householdId).map(clone);
  }

  async appendSetupVersion(v: SetupVersion): Promise<void> {
    const last = this.versions.filter((x) => x.household_id === v.household_id).length;
    if (v.version !== last + 1) throw new OnboardingError("invalid", `the next setup version is ${last + 1}, not ${v.version}`);
    this.versions.push(clone(v));
  }
  async setupVersions(householdId: string): Promise<SetupVersion[]> {
    return this.versions.filter((v) => v.household_id === householdId).map(clone);
  }

  async appendConsent(e: ConsentEvent): Promise<void> {
    this.consentLog.push(clone(e));
  }
  async consents(householdId: string): Promise<ConsentEvent[]> {
    return this.consentLog.filter((e) => e.household_id === householdId).map(clone);
  }

  async addInvitation(i: Invitation): Promise<void> {
    if (this.invites.has(i.invitation_id) || [...this.invites.values()].some((x) => x.token_hash === i.token_hash)) throw new OnboardingError("already_exists", "that invitation already exists");
    this.invites.set(i.invitation_id, clone(i));
  }
  async invitations(householdId: string): Promise<Invitation[]> {
    return [...this.invites.values()].filter((i) => i.household_id === householdId).map(clone);
  }
  async invitationByTokenHash(hash: string): Promise<Invitation | null> {
    const i = [...this.invites.values()].find((x) => x.token_hash === hash);
    return i ? clone(i) : null;
  }
  async resolveInvitation(id: string, status: "accepted" | "withdrawn", at: string, personId: string | null): Promise<void> {
    const i = this.invites.get(id);
    if (!i) throw new OnboardingError("not_found", `no invitation "${id}"`);
    if (i.status !== "pending") throw new OnboardingError("not_allowed", `that invitation was already ${i.status}`);
    Object.assign(i, { status, resolved_at: at, person_id: personId });
  }
}
