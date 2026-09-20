/**
 * Tools 18-21: the safety handoff, missed-call alerts, and caregiver ack
 * (AGENTS.md rule 15).
 *
 * Recall is not an emergency service, and it does not sit on a safety concern.
 * The phrase check is a lexical match on her literal words - never a judgment
 * about her. The alert is fixed text: a category and a time, never her words.
 * Missed-call alerts never run through this check; they share only the send
 * and the ack/escalation path.
 */
import { RECALL_AGENT_ID, type Provenance, type SafetyEventNode } from "@/lib/graph/types";
import { turnText } from "@/lib/providers/transcription";
import { caregiverPhone, escalateAfterIso, originalAlert, phoneDigits, stillPendingAlert } from "@/lib/safety/ack";
import { MISSED_CALLS_CATEGORY, readMissedCallState } from "@/lib/safety/missed-calls";
import { matchSafetyPhrase } from "@/lib/safety/phrases";
import { fill } from "@/lib/script/call-script";
import type { ToolContext } from "../context";
import type { ToolImpl } from "../runtime";

export const check_safety_phrases: ToolImpl<"check_safety_phrases"> = async (input, ctx) => {
  // Her turns only. Recall's own speech, and her own audio played back to her, are never checked.
  const turn = (await ctx.transcription.turnsIn(input.audio_window)).filter((t) => t.speaker === "participant" && t.is_final && t.words.length > 0).at(-1);
  if (!turn) return { turn_id: null, category: null };
  const match = matchSafetyPhrase(ctx.safetyPhrases, turnText(turn));
  if (match) ctx.session.safety_category = match.category;
  return { turn_id: turn.turn_id, category: match?.category ?? null };
};

/** "2026-11-05 15:30 UTC". Built from the given instant; reads no clock. */
const readableTime = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

function safetyProv(logId: string, at: string, personId: string): Provenance {
  return {
    source_id: logId,
    source_class: "session_audit",
    asset_id: null,
    media_hash: null,
    span: null,
    observed_at: at,
    author: RECALL_AGENT_ID,
    extraction_method: "system_event",
    confidence: 1,
    audience_scope: [personId],
    expires_at: null,
    supersedes: [],
    contradicts: [],
    status: "reference",
    patient_confirmed: false,
    confirmations: [],
  };
}

async function herName(ctx: ToolContext, personId: string): Promise<string> {
  const her = await ctx.graph.getNode(personId);
  return her?.type === "Person" ? her.props.display_name : "";
}

function alertText(ctx: ToolContext, category: string, at: string, name: string, detailCount: number | null): { text: string; script_id: string } {
  const time = readableTime(at);
  const body =
    category === MISSED_CALLS_CATEGORY
      ? fill(ctx.safetyPhrases.missed_calls_alert, { time, name, count: String(detailCount ?? 0) })
      : fill(ctx.safetyPhrases.alert, { time, name, category: ctx.safetyPhrases.categories[category]!.label });
  return { text: `${body} ${ctx.safetyPhrases.ack_prompt.text}`, script_id: category === MISSED_CALLS_CATEGORY ? ctx.safetyPhrases.missed_calls_alert.id : ctx.safetyPhrases.alert.id };
}

export const send_safety_alert: ToolImpl<"send_safety_alert"> = async (input, ctx) => {
  const policy = ctx.setup.current();
  const missed = input.category === MISSED_CALLS_CATEGORY;
  const entry = ctx.safetyPhrases.categories[input.category];
  if (!missed && !entry) throw new Error(`"${input.category}" is not a category on the safety list`);
  const at = ctx.clock.iso();
  const name = await herName(ctx, policy.person_id);
  const detailCount = missed ? (await readMissedCallState(ctx.graph)).streak : null;
  const rendered = alertText(ctx, input.category, at, name, detailCount);
  const escalateAfter = escalateAfterIso(at, ctx.safetyThresholds.ack_timeout_minutes, policy.safety.backup_caregiver_id !== null);

  const sent: Array<{ alert_id: string; caregiver_id: string; channel: string; script_id: string }> = [];
  const skipped: Array<{ caregiver_id: string; reason: "not_a_designated_caregiver" | "already_alerted_this_call" }> = [];
  let failure: unknown = null;
  for (const caregiverId of [...new Set(input.caregiver_ids)]) {
    const designated = policy.safety.designated_caregivers.find((c) => c.person_id === caregiverId);
    if (!designated) {
      skipped.push({ caregiver_id: caregiverId, reason: "not_a_designated_caregiver" });
      continue;
    }
    if (!ctx.gate.claimAlert(input.category, caregiverId)) {
      skipped.push({ caregiver_id: caregiverId, reason: "already_alerted_this_call" });
      continue;
    }
    const alert = {
      alert_id: `safety-alert:${ctx.session.session_id}:${input.category}:${caregiverId}`,
      script_id: rendered.script_id,
      category: input.category,
      at,
      caregiver_id: caregiverId,
      channel: designated.alert_channel,
      text: rendered.text,
    };
    try {
      await ctx.alerts.send(alert);
    } catch (e) {
      ctx.gate.releaseAlert(input.category, caregiverId);
      failure ??= e;
      continue;
    }
    sent.push({ alert_id: alert.alert_id, caregiver_id: caregiverId, channel: alert.channel, script_id: alert.script_id });
  }
  if (sent.length === 0) {
    if (failure !== null) throw failure;
    return { sent, skipped, safety_event_id: null };
  }

  const logId = `artifact:safety-log:${ctx.session.session_id}`;
  const prov = safetyProv(logId, at, policy.person_id);
  if (!(await ctx.graph.getNode(logId))) await ctx.graph.putNode({ id: logId, type: "Artifact", label: "Recall's safety log for this call", props: { kind: "audit_log", text: null, alt: null }, prov });

  let firstEventId: string | null = null;
  for (const s of sent) {
    const eventId = `safety-event:${ctx.session.session_id}:${input.category}:${s.caregiver_id}`;
    firstEventId ??= eventId;
    const phone = caregiverPhone(policy, s.caregiver_id);
    await ctx.graph.putNode({
      id: eventId,
      type: "SafetyEvent",
      label: missed ? "Missed-call note" : "Safety handoff",
      props: {
        category: input.category,
        at,
        recipients: [s.caregiver_id],
        alert_id: s.alert_id,
        acknowledged_at: null,
        acknowledged_by: null,
        escalated_at: null,
        escalate_after: escalateAfter,
        caregiver_id: s.caregiver_id,
        caregiver_phone: phone ? phoneDigits(phone) : null,
        detail_count: detailCount,
      },
      prov,
    });
  }
  ctx.session.safety_alert_sent = true;
  if (failure !== null) throw failure;
  return { sent, skipped, safety_event_id: firstEventId };
};

export const record_alert_ack: ToolImpl<"record_alert_ack"> = async (input, ctx) => {
  const event = await originalAlert(ctx.graph, input.alert_id);
  if (!event || !(await stillPendingAlert(ctx.graph, input.alert_id)) || event.props.caregiver_id !== input.caregiver_id) {
    return { status: "noop", alert_id: input.alert_id, acknowledged_at: null };
  }
  const at = ctx.clock.iso();
  const next: SafetyEventNode = {
    ...event,
    id: `${event.id}:ack`,
    props: { ...event.props, acknowledged_at: at, acknowledged_by: input.caregiver_id, escalate_after: null },
  };
  await ctx.graph.putNode(next);
  return { status: "acknowledged", alert_id: input.alert_id, acknowledged_at: at };
};

export const escalate_safety_alert: ToolImpl<"escalate_safety_alert"> = async (input, ctx) => {
  const event = await originalAlert(ctx.graph, input.alert_id);
  const policy = ctx.setup.current();
  const backup = policy.safety.backup_caregiver_id;
  if (!event || !(await stillPendingAlert(ctx.graph, input.alert_id)) || backup === null) {
    return { status: "noop", alert_id: input.alert_id, backup_caregiver_id: backup };
  }
  const at = ctx.clock.iso();
  if (!event.props.recipients.includes(backup)) {
    const name = await herName(ctx, policy.person_id);
    const rendered = alertText(ctx, event.props.category, event.props.at, name, event.props.detail_count);
    await ctx.alerts.send({
      alert_id: `${event.props.alert_id}:escalated`,
      script_id: rendered.script_id,
      category: event.props.category,
      at: event.props.at,
      caregiver_id: backup,
      channel: "sms",
      text: rendered.text,
    });
  }
  await ctx.graph.putNode({
    ...event,
    id: `${event.id}:escalated`,
    props: { ...event.props, recipients: event.props.recipients.includes(backup) ? event.props.recipients : [...event.props.recipients, backup], escalated_at: at, escalate_after: null },
  });
  return { status: "escalated", alert_id: input.alert_id, backup_caregiver_id: backup };
};
