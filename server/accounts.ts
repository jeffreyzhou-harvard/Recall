/** Opaque, revocable access keys. Only hashes are stored; keys are handed over by the caregiver. */
import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { dataDirectory } from "./data-directory";
export type Account = { member_id: string; household_id: string; role: "family" | "patient"; verifier: string };
const hash = (key: string) => createHash("sha256").update(key).digest("hex");
function withDb<T>(work: (db: DatabaseSync) => T): T {
  const dir = dataDirectory(process.cwd()); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "accounts.db"), db = new DatabaseSync(path);
  try {
    chmodSync(path, 0o600);
    db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS accounts (member_id TEXT PRIMARY KEY, household_id TEXT NOT NULL, role TEXT NOT NULL, verifier TEXT UNIQUE NOT NULL)");
    return work(db);
  } finally { db.close(); }
}
export function issueAccount(household: string, member: string, role: Account["role"]): string {
  const key = randomBytes(32).toString("base64url");
  withDb((db) => db.prepare("INSERT INTO accounts VALUES (?, ?, ?, ?) ON CONFLICT(member_id) DO UPDATE SET household_id=excluded.household_id,role=excluded.role,verifier=excluded.verifier").run(member, household, role, hash(key)));
  return key;
}
export function revokeAccount(member: string): void { withDb((db) => db.prepare("DELETE FROM accounts WHERE member_id=?").run(member)); }
export function accountForKey(key: string): Account | undefined { return withDb((db) => db.prepare("SELECT * FROM accounts WHERE verifier=?").get(hash(key)) as Account | undefined); }
export function accountForMember(member: string): Account | undefined { return withDb((db) => db.prepare("SELECT * FROM accounts WHERE member_id=?").get(member) as Account | undefined); }
