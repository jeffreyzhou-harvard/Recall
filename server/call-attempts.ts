/** Ring timestamps survive a server restart. They contain no audio, transcript, or inferred outcome. */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { dataDirectory } from "./data-directory";
export class CallAttempts {
  private db: DatabaseSync;
  constructor(root: string, private household: string) {
    const dir = dataDirectory(root); mkdirSync(dir, { recursive: true, mode: 0o700 }); const path = join(dir, "call-attempts.db"); this.db = new DatabaseSync(path); chmodSync(path, 0o600);
    this.db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS attempts (household TEXT NOT NULL, session TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(household,session))");
  }
  record(session_id: string, at: string) { this.db.prepare("INSERT OR IGNORE INTO attempts VALUES (?,?,?)").run(this.household, session_id, at); }
  all(): Array<{ session_id: string; at: string }> { return this.db.prepare("SELECT session AS session_id, at FROM attempts WHERE household=? ORDER BY at").all(this.household) as Array<{ session_id: string; at: string }>; }
  close() { this.db.close(); }
}
