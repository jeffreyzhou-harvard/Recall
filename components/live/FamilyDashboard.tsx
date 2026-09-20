"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { api, ApiError } from "@/client/api";
import type { ToolOutput } from "@/lib/tools/contracts";
import type { RecallService } from "@/lib/service/recall-service";
import type { SafetyAlert } from "@/lib/safety/alert";
import { useLive } from "./LiveProvider";
import { SignOut } from "./AccessGate";
import { MemoryForm } from "./MemoryForm";
import { SessionWaveform } from "@/components/recall/SessionWaveform";
type Dashboard = { info: NonNullable<Awaited<ReturnType<RecallService["dashboardInfo"]>>>; weekly_note: ToolOutput<"build_weekly_note">; topic_record: ToolOutput<"get_topic_record">; safety_alerts: SafetyAlert[] };
export function FamilyDashboard() {
  const { session, member, setMember } = useLive();
  const [draftMember, setDraftMember] = useState(member), [data, setData] = useState<Dashboard | null>(null), [error, setError] = useState("");
  const [loading, setLoading] = useState(false), [showRecord, setShowRecord] = useState(true), [version, setVersion] = useState(0);
  const [exporting, setExporting] = useState(false), [exportError, setExportError] = useState("");
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    if (!member) { setData(null); return; }
    const controller = new AbortController();
    setData(null); setError(""); setLoading(true);
    api<Dashboard>(`/api/family/dashboard?member=${encodeURIComponent(member)}`, { signal: controller.signal }).then(setData).catch((e) => { if (!controller.signal.aborted) setError(e instanceof ApiError ? e.message : "Recall could not load this view. Check your connection and reload."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [member, version]);
  useEffect(() => { const onFocus = () => refresh(); window.addEventListener("focus", onFocus); return () => window.removeEventListener("focus", onFocus); }, [refresh]);
  async function download() {
    setExporting(true); setExportError("");
    try {
      const response = await fetch("/api/family/export", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ member }) });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error || "The record could not be exported."); }
      const url = URL.createObjectURL(await response.blob()); const a = document.createElement("a"); a.href = url; a.download = "recall-record.txt"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setExportError(e instanceof Error ? e.message : "The record could not be exported."); }
    finally { setExporting(false); }
  }
  return <>
    {session?.principal?.role === "operator" && <form className="care-suggestion-form" onSubmit={(e) => { e.preventDefault(); setMember(draftMember.trim()); }}><label>Approved member ID<input value={draftMember} onChange={(e) => setDraftMember(e.target.value)} required /></label><button className="care-action">Open member view</button><Link href="/onboarding">Open joint setup</Link></form>}
    <div className="care-form-actions"><button className="care-text-action" disabled={loading || !member} onClick={refresh}>Reload</button><SignOut /></div>
    {loading && <p role="status">Loading your family view…</p>}
    {error && <div role="alert" className="setup-error"><p>{error}</p>{session?.principal?.role === "operator" && <Link href="/onboarding">Open joint setup</Link>}</div>}
    {data && <>
      <header className="care-page-heading"><div><h1>{data.info.person_name}, this week.</h1><p>A little context for your next conversation.</p></div><p className="care-dateline"><span>{data.info.member_name}’s family view</span></p></header>
      <nav className="care-nav" aria-label="Caregiver sections"><a href="#topic-record">Recall sessions</a><a href="#suggestions">Share a memory</a>{session?.principal?.role === "operator" && <Link href="/onboarding">Setup</Link>}</nav>
      {data.safety_alerts.map((alert) => <section key={alert.alert_id} className="care-overview"><p>{alert.text}</p></section>)}
      {data.info.detail_level === null ? <p>Your access to the family view is not currently enabled.</p> : <section className="care-session-record" id="topic-record">
        <div className="care-section-heading"><h2>A thread of conversations</h2>{data.topic_record.status === "ok" && <label className="recall-record-toggle"><input type="checkbox" checked={showRecord} onChange={(e) => setShowRecord(e.target.checked)} />Show details</label>}</div>
        {data.topic_record.header && <p className="care-record-context">{data.topic_record.header.text}</p>}
        <details className="session-week-note"><summary>This week’s note</summary>{data.weekly_note.note ? data.weekly_note.note.lines.map((line, i) => <div key={i}>{line.kind === "share" ? <><blockquote>“{line.text}”</blockquote><p className="care-caption">{line.attribution?.speaker_name} · {line.attribution?.share_confirmed_at.slice(0, 10)}</p></> : <p>{line.text}</p>}</div>) : <p>No Weekly Note has been posted yet.</p>}</details>
        {showRecord && data.topic_record.status === "ok" && <>
          <SessionWaveform sessions={data.info.sessions} recordWindow={data.info.record_window_calls} minimumCalls={data.info.min_calls_to_show} contribution={<MemoryForm member={member} name={data.info.member_name} person={data.info.person_name} onSaved={refresh} />} />
          <details className="session-topic-records"><summary>Browse topic details</summary><div className="care-topics">{data.topic_record.topics.map((topic) => <details className="care-topic" key={topic.topic_name}><summary><strong>{topic.topic_name}</strong><span>{topic.calls_counted} recent calls</span></summary><div className="care-topic-detail">{topic.lines.map((line) => <p key={line.script_id}>{line.text}</p>)}{topic.last_call_on && <p>Most recent call: {topic.last_call_on}</p>}</div></details>)}{data.topic_record.topics.length === 0 && <p>No topic records yet.</p>}</div>{data.topic_record.change_lines.map((line, i) => <p key={i}>{line.text}</p>)}{data.topic_record.summary_line && <p>{data.topic_record.summary_line.text}</p>}</details>
          <button className="care-text-action" onClick={() => void download()} disabled={exporting}>{exporting ? "Preparing file…" : "Export record for a doctor"}</button>{exportError && <p role="alert">{exportError}</p>}
        </>}
      </section>}
      {(!showRecord || data.topic_record.status !== "ok") && <MemoryForm member={member} name={data.info.member_name} person={data.info.person_name} onSaved={refresh} />}
      {data.info.contributions.length > 0 && <section className="care-saved-suggestions"><h2>Your contributions</h2><ul>{data.info.contributions.map((item, i) => <li key={i}><p>{item.text}</p><p className="care-caption">{data.info.member_name}’s account · {item.at.slice(0, 10)}</p></li>)}</ul></section>}
      <p className="care-privacy"><LockKeyhole size={18} aria-hidden="true" /><span>Private memories and unshared words stay out of this view.</span></p>
    </>}
  </>;
}
