/**
 * Reply-1 acknowledgment and the one-tier backup escalation (AGENTS.md rule 15).
 *
 * The inbound body is a keyword, not a link. Anything other than `1` (trimmed,
 * case-insensitive) is ignored. A second `1`, a reply after ack or escalation,
 * or a `1` with nothing pending, is a silent no-op: no response text, nothing
 * leaked.
 *
 * The graph never overwrites a node, so an ack or an escalation is a new
 * SafetyEvent that shares `alert_id` with the original.
 */
import type { SafetyEventNode } from "@/lib/graph/types";
import type { GraphStore } from "@/lib/graph/store";
import type { AccessPolicy } from "@/lib/tools/policy";

export const ACK_BODY = "1";

export const isAckBody = (body: string): boolean => body.trim().toLowerCase() === ACK_BODY;

/** Digits only, so "+1 (609) 555-0111" and "+16095550111" are the same number. */
export const phoneDigits = (phone: string): string => phone.replace(/\D/g, "");

export function caregiverPhone(policy: AccessPolicy, caregiverId: string): string | null {
  return policy.safety.designated_caregivers.find((c) => c.person_id === caregiverId)?.phone ?? null;
}

export function caregiverForPhone(policy: AccessPolicy, from: string): string | null {
  const digits = phoneDigits(from);
  if (!digits) return null;
  const hit = policy.safety.designated_caregivers.find((c) => c.phone !== null && phoneDigits(c.phone) === digits);
  return hit?.person_id ?? null;
}

export async function safetyEvents(graph: GraphStore): Promise<SafetyEventNode[]> {
  return graph.nodesOfType("SafetyEvent");
}

export async function eventsForAlert(graph: GraphStore, alertId: string): Promise<SafetyEventNode[]> {
  return (await safetyEvents(graph)).filter((e) => e.props.alert_id === alertId);
}

export const groupIsPending = (events: readonly SafetyEventNode[]): boolean =>
  events.length > 0 && events.every((e) => e.props.acknowledged_at === null && e.props.escalated_at === null);

export async function stillPendingAlert(graph: GraphStore, alertId: string): Promise<boolean> {
  return groupIsPending(await eventsForAlert(graph, alertId));
}

/** The original send for this alert_id - the one that started the timer. */
export async function originalAlert(graph: GraphStore, alertId: string): Promise<SafetyEventNode | null> {
  return (
    (await eventsForAlert(graph, alertId))
      .filter((e) => e.props.acknowledged_at === null && e.props.escalated_at === null)
      .sort((a, b) => (a.props.at < b.props.at ? -1 : a.props.at > b.props.at ? 1 : 0))[0] ?? null
  );
}

/** Most recent pending alert for this caregiver. No multi-alert disambiguation (Appendix B). */
export async function mostRecentPendingFor(graph: GraphStore, caregiverId: string): Promise<SafetyEventNode | null> {
  const all = await safetyEvents(graph);
  const alertIds = [...new Set(all.filter((e) => e.props.caregiver_id === caregiverId).map((e) => e.props.alert_id))];
  const pending: SafetyEventNode[] = [];
  for (const alertId of alertIds) {
    const group = all.filter((e) => e.props.alert_id === alertId);
    if (groupIsPending(group)) {
      const original = group.sort((a, b) => (a.props.at < b.props.at ? -1 : 1))[0];
      if (original) pending.push(original);
    }
  }
  return pending.sort((a, b) => (a.props.at < b.props.at ? 1 : a.props.at > b.props.at ? -1 : 0))[0] ?? null;
}

export async function alertsDueToEscalate(graph: GraphStore, nowIso: string): Promise<SafetyEventNode[]> {
  const all = await safetyEvents(graph);
  const alertIds = [...new Set(all.map((e) => e.props.alert_id))];
  const due: SafetyEventNode[] = [];
  for (const alertId of alertIds) {
    const group = all.filter((e) => e.props.alert_id === alertId);
    if (!groupIsPending(group)) continue;
    const original = group.sort((a, b) => (a.props.at < b.props.at ? -1 : 1))[0];
    if (original && original.props.escalate_after !== null && original.props.escalate_after <= nowIso) due.push(original);
  }
  return due;
}

export function escalateAfterIso(sentAt: string, ackTimeoutMinutes: number, hasBackup: boolean): string | null {
  if (!hasBackup) return null;
  return new Date(Date.parse(sentAt) + ackTimeoutMinutes * 60_000).toISOString();
}
