/**
 * Onboarding records in SQLite, through Node's built-in `node:sqlite` - no new dependency. NODE ONLY, LIVE
 * ONLY: nothing on the judged path imports this.
 *
 * The schema does the part of the rules a database can do, so that even a bug above it cannot break them:
 *   - STRICT tables, foreign keys on, CHECKs on every closed list
 *   - one participant per household, and a phone number that belongs to one living record only
 *   - a phone number on anyone but the participant is refused (rule 5: Recall never contacts family)
 *   - setup versions and consent events are append-only: triggers abort any UPDATE or DELETE
 * There is no column anywhere for a diagnosis, a health record, a location, or a date of birth (rule 8).
 */
import { DatabaseSync } from "node:sqlite";
import { Turnstile, type OnboardingStore } from "./store";
import { OnboardingError, consentEventSchema, householdSchema, invitationSchema, personSchema, relationshipSchema, setupVersionSchema, type ConsentEvent, type Household, type Invitation, type Person, type Relationship, type SetupVersion } from "./types";

export const ONBOARDING_SCHEMA_VERSION = 1;

const DDL = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS households (
  household_id TEXT PRIMARY KEY,
  created_at   TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('onboarding', 'active', 'paused'))
) STRICT;
CREATE TABLE IF NOT EXISTS people (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id       TEXT NOT NULL UNIQUE,
  household_id    TEXT NOT NULL REFERENCES households (household_id),
  role            TEXT NOT NULL CHECK (role IN ('participant', 'caregiver', 'family')),
  display_name    TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  subject_pronoun TEXT,
  phone           TEXT,
  added_by        TEXT REFERENCES people (person_id),
  added_at        TEXT NOT NULL,
  removed_at      TEXT,
  CHECK (phone IS NULL OR role = 'participant'),
  CHECK (role <> 'participant' OR phone IS NOT NULL)
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS one_participant_per_household ON people (household_id) WHERE role = 'participant';
CREATE UNIQUE INDEX IF NOT EXISTS a_number_is_used_once ON people (phone) WHERE phone IS NOT NULL AND removed_at IS NULL;
CREATE TABLE IF NOT EXISTS relationships (
  seq            INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id   TEXT NOT NULL REFERENCES households (household_id),
  from_person_id TEXT NOT NULL REFERENCES people (person_id),
  to_person_id   TEXT NOT NULL REFERENCES people (person_id),
  relation       TEXT NOT NULL,
  said_as        TEXT,
  stated_by      TEXT NOT NULL REFERENCES people (person_id),
  stated_at      TEXT NOT NULL,
  UNIQUE (from_person_id, to_person_id, relation),
  CHECK (from_person_id <> to_person_id)
) STRICT;
CREATE TABLE IF NOT EXISTS setup_versions (
  household_id TEXT NOT NULL REFERENCES households (household_id),
  version      INTEGER NOT NULL CHECK (version > 0),
  kind         TEXT NOT NULL CHECK (kind IN ('joint', 'tightening')),
  document     TEXT NOT NULL,
  agreed_by    TEXT NOT NULL,
  recorded_by  TEXT NOT NULL REFERENCES people (person_id),
  recorded_at  TEXT NOT NULL,
  note         TEXT,
  PRIMARY KEY (household_id, version)
) STRICT;
CREATE TRIGGER IF NOT EXISTS setup_versions_are_append_only_u BEFORE UPDATE ON setup_versions BEGIN SELECT RAISE(ABORT, 'setup versions are append-only'); END;
CREATE TRIGGER IF NOT EXISTS setup_versions_are_append_only_d BEFORE DELETE ON setup_versions BEGIN SELECT RAISE(ABORT, 'setup versions are append-only'); END;
CREATE TABLE IF NOT EXISTS consent_events (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id TEXT NOT NULL REFERENCES households (household_id),
  person_id    TEXT NOT NULL REFERENCES people (person_id),
  kind         TEXT NOT NULL,
  at           TEXT NOT NULL,
  recorded_by  TEXT NOT NULL REFERENCES people (person_id)
) STRICT;
CREATE TRIGGER IF NOT EXISTS consent_events_are_append_only_u BEFORE UPDATE ON consent_events BEGIN SELECT RAISE(ABORT, 'consent events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS consent_events_are_append_only_d BEFORE DELETE ON consent_events BEGIN SELECT RAISE(ABORT, 'consent events are append-only'); END;
CREATE TABLE IF NOT EXISTS invitations (
  seq           INTEGER PRIMARY KEY AUTOINCREMENT,
  invitation_id TEXT NOT NULL UNIQUE,
  household_id  TEXT NOT NULL REFERENCES households (household_id),
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('caregiver', 'family')),
  invited_by    TEXT NOT NULL REFERENCES people (person_id),
  invited_at    TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'withdrawn')),
  resolved_at   TEXT,
  person_id     TEXT REFERENCES people (person_id)
) STRICT;
`;

type Row = Record<string, unknown>;

/** SQLite's own refusals, said in Recall's terms. Anything unrecognised is passed through untouched. */
function translate(e: unknown): never {
  const message = e instanceof Error ? e.message : String(e);
  if (/one_participant_per_household|people\.household_id/.test(message) && /UNIQUE/.test(message)) throw new OnboardingError("already_exists", "a household has one participant");
  if (/a_number_is_used_once|people\.phone/.test(message)) throw new OnboardingError("already_exists", "that number already belongs to someone Recall calls");
  if (/UNIQUE constraint failed/.test(message)) throw new OnboardingError("already_exists", message.replace("UNIQUE constraint failed: ", "already exists: "));
  if (/FOREIGN KEY constraint failed/.test(message)) throw new OnboardingError("not_found", "that refers to a household or a person that does not exist");
  if (/append-only/.test(message)) throw new OnboardingError("not_allowed", message);
  throw e;
}

export class SqliteOnboardingStore implements OnboardingStore {
  private readonly turnstile = new Turnstile();

  private constructor(private readonly db: DatabaseSync) {}

  /** `:memory:` for tests; a file path (under the git-ignored `.data/`) for a real deployment. */
  static open(path = ":memory:"): SqliteOnboardingStore {
    const db = new DatabaseSync(path);
    db.exec(DDL);
    const found = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
    if (!found) db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(String(ONBOARDING_SCHEMA_VERSION));
    else if (Number(found.value) !== ONBOARDING_SCHEMA_VERSION) throw new Error(`this onboarding database is schema version ${found.value}; this build expects ${ONBOARDING_SCHEMA_VERSION}`);
    return new SqliteOnboardingStore(db);
  }

  close(): void {
    this.db.close();
  }

  private run(sql: string, ...params: Array<string | number | null>): void {
    try {
      this.db.prepare(sql).run(...params);
    } catch (e) {
      translate(e);
    }
  }
  private all(sql: string, ...params: Array<string | number | null>): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }

  transaction<T>(work: () => Promise<T>): Promise<T> {
    return this.turnstile.run(async () => {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const out = await work();
        this.db.exec("COMMIT");
        return out;
      } catch (e) {
        if (this.db.isTransaction) this.db.exec("ROLLBACK");
        throw e;
      }
    });
  }

  // Every row is parsed back through its schema on the way out: what the database holds is never trusted as typed.

  async addHousehold(h: Household): Promise<void> {
    this.run("INSERT INTO households (household_id, created_at, status) VALUES (?, ?, ?)", h.household_id, h.created_at, h.status);
  }
  async getHousehold(id: string): Promise<Household | null> {
    const row = this.all("SELECT household_id, created_at, status FROM households WHERE household_id = ?", id)[0];
    return row ? householdSchema.parse(row) : null;
  }
  async listHouseholds(): Promise<Household[]> {
    return this.all("SELECT household_id, created_at, status FROM households ORDER BY rowid").map((r) => householdSchema.parse(r));
  }
  async setHouseholdStatus(id: string, status: Household["status"]): Promise<void> {
    if (!(await this.getHousehold(id))) throw new OnboardingError("not_found", `no household "${id}"`);
    this.run("UPDATE households SET status = ? WHERE household_id = ?", status, id);
  }

  private static person = (r: Row): Person => personSchema.parse({ person_id: r.person_id, household_id: r.household_id, role: r.role, display_name: r.display_name, subject_pronoun: r.subject_pronoun, phone: r.phone, added_by: r.added_by, added_at: r.added_at, removed_at: r.removed_at });

  async addPerson(p: Person): Promise<void> {
    this.run(
      "INSERT INTO people (person_id, household_id, role, display_name, subject_pronoun, phone, added_by, added_at, removed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      p.person_id, p.household_id, p.role, p.display_name, p.subject_pronoun, p.phone, p.added_by, p.added_at, p.removed_at,
    );
  }
  async people(householdId: string): Promise<Person[]> {
    return this.all("SELECT * FROM people WHERE household_id = ? ORDER BY seq", householdId).map(SqliteOnboardingStore.person);
  }
  async getPerson(id: string): Promise<Person | null> {
    const row = this.all("SELECT * FROM people WHERE person_id = ?", id)[0];
    return row ? SqliteOnboardingStore.person(row) : null;
  }
  async markRemoved(id: string, at: string): Promise<void> {
    if (!(await this.getPerson(id))) throw new OnboardingError("not_found", `no person "${id}"`);
    this.run("UPDATE people SET removed_at = ? WHERE person_id = ?", at, id);
  }

  async putRelationship(r: Relationship): Promise<void> {
    this.run("INSERT INTO relationships (household_id, from_person_id, to_person_id, relation, said_as, stated_by, stated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", r.household_id, r.from_person_id, r.to_person_id, r.relation, r.said_as, r.stated_by, r.stated_at);
  }
  async relationships(householdId: string): Promise<Relationship[]> {
    return this.all("SELECT household_id, from_person_id, to_person_id, relation, said_as, stated_by, stated_at FROM relationships WHERE household_id = ? ORDER BY seq", householdId).map((r) => relationshipSchema.parse(r));
  }

  async appendSetupVersion(v: SetupVersion): Promise<void> {
    const last = (this.all("SELECT COALESCE(MAX(version), 0) AS v FROM setup_versions WHERE household_id = ?", v.household_id)[0]!.v as number) ?? 0;
    if (v.version !== last + 1) throw new OnboardingError("invalid", `the next setup version is ${last + 1}, not ${v.version}`);
    this.run("INSERT INTO setup_versions (household_id, version, kind, document, agreed_by, recorded_by, recorded_at, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", v.household_id, v.version, v.kind, JSON.stringify(v.document), JSON.stringify(v.agreed_by), v.recorded_by, v.recorded_at, v.note);
  }
  async setupVersions(householdId: string): Promise<SetupVersion[]> {
    return this.all("SELECT * FROM setup_versions WHERE household_id = ? ORDER BY version", householdId).map((r) => setupVersionSchema.parse({ ...r, document: JSON.parse(r.document as string), agreed_by: JSON.parse(r.agreed_by as string) }));
  }

  async appendConsent(e: ConsentEvent): Promise<void> {
    this.run("INSERT INTO consent_events (household_id, person_id, kind, at, recorded_by) VALUES (?, ?, ?, ?, ?)", e.household_id, e.person_id, e.kind, e.at, e.recorded_by);
  }
  async consents(householdId: string): Promise<ConsentEvent[]> {
    return this.all("SELECT household_id, person_id, kind, at, recorded_by FROM consent_events WHERE household_id = ? ORDER BY seq", householdId).map((r) => consentEventSchema.parse(r));
  }

  private static invitation = (r: Row): Invitation => invitationSchema.parse({ invitation_id: r.invitation_id, household_id: r.household_id, display_name: r.display_name, role: r.role, invited_by: r.invited_by, invited_at: r.invited_at, token_hash: r.token_hash, status: r.status, resolved_at: r.resolved_at, person_id: r.person_id });

  async addInvitation(i: Invitation): Promise<void> {
    this.run("INSERT INTO invitations (invitation_id, household_id, display_name, role, invited_by, invited_at, token_hash, status, resolved_at, person_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", i.invitation_id, i.household_id, i.display_name, i.role, i.invited_by, i.invited_at, i.token_hash, i.status, i.resolved_at, i.person_id);
  }
  async invitations(householdId: string): Promise<Invitation[]> {
    return this.all("SELECT * FROM invitations WHERE household_id = ? ORDER BY seq", householdId).map(SqliteOnboardingStore.invitation);
  }
  async invitationByTokenHash(hash: string): Promise<Invitation | null> {
    const row = this.all("SELECT * FROM invitations WHERE token_hash = ?", hash)[0];
    return row ? SqliteOnboardingStore.invitation(row) : null;
  }
  async resolveInvitation(id: string, status: "accepted" | "withdrawn", at: string, personId: string | null): Promise<void> {
    const row = this.all("SELECT status FROM invitations WHERE invitation_id = ?", id)[0];
    if (!row) throw new OnboardingError("not_found", `no invitation "${id}"`);
    if (row.status !== "pending") throw new OnboardingError("not_allowed", `that invitation was already ${row.status as string}`);
    this.run("UPDATE invitations SET status = ?, resolved_at = ?, person_id = ? WHERE invitation_id = ?", status, at, personId, id);
  }
}
