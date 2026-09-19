/**
 * Tools 18-19: the safety handoff (AGENTS.md rule 15).
 *
 * Recall is not an emergency service, and it does not sit on a safety concern.
 * The check is a lexical match on her literal words - never a judgment about
 * her - and the alert is fixed text: a category and a time, to the designated
 * caregivers only. Neither tool has a field in which her words could travel.
 */
import { RECALL_AGENT_ID, type Provenance } from "@/lib/graph/types";
import { turnText } from "@/lib/providers/transcription";
import { matchSafetyPhrase } from "@/lib/safety/phrases";
import { fill } from "@/lib/script/call-script";
import type { ToolImpl } from "../runtime";

export const check_safety_phrases: ToolImpl<"check_safety_phrases"> = async (input, ctx) => {
  // Her turns only. Recall's own speech, and her own audio played back to her, are never checked.
  const turn = (await ctx.transcription.turnsIn(input.audio_window)).filter((t) => t.speaker === "participant" && t.is_final && t.words.length > 0).at(-1);
  if (!turn) return { turn_id: null, category: null };
  const match = matchSafetyPhrase(ctx.safetyPhrases, turnText(turn));
  if (match) ctx.session.safety_category = match.category;
  return { turn_id: turn.turn_id, category: match?.category ?? null };
};

/** "5 November 2026, 17:31 UTC". Built from the given instant; reads no clock. */
const readableTime = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

export const send_safety_alert: ToolImpl<"send_safety_alert"> = async (input, ctx) => {
  const policy = ctx.setup.current();
  const entry = ctx.safetyPhrases.categories[input.category];
  if (!entry) throw new Error(`"${input.category}" is not a category on the safety list`);
  const at = ctx.clock.iso();
  const her = await ctx.graph.getNode(policy.person_id);
  const name = her?.type === "Person" ? her.props.display_name : "";

  const sent: Array<{ alert_id: string; caregiver_id: string; channel: string; script_id: string }> = [];
  const skipped: Array<{ caregiver_id: string; reason: "not_a_designated_caregiver" | "already_alerted_this_call" }> = [];
  let failure: unknown = null;
  for (const caregiverId of [...new Set(input.caregiver_ids)]) {
    // Designated caregivers only. Nobody else can be alerted, whoever asks.
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
      script_id: ctx.safetyPhrases.alert.id,
      category: input.category,
      at,
      caregiver_id: caregiverId,
      channel: designated.alert_channel,
      // Fixed text: her name, the category's fixed label, and the time. Nothing she said.
      text: fill(ctx.safetyPhrases.alert, { time: readableTime(at), name, category: entry.label }),
    };
    try {
      await ctx.alerts.send(alert);
    } catch (e) {
      // One caregiver's channel failing must not cost the others their alert, and must not use up this one's:
      // the claim is given back, so a second try can still reach them.
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

  // The record: category, time, and who was told (rule 8).
  const logId = `artifact:safety-log:${ctx.session.session_id}`;
  const prov: Provenance = {
    source_id: logId,
    source_class: "session_audit",
    asset_id: null,
    media_hash: null,
    span: null,
    observed_at: at,
    author: RECALL_AGENT_ID,
    extraction_method: "system_event",
    confidence: 1,
    audience_scope: [policy.person_id],
    expires_at: null,
    supersedes: [],
    contradicts: [],
    status: "reference",
    patient_confirmed: false,
    confirmations: [],
  };
  if (!(await ctx.graph.getNode(logId))) await ctx.graph.putNode({ id: logId, type: "Artifact", label: "Recall's safety log for this call", props: { kind: "audit_log", text: null, alt: null }, prov });
  const eventId = `safety-event:${ctx.session.session_id}:${input.category}`;
  await ctx.graph.putNode({ id: eventId, type: "SafetyEvent", label: "Safety handoff", props: { category: input.category, at, recipients: sent.map((s) => s.caregiver_id) }, prov });
  ctx.session.safety_alert_sent = true;
  // Someone was told, and that is on record. If another caregiver's channel failed, say so: a second try skips whoever was reached.
  if (failure !== null) throw failure;
  return { sent, skipped, safety_event_id: eventId };
};
