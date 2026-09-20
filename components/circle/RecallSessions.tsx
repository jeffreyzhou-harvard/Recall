"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { api, ApiError } from "@/client/api";
import type { ToolOutput } from "@/lib/tools/contracts";
import type { RecallService } from "@/lib/service/recall-service";
import type { SafetyAlert } from "@/lib/safety/alert";
import familyCopy from "@/fixtures/family-copy.json";
import { SessionHistory } from "./SessionHistory";
import { RecordPrintout } from "./RecordPrintout";
import "./sessions.css";

export type SessionDashboard = {
  can_pause: boolean;
  calls_paused: boolean;
  info: NonNullable<Awaited<ReturnType<RecallService["dashboardInfo"]>>>;
  weekly_note: ToolOutput<"build_weekly_note">;
  topic_record: ToolOutput<"get_topic_record">;
  missed_call_notice: Awaited<ReturnType<RecallService["unansweredStreakNotice"]>>;
  safety_alerts: SafetyAlert[];
};

export function RecallSessions({ member, demo }: { member: string; demo: boolean }) {
  const [loaded, setLoaded] = useState<{ member: string; data: SessionDashboard } | null>(null);
  const [error, setError] = useState("");
  const [setupRequired, setSetupRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [pausing, setPausing] = useState(false);
  const [printJob, setPrintJob] = useState<{ name: string; text: string } | null>(null);
  const data = loaded?.member === member ? loaded.data : null;
  const refresh = useCallback(() => setVersion(v => v + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setSetupRequired(false);
    api<SessionDashboard>(`/api/family/dashboard?member=${encodeURIComponent(member)}`, { signal: controller.signal })
      .then(next => { if (!controller.signal.aborted) setLoaded({ member, data: next }); })
      .catch(e => {
        if (controller.signal.aborted) return;
        setLoaded(null);
        setSetupRequired(e instanceof ApiError && e.status === 409);
        setError(e instanceof Error ? e.message : "The call record could not be loaded.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [member, version]);

  useEffect(() => {
    // Refresh on return from the patient tab; polling is pull-only and visible-tab only.
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(onVisible, demo ? 5000 : 30000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [demo, refresh]);

  async function exportRecord() {
    setExporting(true);
    setExportError("");
    try {
      const response = await fetch("/api/family/export", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ member }) });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || "The record could not be exported.");
      }
      setPrintJob({ name: data!.info.person_name, text: await response.text() });
    } catch (e) { setExportError(e instanceof Error ? e.message : "The record could not be exported."); }
    finally { setExporting(false); }
  }

  useEffect(() => {
    if (!printJob) return;
    const previousTitle = document.title;
    document.title = `Recall record - ${printJob.name} - ${new Date().toISOString().slice(0, 10)}`;
    const done = () => setPrintJob(null);
    window.addEventListener("afterprint", done);
    // Works in a background tab, unlike an animation frame.
    const timer = setTimeout(() => window.print(), 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("afterprint", done);
      document.title = previousTitle;
    };
  }, [printJob]);

  async function pauseCalls() {
    setPausing(true);
    try { await api("/api/family/pause", { method: "POST" }); refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Calls could not be paused."); }
    finally { setPausing(false); }
  }

  return <section className="circle-record" id="topic-record" aria-label="Recall sessions">
    <div className="circle-record-tools">
      <button className="circle-text-button" disabled={loading} onClick={refresh}><RefreshCw size={15} aria-hidden="true" />{loading && !data ? "Loading record…" : "Refresh record"}</button>
    </div>
    {error && <div role="alert" className="circle-record-message"><p>{error}</p>{setupRequired && <a className="circle-text-button" href="/onboarding">Open joint setup</a>}</div>}
    {loading && !data && <p role="status">Opening your call record…</p>}
    {data && <>
      <SessionRecord data={data} onExport={() => void exportRecord()} exporting={exporting} />
      {exportError && <p role="alert">{exportError}</p>}
      {data.info.detail_level !== null && <>
        {data.missed_call_notice && <p className="circle-record-message">{data.missed_call_notice.text}</p>}
        {data.safety_alerts.map(alert => <p key={alert.alert_id} className="circle-record-message">{alert.text}</p>)}
      </>}
      {data.can_pause && <div className="circle-record-preferences"><button className="circle-text-button" disabled={data.calls_paused || pausing} onClick={() => void pauseCalls()}>{data.calls_paused ? "Calls are paused" : pausing ? "Pausing calls…" : "Pause Recall calls"}</button></div>}
    </>}
    {printJob && <RecordPrintout name={printJob.name} text={printJob.text} />}
  </section>;
}

/** The access level gates the whole record, including history, counts and export. */
export function SessionRecord({ data, onExport, exporting }: { data: SessionDashboard; onExport: () => void; exporting: boolean }) {
  if (data.info.detail_level === null) return <p className="circle-record-message">Your access to the call record is not currently enabled.</p>;
  const record = data.info.detail_level === "weekly_note_and_record" && data.topic_record.status === "ok" ? data.topic_record : null;
  const note = data.weekly_note.note?.lines.filter(line => line.kind !== "share") ?? [];
  return <>
    {record && <p className="circle-record-context">{record.header?.text ?? familyCopy.lines.record_header.text.replace("{name}", data.info.person_name)}</p>}
    <section className="circle-record-week" aria-labelledby="circle-week-title">
      <h2 id="circle-week-title">This week’s note</h2>
      <div>{note.length ? note.map((line, i) => <p key={i}>{line.text}</p>) : <p>{familyCopy.lines.note_empty.text}</p>}</div>
    </section>
    {record ? <>
      <section className="circle-record-history" aria-labelledby="circle-history-title">
        <h2 id="circle-history-title">Call history</h2>
        <SessionHistory sessions={data.info.sessions} recordWindow={data.info.record_window_calls} minimumCalls={data.info.min_calls_to_show} />
      </section>
      {record.topics.length > 0 && <section className="circle-record-topics" aria-labelledby="circle-topics-title">
        <h2 id="circle-topics-title">By topic</h2>
        <p className="circle-record-window">Up to the last {data.info.record_window_calls} calls for each topic</p>
        {record.topics.map(topic => <article className="circle-record-topic" key={topic.topic_name}>
          <div><h3>{topic.topic_name}</h3>{topic.last_call_on && <p>Last call <time dateTime={topic.last_call_on}>{topic.last_call_on}</time></p>}</div>
          <div>{topic.lines.map(line => <p key={line.script_id}>{line.text}</p>)}</div>
        </article>)}
        {record.change_lines.length > 0 && <section className="circle-record-comparisons" aria-labelledby="circle-comparisons-title">
          <h3 id="circle-comparisons-title">Earlier and recent calls</h3>
          {record.change_lines.map((line, i) => <p key={i}>{line.text}</p>)}
          {record.summary_line && <p>{record.summary_line.text}</p>}
        </section>}
      </section>}
      <div className="circle-record-export">
        <div><h2>A copy for a doctor</h2><p>{familyCopy.lines.export_note.text}</p></div>
        <button className="circle-button" onClick={onExport} disabled={exporting || !data.info.sessions.length}><Download size={17} aria-hidden="true" />{exporting ? "Preparing record…" : "Print or save a PDF"}</button>
      </div>
    </> : <p className="circle-record-message">Your family view includes the weekly note. Per-topic call details are only shown when agreed in setup.</p>}
  </>;
}
