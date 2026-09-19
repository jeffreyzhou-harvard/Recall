/**
 * The per-topic record and its change lines (AGENTS.md sections 6.4.3, 6.4.4).
 *
 * Pure functions over TopicOutcome rows: the same events always produce the
 * same output. Counts and dates, per topic, compared only with her own earlier
 * Recall calls by the fixed rule below. There is deliberately nothing here that
 * adds topics together, ranks them, or names a cause - so none of that can
 * appear on a family surface (rule 4).
 *
 * Every number comes from /fixtures/record-thresholds.json and every word from
 * /fixtures/family-copy.json.
 */
import { fill } from "@/lib/script/call-script";
import type { FamilyCopy, RecordThresholds } from "./copy";

/** One TopicOutcome, as the whitelist projection hands it over: a topic's name, what rung, and when. Nothing else. */
export interface OutcomeRow {
  /** Groups rows of one topic. Never shown. */
  topic_key: string;
  topic_name: string;
  /** The rung at which she reached the memory (1 = unaided), or null if she did not reach it in that call. */
  reached_at_rung: number | null;
  at: string;
}

export interface RecordLine {
  script_id: string;
  text: string;
}

export interface TopicRecordEntry {
  topic_name: string;
  calls_counted: number;
  last_call_on: string | null;
  lines: RecordLine[];
}

export interface TopicRecord {
  header: RecordLine;
  topics: TopicRecordEntry[];
  change_lines: RecordLine[];
  summary_line: RecordLine | null;
}

const unaided = (rows: readonly OutcomeRow[]): number => rows.filter((r) => r.reached_at_rung === 1).length;
const byTime = (a: OutcomeRow, b: OutcomeRow): number => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
const line = (l: { id: string; text: string }, values: Record<string, string>): RecordLine => ({ script_id: l.id, text: fill(l, values) });

function grouped(rows: readonly OutcomeRow[]): Array<{ name: string; rows: OutcomeRow[] }> {
  const groups = new Map<string, { name: string; rows: OutcomeRow[] }>();
  for (const row of rows) {
    const g = groups.get(row.topic_key) ?? { name: row.topic_name, rows: [] };
    g.rows.push(row);
    groups.set(row.topic_key, g);
  }
  // Alphabetical by name: an order that says nothing about how any topic is going (no ordering by concern).
  return [...groups.values()].map((g) => ({ name: g.name, rows: [...g.rows].sort(byTime) })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function buildTopicRecord(rows: readonly OutcomeRow[], herName: string, copy: FamilyCopy, t: RecordThresholds): TopicRecord {
  const topics: TopicRecordEntry[] = [];
  const changeLines: RecordLine[] = [];
  let topicsWithLessUnaided = 0;

  for (const { name, rows: all } of grouped(rows)) {
    const window = all.slice(-t.record_window_calls);
    const lastCallOn = all.at(-1)?.at.slice(0, 10) ?? null;
    if (all.length < t.min_calls_to_show) {
      topics.push({ topic_name: name, calls_counted: all.length, last_call_on: lastCallOn, lines: [line(copy.lines.record_not_enough, { topic: name })] });
      continue;
    }
    const calls = String(window.length);
    const afterCue = window.filter((r) => r.reached_at_rung === 2 || r.reached_at_rung === 3).length;
    const recognition = window.filter((r) => r.reached_at_rung === 4).length;
    const lines = [line(copy.lines.record_unaided, { topic: name, unaided: String(unaided(window)), calls })];
    if (afterCue > 0) lines.push(line(copy.lines.record_after_cue, { topic: name, after_cue: String(afterCue), calls }));
    if (recognition > 0) lines.push(line(copy.lines.record_recognition, { topic: name, recognition: String(recognition), calls }));
    topics.push({ topic_name: name, calls_counted: window.length, last_call_on: lastCallOn, lines });

    // Change line: her most recent calls on this topic against the ones just before them. Her own calls only.
    if (all.length < t.min_calls_to_compare) continue;
    const recent = unaided(all.slice(-t.change_window_calls));
    const earlier = unaided(all.slice(-2 * t.change_window_calls, -t.change_window_calls));
    if (Math.abs(recent - earlier) < t.min_difference) continue;
    changeLines.push(line(copy.lines.change_topic, { topic: name, recent: String(recent), earlier: String(earlier), window: String(t.change_window_calls) }));
    if (recent < earlier) topicsWithLessUnaided++;
  }

  return {
    header: line(copy.lines.record_header, { name: herName }),
    topics,
    change_lines: changeLines,
    summary_line: topicsWithLessUnaided >= t.min_topics_for_summary ? line(copy.lines.change_summary, {}) : null,
  };
}

/** The file an approved member can ask for (section 6.4.5): the same record, as plain text, with the fixed non-clinical note. */
export function renderExport(record: TopicRecord, copy: FamilyCopy, generatedAt: string): string {
  const out: string[] = [record.header.text, copy.lines.export_note.text, `Generated ${generatedAt.slice(0, 10)}.`, ""];
  for (const topic of record.topics) {
    for (const l of topic.lines) out.push(l.text);
    if (topic.last_call_on) out.push(`  Most recent call: ${topic.last_call_on}.`);
  }
  if (record.change_lines.length > 0) out.push("", ...record.change_lines.map((l) => l.text));
  if (record.summary_line) out.push("", record.summary_line.text);
  return out.join("\n");
}
