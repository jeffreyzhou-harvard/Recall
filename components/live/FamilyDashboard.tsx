"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, AudioLines, ChevronDown, Images, LockKeyhole, MapPin, Network, Plus, Settings } from "lucide-react";
import { api, ApiError } from "@/client/api";
import type { ToolOutput } from "@/lib/tools/contracts";
import type { RecallService } from "@/lib/service/recall-service";
import type { SafetyAlert } from "@/lib/safety/alert";
import { useLive } from "./LiveProvider";
import { SignOut } from "./AccessGate";
import { MemoryForm } from "./MemoryForm";
import { FamilyArchive, type ArchiveSection } from "@/components/archive/FamilyArchive";
import { RecallWordmark } from "@/components/recall/RecallFrame";
import { SessionBookshelf } from "@/components/recall/SessionBookshelf";

type Dashboard = {
  can_pause: boolean;
  calls_paused: boolean;
  info: NonNullable<Awaited<ReturnType<RecallService["dashboardInfo"]>>>;
  weekly_note: ToolOutput<"build_weekly_note">;
  topic_record: ToolOutput<"get_topic_record">;
  missed_call_notice: Awaited<ReturnType<RecallService["unansweredStreakNotice"]>>;
  safety_alerts: SafetyAlert[];
};
type Section = ArchiveSection | "sessions";
type FamilyMember = { person_id: string; display_name: string; role: string; removed_at?: string | null };

export function FamilyDashboard() {
  const { session, member, setMember } = useLive();
  const [people, setPeople] = useState<FamilyMember[]>([]);
  const [loaded, setLoaded] = useState<{ member: string; data: Dashboard } | null>(null);
  const [error, setError] = useState("");
  const data = loaded?.member === member ? loaded.data : null;
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);
  const [section, setSection] = useState<Section>("moments");
  const [openRequest, setOpenRequest] = useState(0);
  const [uploadRequest, setUploadRequest] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const operator = session?.principal?.role === "operator";
  const canManage = session?.can_manage_setup ?? operator;
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const readLocation = () => {
      const hash = window.location.hash;
      if (hash === "#sessions" || hash === "#topic-record") setSection("sessions");
      else if (["#places", "#connections", "#stories", "#moments"].includes(hash)) setSection(hash.slice(1) as ArchiveSection);
      else if (!hash || hash === "#memories" || hash === "#suggestions") setSection("moments");
      if (hash === "#suggestions") setOpenRequest((request) => request + 1);
    };
    readLocation();
    window.addEventListener("hashchange", readLocation);
    window.addEventListener("popstate", readLocation);
    return () => {
      window.removeEventListener("hashchange", readLocation);
      window.removeEventListener("popstate", readLocation);
    };
  }, []);

  function navigate(next: Section) {
    setSection(next);
    if (window.location.hash !== `#${next}`) window.history.pushState(null, "", `#${next}`);
    requestAnimationFrame(() => { heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: "start", behavior: "instant" }); });
  }

  function addMemory() {
    setSection("moments");
    setOpenRequest((request) => request + 1);
    if (window.location.hash !== "#suggestions") window.history.pushState(null, "", "#suggestions");
  }

  useEffect(() => {
    if (!operator || !session.household_id) return;
    const controller = new AbortController();
    api<{ people: FamilyMember[] }>(`/api/onboarding/households/${encodeURIComponent(session.household_id)}`, { signal: controller.signal })
      .then((household) => {
        const family = household.people.filter((person) => person.role !== "participant" && !person.removed_at);
        setPeople(family);
        if (!member || !family.some((person) => person.person_id === member)) setMember(family[0]?.person_id ?? "");
      })
      .catch(() => { if (!controller.signal.aborted) setError("Your family could not be loaded. Please reload or return to setup."); });
    return () => controller.abort();
  }, [operator, session, member, setMember]);

  useEffect(() => {
    if (!member) { setLoaded(null); return; }
    const controller = new AbortController();
    setError("");
    setLoading(true);
    api<Dashboard>(`/api/family/dashboard?member=${encodeURIComponent(member)}`, { signal: controller.signal })
      .then((next) => { if (!controller.signal.aborted) setLoaded({ member, data: next }); })
      .catch((e) => {
        if (controller.signal.aborted) return;
        if (e instanceof ApiError && [401, 403].includes(e.status)) setLoaded(null);
        setError(e instanceof ApiError ? e.message : "Recall could not load this view. Check your connection and reload.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [member, version]);

  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  async function download() {
    setExporting(true);
    setExportError("");
    try {
      const response = await fetch("/api/family/export", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ member }) });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error || "The record could not be exported."); }
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "recall-record.txt";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "The record could not be exported.");
    } finally { setExporting(false); }
  }

  return <div className="care-portal-layout">
    <a className="care-skip-link" href="#caregiver-content">Skip to content</a>
    <aside className="care-portal-rail">
      <Link href="/caregiver" className="care-rail-brand" aria-label="Recall home"><RecallWordmark /></Link>
      <div className="care-family-identity">
        <span className="care-family-initial" aria-hidden="true">{data?.info.person_name.trim().slice(0, 1) || <Images size={24} />}</span>
        <div><strong>{data ? `${data.info.person_name}’s family` : "Your family"}</strong><span>Family collection</span></div>
      </div>
      <label className="care-mobile-navigation"><span className="archive-viz-sr">Caregiver section</span><select value={section} onChange={(event) => { if (event.target.value === "settings") window.location.assign("/onboarding/manage"); else navigate(event.target.value as Section); }}>{([ ["moments", "Moments"], ["places", "Places"], ["connections", "Connections"], ["stories", "Stories"], ["sessions", "Recall sessions"] ] as const).map(([value, label]) => <option value={value} key={value}>{label}</option>)}{canManage && <option value="settings">Family settings</option>}</select></label>
      <nav className="care-portal-nav" aria-label="Caregiver sections">
        {([{ id: "moments", label: "Moments", icon: Images }, { id: "places", label: "Places", icon: MapPin }, { id: "connections", label: "Connections", icon: Network }, { id: "stories", label: "Stories", icon: AudioLines }] as const).map((item) => <a key={item.id} href={`#${item.id}`} aria-current={section === item.id ? "page" : undefined} onClick={(event) => { event.preventDefault(); navigate(item.id); }}><item.icon size={22} aria-hidden="true" />{item.label}</a>)}
        <a href="#sessions" aria-current={section === "sessions" ? "page" : undefined} onClick={(event) => { event.preventDefault(); navigate("sessions"); }}><AudioLines size={22} aria-hidden="true" />Recall sessions</a>
        {canManage && <Link href="/onboarding/manage"><Settings size={22} aria-hidden="true" />Family settings</Link>}
      </nav>
      <div className="care-rail-account">
        {operator && people.length > 1 ? <label className="care-member-choice">Family view<select value={member} onChange={(e) => setMember(e.target.value)}>{people.map((person) => <option key={person.person_id} value={person.person_id}>{person.display_name}</option>)}</select></label> : data && <p>{data.info.member_name}’s account</p>}
        <details><summary>Account options</summary><div><button className="care-text-action" disabled={loading || !member} onClick={refresh}>{loading ? "Reloading…" : "Reload"}</button><Link className="care-text-action" href="/">Home</Link><SignOut /></div></details>
      </div>
    </aside>

    <div className="care-portal-workspace">
    <header className="care-workspace-bar"><p>{data ? `${data.info.person_name}’s family` : "Your family"}<span aria-hidden="true">/</span>{{ moments: "Moments", places: "Places", connections: "Connections", stories: "Stories", sessions: "Recall sessions" }[section]}</p><span className="care-workspace-note">Made for your family</span></header>
    <main className="care-portal-main" id="caregiver-content" tabIndex={-1}>
      {!member && !loading && <section className="care-empty"><h1>Your family’s conversations</h1><p>Finish setting up together to open your family view.</p><Link className="care-action care-action-primary" href="/onboarding">Continue setup</Link></section>}
      {loading && !data && <p role="status">Loading your family view…</p>}
      {error && <div role="alert" className="setup-error"><p>{error}</p><button className="care-text-action" disabled={loading} onClick={refresh}>Reload</button>{operator && <Link href="/onboarding">Open joint setup</Link>}</div>}
      {data && <>
        {data.safety_alerts.map((alert) => <section key={alert.alert_id} className="care-portal-notice"><p>{alert.text}</p></section>)}
        {data.missed_call_notice && <p className="care-portal-notice">{data.missed_call_notice.text}</p>}
        <header className="care-portal-heading">
          <div><h1 ref={heading} tabIndex={-1}>{{ moments: "A life, in moments.", places: "The places that stay.", connections: "Everything is connected.", stories: "In your own words.", sessions: "Recall sessions." }[section]}</h1><p>{{ moments: "Your photos together. Room for the stories.", places: "Follow the places behind your photographs.", connections: "People, places, and the moments that bring them together.", stories: "Your original words, with your name beside them.", sessions: `A quiet record of ${data.info.person_name}’s conversations.` }[section]}</p></div>
          {section !== "sessions" && <button className="care-action care-action-primary" onClick={() => setUploadRequest((request) => request + 1)}><Plus size={20} aria-hidden="true" />Add photos</button>}
        </header>

        {/* Keep the form mounted across section changes so a contribution draft is not lost. */}
        <div hidden={section === "sessions"} className="care-archive-view" key={member}>
          <FamilyArchive member={member} name={data.info.member_name} view={section === "sessions" ? "moments" : section} version={version} uploadRequest={uploadRequest} onChanged={refresh} canManage={canManage} contribution={<MemoryForm member={member} name={data.info.member_name} person={data.info.person_name} onSaved={refresh} openRequest={openRequest} active={section === "moments"} />} />
        </div>

        {section === "sessions" && <section className="care-session-record" id="topic-record" aria-label="Recall sessions">
          {data.info.detail_level === null ? <p>Your access to the call record is not currently enabled.</p> : <>
            {data.topic_record.header && <p className="care-record-context">{data.topic_record.header.text}</p>}
            {data.weekly_note.note && <details className="session-week-note"><summary>This week’s note</summary>{data.weekly_note.note.lines.some((line) => line.kind !== "share") ? data.weekly_note.note.lines.filter((line) => line.kind !== "share").map((line, i) => <p key={i}>{line.text}</p>) : <p>A note will appear after your first conversations.</p>}<p className="care-caption">Call {data.info.person_name} directly to hear their stories.</p></details>}
            {data.topic_record.status === "ok" ? <>
              <SessionBookshelf sessions={data.info.sessions} recordWindow={data.info.record_window_calls} minimumCalls={data.info.min_calls_to_show} contribution={<aside className="care-session-invitation"><h2>Keep the conversation going.</h2><p>A familiar photo or a memory of your own can give Recall a little context.</p><button className="care-text-action" onClick={addMemory}>Share a memory<ArrowUpRight size={20} aria-hidden="true" /></button><p className="care-caption">For a question or a story, call {data.info.person_name} directly.</p></aside>} />
              {data.topic_record.topics.length > 0 && <details className="session-topic-records"><summary>Topic details</summary><div className="care-topics">{data.topic_record.topics.map((topic) => <details className="care-topic" key={topic.topic_name}><summary><strong>{topic.topic_name}</strong><span>{topic.calls_counted} recent calls</span><ChevronDown size={22} aria-hidden="true" /></summary><div className="care-topic-detail">{topic.lines.map((line) => <p key={line.script_id}>{line.text}</p>)}{topic.last_call_on && <p>Most recent call: {topic.last_call_on}</p>}</div></details>)}</div>{data.topic_record.change_lines.map((line, i) => <p key={i}>{line.text}</p>)}{data.topic_record.summary_line && <p>{data.topic_record.summary_line.text}</p>}</details>}
              {data.info.sessions.length > 0 && <button className="care-text-action" onClick={() => void download()} disabled={exporting}>{exporting ? "Preparing file…" : "Export record for a doctor"}</button>}
              {exportError && <p role="alert">{exportError}</p>}
            </> : <p className="care-record-context">Your family view includes the weekly note. Per-topic call details are only shown when agreed in setup.</p>}
          </>}
          {data.can_pause && <div className="care-call-preference"><button className="care-text-action" disabled={data.calls_paused || loading} onClick={() => { void api("/api/family/pause", { method: "POST" }).then(refresh).catch(() => setError("Calls could not be paused. Please reload.")); }}>{data.calls_paused ? "Calls are paused" : "Pause Recall calls"}</button></div>}
        </section>}
        <p className="care-privacy"><LockKeyhole size={18} aria-hidden="true" /><span>Private memories and unshared words stay out of this view.</span></p>
      </>}
    </main>
    </div>
  </div>;
}
