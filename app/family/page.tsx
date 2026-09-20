"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, ChevronDown, LockKeyhole } from "lucide-react";
import { usePreview } from "@/components/recall/PreviewProvider";
import { RecallFrame, RecallHeader } from "@/components/recall/RecallFrame";
import { MemorySuggestionForm } from "@/components/recall/MemorySuggestionForm";
import { SessionBookshelf } from "@/components/recall/SessionBookshelf";
import { SelectedSources } from "@/components/recall/SelectedSources";
import { SampleSessionLauncher } from "@/components/recall/SampleSessionLauncher";
import timeline from "@/fixtures/preview/session-timeline.json";
import { sessionSummaries } from "@/lib/recall-preview/sessions";
import { topicRecord } from "@/lib/recall-preview/model";
import thresholds from "@/fixtures/preview/record-thresholds.json";
import copy from "@/fixtures/preview/family-copy.json";

export default function FamilyPage() {
  const { data, state, setup } = usePreview();
  const [showRecord, setShowRecord] = useState(true);
  const records = data.topics.map((topic) => ({ topic, record: topicRecord([...topic.history, ...(state.outcomes[topic.id] ?? [])], thresholds) }));
  const sessions = useMemo(() => {
    const topics = data.topics.map((topic) => ({ ...topic, history: [...topic.history, ...(state.outcomes[topic.id] ?? [])] }));
    const completed = data.topics.flatMap((topic) => (state.outcomes[topic.id] ?? []).map((_, index) => ({ id: `preview-${topic.id}-${index}`, date: data.date, topicId: topic.id, historyIndex: topic.history.length + index })));
    return sessionSummaries(topics, [...timeline, ...completed], thresholds);
  }, [data, state.outcomes]);
  return <RecallFrame family>
    <div className="recall-family-shell care-dashboard">
      <RecallHeader family compact />
      <main className="care-main">
        <header className="care-page-heading">
          <div><h1>Susan’s conversations.</h1><p>A little context for your next conversation.</p></div>
          <p className="care-dateline"><time dateTime="2026-09-19">September 19, 2026</time><span>Maya’s family view</span></p>
        </header>
        <nav className="care-nav" aria-label="Caregiver sections"><a href="#topic-record" onClick={() => setShowRecord(true)}>Recall sessions</a><a href="#suggestions">Suggest a conversation</a><Link href="/onboarding">Setup</Link></nav>
        <section className="care-session-record" id="topic-record" aria-labelledby="record-title">
          <div className="care-section-heading"><h2 id="record-title">A thread of conversations</h2><label className="recall-record-toggle"><input type="checkbox" checked={showRecord} onChange={(event) => setShowRecord(event.target.checked)} />Show details</label></div>
          <p className="care-record-context">{copy["FAM-HEADER-01"]}</p>
          {showRecord ? <SessionBookshelf sessions={sessions}>
            <details className="session-week-note">
              <summary>This week’s note</summary>
              <p>{state.topicId === "lincoln" ? copy["FAM-NOTE-02"] : copy["FAM-NOTE-01"]}</p>
              <p className="care-caption">This note includes topics only. Give Susan a call to hear her stories.</p>
            </details>
          </SessionBookshelf> : <div className="care-overview"><p className="care-record-hidden">Session details are hidden. You can still suggest a conversation.</p><MemorySuggestionForm /></div>}
          {showRecord && <details className="session-topic-records"><summary>Browse topic details</summary>
          <div className="care-topics">{records.map(({ topic, record }) => <details className="care-topic" id={"record-" + topic.id} key={topic.id}>
            <summary><span><strong>{topic.name}</strong><span className="care-caption">September 2026 · {record.total} recent {record.total === 1 ? "call" : "calls"}</span></span><span className="care-topic-summary">{record.enough ? `${record.unaided} of ${record.total} calls unaided` : "Not enough calls yet"}</span><ChevronDown size={22} aria-hidden="true" /></summary>
            <div className="care-topic-detail">{record.enough ? <>
              <dl className="recall-counts"><div><dt>Unaided</dt><dd>{record.unaided} of {record.total}</dd></div><div><dt>After a cue</dt><dd>{record.cue} of {record.total}</dd></div><div><dt>Recognition prompt</dt><dd>{record.recognition} of {record.total}</dd></div></dl>
              {record.change && <p className="care-change-note">Recalled unaided in {record.change.latest} of the last {thresholds.comparisonWindow} calls, compared with {record.change.earlier} of the {thresholds.comparisonWindow} before.</p>}
            </> : <p>There are fewer than {thresholds.minimumCalls} calls about this topic. Counts will appear when there are enough.</p>}</div>
          </details>)}</div>
          </details>}
        </section>
        <section className="care-sources" aria-labelledby="setup-summary-title">
          <div><h2 id="setup-summary-title">{setup.agreed ? "Your selected sources" : "Start with what’s familiar"}</h2>
          <p>{setup.agreed ? (setup.photos.length + (setup.samplePhotos?.length ?? 0)) + " photos · " + setup.contacts.length + " approved " + (setup.contacts.length === 1 ? "person" : "people") + " · " + setup.events.length + " calendar " + (setup.events.length === 1 ? "event" : "events") : "Choose photos, approved people and occasions to talk about."}</p></div>
          <Link className="care-text-action" href="/onboarding">{setup.agreed ? "Edit setup" : "Set up Recall"}<ArrowRight size={18} aria-hidden="true" /></Link>
        </section>
        {setup.agreed && <><SelectedSources /><SampleSessionLauncher /></>}
        <p className="care-privacy"><LockKeyhole size={18} aria-hidden="true" /><span>A small, shared window into Recall calls. Susan’s private memories and unshared words stay out of this view.</span></p>
      </main>
      <p className="recall-family-disclaimer">Sample data. Live sessions, access controls and conversation requests are not connected yet.</p>
    </div>
  </RecallFrame>;
}
