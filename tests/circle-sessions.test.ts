import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionRecord, type SessionDashboard } from "@/components/circle/RecallSessions";
import { buildTopicRecord, type OutcomeRow } from "@/lib/family/record";
import { familyCopySchema, recordThresholdsSchema, type RecordThresholds } from "@/lib/family/copy";
import copyJson from "@/fixtures/family-copy.json";
import thresholdsJson from "@/fixtures/record-thresholds.json";

const copy = familyCopySchema.parse(copyJson);
const thresholds = recordThresholdsSchema.parse(thresholdsJson);
const rows: OutcomeRow[] = ["Cape May", "Lincoln Elementary", "Princeton"].flatMap(topic => Array.from({ length: 8 }, (_, i) => ({ topic_key: topic, topic_name: topic, reached_at_rung: i < 4 ? 1 : 3, at: `2026-09-${String(i + 1).padStart(2, "0")}T10:00:00Z` })));
function dashboard(detail: SessionDashboard["info"]["detail_level"] = "weekly_note_and_record", t: RecordThresholds = thresholds): SessionDashboard {
  return {
    can_pause: true, calls_paused: false, safety_alerts: [], missed_call_notice: null,
    info: { person_name: "Susan", member_name: "Maya", detail_level: detail, record_window_calls: t.record_window_calls, min_calls_to_show: t.min_calls_to_show, contributions: [], sessions: [{ id: "call-1", date: "2026-09-08", topicId: "Cape May", topicName: "Cape May", outcome: "cue", recentCalls: t.record_window_calls, unaidedCalls: 4 }] },
    weekly_note: { status: "posted", note: { posted_at: "2026-09-08T10:00:00Z", lines: [
      { kind: "warm", script_id: "FAM-NOTE-WARM", text: "Recall talked with Susan about Cape May this week. Want to give her a call?", attribution: null },
      { kind: "share", script_id: "SHARED", text: "My literal shared words", attribution: { speaker_name: "Susan", share_confirmed_at: "2026-09-08T10:00:00Z", content_hash: "a".repeat(64) } },
    ] } },
    topic_record: { status: "ok", ...buildTopicRecord(rows, "Susan", copy, t) },
  };
}
const render = (data: SessionDashboard) => renderToStaticMarkup(createElement(SessionRecord, { data, exporting: false, onExport: () => {} }));
describe("Circle call record", () => {
  it("gates all history, counts and export behind the agreed detail level", () => {
    // Even an over-broad payload cannot expose record data through a note-only view.
    const none = render(dashboard(null));
    expect(none).toContain("not currently enabled");
    expect(none).not.toContain("Cape May");
    const weekly = render(dashboard("weekly_note"));
    expect(weekly).toContain("Want to give her a call?");
    for (const text of ["Call history", "By topic", "Print or save", "4 of 8", "My literal shared words"]) expect(weekly).not.toContain(text);
  });
  it("shows the fixed header, denominators and server change lines without private words", () => {
    const data = dashboard(), markup = render(data);
    expect(markup.indexOf("not a measure of Susan")).toBeLessThan(markup.indexOf("Call history"));
    expect(markup).toContain("4 of 8 recent calls");
    for (const line of data.topic_record.change_lines) expect(markup).toContain(line.text);
    expect(markup).toContain(copy.lines.change_summary.text);
    expect(markup).toContain(copy.lines.export_note.text);
    expect(markup).not.toContain("My literal shared words");
    expect(markup).not.toMatch(/care-portal|recall-workspace|\b(?:score|percentage|decline|progress|severity)\b/i);
    expect(markup).toContain('aria-controls="selected-circle-session"');
    expect(markup).toContain("Home / End");
  });
  it("keeps short histories uncounted and derives legend numbers from server thresholds", () => {
    const data = dashboard("weekly_note_and_record", { ...thresholds, record_window_calls: 10, min_calls_to_show: 5 });
    data.info.sessions[0] = { ...data.info.sessions[0]!, unaidedCalls: null, recentCalls: 2 };
    const markup = render(data);
    expect(markup).toContain("Cape May - not enough calls yet.");
    expect(markup).toContain("within the last 10 calls");
    expect(markup).toContain("Dashed outline: fewer than 5 calls");
    expect(markup).not.toContain("0 of 2");
    expect(markup).not.toContain("4 of 8 recent calls unaided");
  });
  it("has an empty state until a real topic call is recorded", () => {
    const data = dashboard(); data.info.sessions = [];
    data.topic_record = { status: "ok", ...buildTopicRecord([], "Susan", copy, thresholds) };
    const markup = render(data);
    expect(markup).toContain("No Recall calls yet.");
    expect(markup).toMatch(/disabled=""[^>]*><svg[^]*Print or save a PDF/);
    expect(markup).not.toContain('id="circle-topics-title"');
  });
});
