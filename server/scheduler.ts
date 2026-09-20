/** Scheduler-only entry. A durable lease prevents two workers from ringing the same household. */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { dataDirectory } from "./data-directory";
import { activeHousehold } from "./active-household";
import { getLiveRecall } from "./recall-live";
import { DurableAlerts } from "./alerts";
const globalState = globalThis as typeof globalThis & { __recallScheduler?: ReturnType<typeof setInterval>; __recallSchedulerError?: string };
function reportIssue(message: string) { if (globalState.__recallSchedulerError !== message) console.error("[recall-scheduler]", message); globalState.__recallSchedulerError = message; }
export function schedulerError() { return globalState.__recallSchedulerError ?? null; }
export async function scheduleTick() {
  const household = activeHousehold(); if (!household) return null;
  const dir = dataDirectory(process.cwd()); mkdirSync(dir, { recursive: true, mode: 0o700 }); const path = join(dir, "scheduler.db"), db = new DatabaseSync(path); chmodSync(path, 0o600);
  db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS scheduler (household TEXT PRIMARY KEY, owner TEXT, until_ms INTEGER NOT NULL)");
  const owner = randomUUID(), now = Date.now();
  const held = db.prepare("INSERT INTO scheduler VALUES (?,?,?) ON CONFLICT(household) DO UPDATE SET owner=excluded.owner,until_ms=excluded.until_ms WHERE scheduler.until_ms < ?").run(household, owner, now + 15 * 60000, now).changes;
  if (!held) { db.close(); return null; }
  try {
    const live = await getLiveRecall();
    if (live.alerts instanceof DurableAlerts) await live.alerts.retryPending().catch(() => { reportIssue("A caregiver handoff is waiting for delivery."); });
    const result = await live.tick();
    return result;
  } catch (e) { reportIssue("A scheduled call or caregiver handoff needs operator attention."); throw e; }
  finally { db.prepare("DELETE FROM scheduler WHERE household=? AND owner=?").run(household, owner); db.close(); }
}
export function startScheduler() {
  if (globalState.__recallScheduler || process.env.RECALL_SCHEDULER !== "1") return;
  globalState.__recallScheduler = setInterval(() => { void scheduleTick().catch(() => undefined); }, 30000);
  globalState.__recallScheduler.unref();
}
