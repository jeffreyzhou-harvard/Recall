"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Phone, PhoneOff, Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { usePreview } from "./PreviewProvider";
import { PreviewNav } from "./PreviewNav";
import { RecallFrame, RecallHeader } from "./RecallFrame";
import { SetupPhoto } from "./SetupPhoto";
import { photoForSession } from "@/lib/recall-preview/source-view";
import type { SampleSetupPhoto } from "@/lib/recall-preview/imports";

const standalonePhoto: SampleSetupPhoto = {
  id: "standalone-cape-may", name: "Family beach photo", topicId: "cape-may",
  src: "/preview/family-beach.png", alt: "Illustrative family photograph: a mother and daughter sitting together on a beach.",
  metadata: { capturedAt: "", device: "", dimensions: { width: 1448, height: 1086 }, album: "Fictional sample", placeLabel: "", caption: "", contributor: "Sample illustration" },
};

function captionPages(text: string): string[][] {
  const pages: string[][] = [];
  let current: string[] = [];
  for (const phrase of text.match(/[^.!?,]+[.!?,]*/g) ?? [text]) {
    const words = phrase.trim().split(/\s+/);
    if (current.length && current.length + words.length > 12) { pages.push(current); current = []; }
    // Only unusually long clauses need a mid-clause break; balance those parts.
    const size = Math.ceil(words.length / Math.ceil(words.length / 12));
    while (words.length > 12) pages.push(words.splice(0, size));
    current.push(...words);
  }
  if (current.length) pages.push(current);
  return pages;
}

function Caption({ text, speaker, paused, onComplete }: { text: string; speaker: string; paused: boolean; onComplete: () => void }) {
  const pages = captionPages(text);
  const [page, setPage] = useState(0);
  // A short portion of the literal line leaves room for the familiar photograph.
  const words = pages[page]!;
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => {
      if (page + 1 < pages.length) setPage((value) => value + 1);
      else onComplete();
    }, Math.max(5500, words.length * 430));
    return () => window.clearTimeout(timer);
  }, [onComplete, paused, words.length, page, pages.length]);
  return <>
    <p className="recall-caption" aria-hidden="true">{words.join(" ")}</p>
    <p className="sr-only" role="status" aria-atomic="true">{speaker}: {words.join(" ")}</p>
  </>;
}

export function RecallPhone() {
  const { data, state, dispatch, setup } = usePreview();
  const topic = data.topics.find((item) => item.id === state.topicId)!;
  const line = topic.lines[state.lineIndex]!;
  const contribution = topic.lines.find((item) => item.id === topic.contributionLineId)!;
  const questionRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (state.phase === "remember" || state.phase === "share") questionRef.current?.focus({ preventScroll: true });
  }, [state.phase]);
  const active = ["conversation", "remember", "share"].includes(state.phase);
  const done = state.phase === "finished" || state.phase === "stopped";
  const selectedPhoto = photoForSession(setup, topic.id, standalonePhoto);
  const showPhoto = Boolean(selectedPhoto?.src) && (state.phase === "incoming" || state.phase === "conversation");
  const photo = <figure className="recall-memory-photo">
    {selectedPhoto && <SetupPhoto photo={selectedPhoto} eager />}
    {state.phase === "conversation" && <figcaption>{topic.name}</figcaption>}
  </figure>;

  return <RecallFrame>
    <div className="recall-preview-label">Scripted preview <span>· {showPhoto ? "AI-generated sample photo" : "No audio or microphone"}</span></div>
    <main className={`recall-phone${showPhoto ? " recall-photo-call" : ""}`} data-active={active} data-phase={state.phase} aria-label="Susan’s call with Recall">
      <RecallHeader />
      {state.phase === "incoming" && <>
        {showPhoto && photo}
        <div className="recall-incoming">
          <h1>Hello, Susan.</h1>
          <p className="recall-incoming-title">Recall is calling.</p>
          <p className="recall-intro">Your AI assistant is here<br />for a conversation.</p>
        </div>
        <footer className="recall-actions">
          <button className="recall-button recall-primary" onClick={() => dispatch({ type: "answer" })}><Phone aria-hidden="true" />Answer call</button>
          <button className="recall-button recall-secondary" onClick={() => dispatch({ type: "stop" })}>Not now</button>
        </footer>
      </>}
      {active && <>
        {showPhoto ? <h1 className="sr-only">{topic.name}</h1> : <div className="recall-topic"><h1>{topic.name}</h1></div>}
        {showPhoto && photo}
        <section className="recall-conversation" aria-label="Current words">
          {state.phase === "conversation" && <>
            <div className="recall-speaker">{line.speaker === data.person ? "Susan’s words" : "Recall says"}</div>
            <Caption key={line.id} text={line.text} speaker={line.speaker} paused={state.paused} onComplete={() => dispatch({ type: "advance" })} />
          </>}
          {(state.phase === "remember" || state.phase === "share") && <>
            <div className="recall-speaker">Your words</div>
            <blockquote className="recall-quoted">“{contribution.text}”</blockquote>
            <h2 ref={questionRef} className="recall-confirm-question" tabIndex={-1}>{state.phase === "remember" ? "Want me to remember that?" : "Would you like me to share that with Maya?"}</h2>
          </>}
        </section>
        <footer className="recall-actions">
          {state.phase === "remember" && <div className="recall-decisions">
            <button className="recall-button recall-secondary" onClick={() => dispatch({ type: "remember", answer: true })}>Yes</button>
            <button className="recall-button recall-secondary" onClick={() => dispatch({ type: "remember", answer: false })}>No</button>
          </div>}
          {state.phase === "share" && <div className="recall-decisions">
            <button className="recall-button recall-secondary" onClick={() => dispatch({ type: "share", answer: true })}>Yes</button>
            <button className="recall-button recall-secondary" onClick={() => dispatch({ type: "share", answer: false })}>No</button>
          </div>}
          {state.phase === "conversation" && !showPhoto && <p className="recall-reassurance">There’s no hurry.</p>}
          <button className="recall-button recall-end" onClick={() => dispatch({ type: "stop" })}><PhoneOff aria-hidden="true" />End call</button>
        </footer>
      </>}
      {done && <>
        <div className="recall-finished" role="status">
          <PhoneOff size={40} strokeWidth={1.5} aria-hidden="true" />
          <h1>{state.phase === "stopped" ? "We can talk another time." : "Thank you, Susan."}</h1>
          <p>The call has ended.</p>
          <div className="recall-end-note">{state.result === "shared" ? "You chose to remember your words and share them with Maya." : state.result === "private" ? "You chose to remember your words and keep them private." : "Nothing new was saved from this call."}</div>
        </div>
        <footer className="recall-actions"><p className="recall-reassurance">You can put your phone down.</p></footer>
      </>}
    </main>
    <aside className="recall-review-tools" aria-label="Prototype controls, separate from Susan’s screen">
      {state.phase === "conversation" && <div className="recall-playback-tools">
        <button onClick={() => dispatch({ type: "pause" })}>{state.paused ? <Play size={18} /> : <Pause size={18} />}{state.paused ? "Resume preview" : "Pause preview"}</button>
        <button onClick={() => dispatch({ type: "advance" })}><SkipForward size={18} />Next line</button>
      </div>}
      {done && <div className="recall-review-next">
        <p>Preview complete. The sample stays in this tab until you refresh.</p>
        <Link href="/caregiver">See the caregiver view<ArrowRight size={18} aria-hidden="true" /></Link>
        <button onClick={() => dispatch({ type: "prepare", topicId: state.topicId })}><RotateCcw size={17} aria-hidden="true" />Replay conversation</button>
      </div>}
      <PreviewNav />
      <details className="recall-inspector">
        <summary>Behind this preview</summary>
        <p>These are fictional sample lines, not a live transcript. Voices, recorded playback, and live transcription will be connected later. Remember and share buttons simulate the two spoken choices.</p>
        <p>Sample photos are AI-generated illustrations, not family evidence. Once setup is agreed, only the sample photo you selected for this topic appears. Real uploads are never attached to this fixed script automatically. No microphone or audio is used here.</p>
        <h2>Conversation script</h2>
        <ol>{topic.lines.map((item) => <li key={item.id}><strong>{item.speaker}</strong><p>{item.text}</p></li>)}</ol>
        <h2>Sample context graph</h2>
        {state.memories.length ? state.memories.map((memory) => <div className="recall-graph-entry" key={memory.id}>
          <p>Susan <span aria-hidden="true">→</span> said <span aria-hidden="true">→</span> “{memory.text}”</p>
          <p>About: {data.topics.find((item) => item.id === memory.topicId)?.name}</p>
          <small>Source: scripted preview / {memory.sourceLineId}. {memory.sharedWith ? `Shared in the preview with ${memory.sharedWith}.` : "Private in the preview."}</small>
        </div>) : <p>No new sample memory yet. It appears only after both choices have been resolved.</p>}
        <p>No live graph, recording, or message is created.</p>
      </details>
    </aside>
  </RecallFrame>;
}
