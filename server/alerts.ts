/** Durable, designated-caregiver-only safety handoff. Payloads are fixed script text, never her words. */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import type { SafetyAlert, AlertChannel } from "@/lib/safety/alert";
import { dataDirectory } from "./data-directory";
export class DurableAlerts implements AlertChannel {
  private db: DatabaseSync;
  constructor(root: string, private household: string, private post: typeof fetch = fetch) {
    const dir = dataDirectory(root); mkdirSync(dir, { recursive: true, mode: 0o700 }); const path = join(dir, "alerts.db"); this.db = new DatabaseSync(path); chmodSync(path, 0o600);
    this.db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS alerts (household TEXT NOT NULL, id TEXT NOT NULL, caregiver TEXT NOT NULL, data TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(household,id))");
  }
  async send(alert: SafetyAlert) {
    this.db.prepare("INSERT OR IGNORE INTO alerts(household,id,caregiver,data) VALUES (?,?,?,?)").run(this.household, alert.alert_id, alert.caregiver_id, JSON.stringify(alert));
    const row = this.db.prepare("SELECT delivered, data FROM alerts WHERE household=? AND id=?").get(this.household, alert.alert_id)!;
    if (row.delivered) return;
    const original = JSON.parse(row.data as string) as SafetyAlert;
    if (original.channel !== "dashboard") {
      const config = webhookFor(original.caregiver_id);
      if (original.channel !== "webhook" || !config) throw new Error("The designated safety channel is not configured.");
      const response = await this.post(config.url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(8000), headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}`, "Idempotency-Key": original.alert_id }, body: JSON.stringify(original) });
      if (!response.ok) throw new Error("The safety channel did not accept the handoff.");
    }
    this.db.prepare("UPDATE alerts SET delivered=1 WHERE household=? AND id=?").run(this.household, original.alert_id);
  }
  sentTo(id: string): SafetyAlert[] { return this.db.prepare("SELECT data FROM alerts WHERE household=? AND caregiver=? ORDER BY id").all(this.household, id).map((r) => JSON.parse(r.data as string)); }
  async retryPending() {
    let failed = false;
    for (const row of this.db.prepare("SELECT data FROM alerts WHERE household=? AND delivered=0").all(this.household)) {
      try { await this.send(JSON.parse(row.data as string)); }
      catch { failed = true; } // One unavailable caregiver channel must not hold up the others.
    }
    if (failed) throw new Error("Some caregiver handoffs are still waiting for delivery.");
  }
  close() { this.db.close(); }
}
export function webhookFor(id: string): { url: string; token: string } | null {
  try { const c = JSON.parse(process.env.RECALL_SAFETY_WEBHOOKS || "{}")[id]; return c && typeof c.url === "string" && new URL(c.url).protocol === "https:" && typeof c.token === "string" && c.token.length >= 32 ? c : null; } catch { return null; }
}
