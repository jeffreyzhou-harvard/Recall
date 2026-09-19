/**
 * Tools 11, 12, 14, 15, 16: the family flows (AGENTS.md section 6.4).
 *
 * None of them enters the call sequence, and none of them can reach the graph:
 * their context holds a `FamilyView` and nothing else that reads a claim. What
 * they return is fixed lines, topic names, counts, dates - and, in exactly one
 * place, a line she said yes to sharing.
 *
 * Relay never pushes any of this. It appears when an approved member opens the
 * dashboard (rule 5).
 */
import { buildTopicRecord, renderExport } from "@/lib/family/record";
import { fill, normalize } from "@/lib/script/call-script";
import { lintLines } from "@/lib/script/lint";
import type { ToolOutput } from "../contracts";
import type { FamilyToolContext } from "../context";
import { dashboardAccess } from "../policy";
import type { ToolImpl } from "../runtime";

const DAY_MS = 86_400_000;
const daysBefore = (iso: string, days: number): string => new Date(Date.parse(iso) - days * DAY_MS).toISOString();

/** Section 6.4.1: the contribution form is for telling, not asking. */
function opensAsAQuestion(text: string, openers: readonly string[]): boolean {
  const firstSentence = text.trim().split(/(?<=[.?!])\s+/)[0] ?? "";
  if (firstSentence.trim().endsWith("?")) return true;
  const start = normalize(text).trimStart();
  return openers.some((o) => start.startsWith(`${normalize(o).trim()} `));
}

export const receive_family_contribution: ToolImpl<"receive_family_contribution"> = async (input, ctx) => {
  const policy = ctx.setup.current();
  const herName = await ctx.view.herName();
  if (!policy.approved_people.includes(input.contributor_id)) return { status: "refused", reason: "contributor_not_approved" };
  if (opensAsAQuestion(input.claim.what_happened, ctx.copy.question_openers)) {
    // Nothing is stored. The box is for a memory; to find out what she remembers, the answer is to call her.
    const hint = ctx.copy.lines.contribution_question_hint;
    return { status: "rejected_question", line: { script_id: hint.id, text: fill(hint, { name: herName }) } };
  }
  if (input.claim.about_topic_id !== null && !(await ctx.view.isKnownTopic(input.claim.about_topic_id))) return { status: "refused", reason: "topic_not_known" };

  const photo = input.claim.photo_asset_id ? ctx.assets.get(input.claim.photo_asset_id) : null;
  const ref = await ctx.view.storeFamilyContribution({
    contributor_id: input.contributor_id,
    policy_id: policy.policy_id,
    who: input.claim.who,
    what_happened: input.claim.what_happened,
    when_where: input.claim.when_where,
    photo_asset: photo ? { asset_id: photo.id, sha256: photo.sha256 } : null,
    about_topic_id: input.claim.about_topic_id,
    medium: input.provenance.medium,
    received_at: input.provenance.received_at,
  });
  const thanks = ctx.copy.lines.contribution_thanks;
  return { status: "stored_as_family_claim", contribution_ref: ref, patient_confirmed: false, line: { script_id: thanks.id, text: fill(thanks, { name: herName }) } };
};

/**
 * Rule 10. However the question is phrased, the reply is one of two fixed lines, and which one depends on a
 * single boolean about the whole graph - never on the question - so it cannot be used to find out whether she
 * has said anything about a particular thing. The category is read from the QUESTION's own words.
 */
export const handle_family_query: ToolImpl<"handle_family_query"> = async (input, ctx) => {
  const asked = normalize(input.question);
  const has = (words: readonly string[]): boolean => words.some((w) => asked.includes(normalize(w)));
  const q = ctx.copy.query_categories;
  const category = has(q.event) ? "event" : has(q.place) ? "place" : has(q.person) ? "person" : "other";

  const at = ctx.clock.iso();
  const line = (await ctx.view.hasAnythingOfHers()) ? ctx.script.lines.family_redirect : ctx.script.lines.family_nothing_yet;
  const text = line.id === ctx.script.lines.family_redirect.id ? fill(line, { name: await ctx.view.herName() }) : fill(line, {});
  await ctx.view.logFamilyQuery(category, at);
  return { status: "redirected", line: { script_id: line.id, text }, graph_content: [], logged: { category, at } };
};

export const build_weekly_note: ToolImpl<"build_weekly_note"> = async (input, ctx) => {
  const now = input.week.now;
  const policy = ctx.setup.current();
  const access = dashboardAccess(policy, input.member_id);
  if (access === null) {
    await ctx.view.logAccess(input.member_id, "refused", "weekly_note", now);
    return { status: "no_access", note: null };
  }
  const days = ctx.thresholds.weekly_note_days;
  const since = daysBefore(now, days);
  // The cap: at most one note per member per 7 days, whatever there is to say (rule 5).
  if ((await ctx.view.notePostedAtsFor(input.member_id)).some((at) => at > since)) return { status: "cap_reached", note: null };

  const herName = await ctx.view.herName();
  type Line = NonNullable<ToolOutput<"build_weekly_note">["note"]>["lines"][number];
  const lines: Line[] = [];
  const fixed = (kind: Line["kind"], l: { id: string; text: string }, values: Record<string, string>): void => void lines.push({ kind, script_id: l.id, text: fill(l, values), attribution: null });

  // 1. A warm line: topic-only and observable. Never a claim about what she was thinking or feeling (rule 4).
  const talkedAbout = (await ctx.view.topicsTalkedAboutSince(since))[0];
  if (talkedAbout) fixed("warm", ctx.copy.lines.note_warm, { name: herName, topic: talkedAbout.spoken_as });

  // 2. At most one line she chose to share: her own words, exactly, attributed to her.
  const shared = (await ctx.view.sharedLines(since, input.member_id))[0] ?? null;
  if (shared) lines.push({ kind: "share", script_id: "SHARED-BY-HER", text: shared.text, attribution: { speaker_name: shared.speaker_name, share_confirmed_at: shared.share_confirmed_at, content_hash: shared.content_hash } });

  // 3. At most one gap or difference prompt. Relay never says which account is right.
  const differently = (await ctx.view.membersWhoRememberDifferently())[0];
  const noYear = (await ctx.view.topicsWithoutAYear())[0];
  if (differently) fixed("difference", ctx.copy.lines.note_difference, { name: herName, member: differently });
  else if (noYear && talkedAbout) fixed("gap", ctx.copy.lines.note_gap, { topic: noYear });

  // 4. The pointer line, only when a change line is active on the record - and only for a member who can see the record.
  if (access === "weekly_note_and_record") {
    const record = buildTopicRecord(await ctx.view.outcomeRows(), herName, ctx.copy, ctx.thresholds);
    if (record.change_lines.length > 0) fixed("pointer", ctx.copy.lines.note_pointer, { name: herName });
  }

  // An empty week posts nothing.
  if (lines.length === 0) return { status: "nothing_to_post", note: null };
  const findings = lintLines(lines.filter((l) => l.kind !== "share").map((l) => ({ id: l.script_id, text: l.text, surface: "family" as const })), ctx.script.banned);
  if (findings.length > 0) throw new Error(`the Weekly Note would contain language Relay never uses: "${findings[0]!.phrase}"`);

  await ctx.view.postNote(input.member_id, now, lines.map((l) => ({ script_id: l.script_id, text: l.text })), shared?.ref ?? null);
  return { status: "posted", note: { posted_at: now, lines } };
};

export const get_topic_record: ToolImpl<"get_topic_record"> = async (input, ctx) => {
  const at = ctx.clock.iso();
  if (dashboardAccess(ctx.setup.current(), input.member_id) !== "weekly_note_and_record") {
    await ctx.view.logAccess(input.member_id, "refused", "topic_record", at);
    return { status: "no_access", header: null, topics: [], change_lines: [], summary_line: null };
  }
  const record = buildTopicRecord(await ctx.view.outcomeRows(), await ctx.view.herName(), ctx.copy, ctx.thresholds);
  await ctx.view.logAccess(input.member_id, "viewed", "topic_record", at);
  return { status: "ok", header: record.header, topics: record.topics, change_lines: record.change_lines, summary_line: record.summary_line };
};

export const export_record_for_clinician: ToolImpl<"export_record_for_clinician"> = async (input, ctx) => {
  const at = ctx.clock.iso();
  // Approved members who can see the record, and nobody else. Relay hands the file back; it never sends it anywhere.
  if (dashboardAccess(ctx.setup.current(), input.requester_id) !== "weekly_note_and_record") {
    await ctx.view.logAccess(input.requester_id, "refused", "export", at);
    return { status: "refused", file: null };
  }
  const record = buildTopicRecord(await ctx.view.outcomeRows(), await ctx.view.herName(), ctx.copy, ctx.thresholds);
  await ctx.view.logExport(input.requester_id, at);
  return { status: "exported", file: { filename: `relay-record-${at.slice(0, 10)}.txt`, generated_at: at, text: renderExport(record, ctx.copy, at) } };
};

export type { FamilyToolContext };
