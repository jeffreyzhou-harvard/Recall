"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import type { FamilyQueryResult } from "@/lib/knowledge/family-query";
import "./graph-questions.css";

const suggestions = ["How is our family connected?", "What could we talk about together?"];

export function GraphQuestions({ revision, onOpenMoment }: { revision: string; onOpenMoment: (id: string) => void }) {
  const uid = useId();
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [result, setResult] = useState<FamilyQueryResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const sources = useRef<HTMLDivElement>(null);

  // A poll that returns unchanged content does not reset the answer. Actual edits do.
  useEffect(() => {
    pending.current?.abort(); pending.current = null;
    setBusy(false); setResult(null); setAsked(""); setError("");
    return () => { pending.current?.abort(); pending.current = null; };
  }, [revision]);

  function cancel() {
    pending.current?.abort(); pending.current = null; setBusy(false);
    field.current?.focus();
  }
  async function ask(value: string) {
    const query = value.trim();
    if (query.length < 2 || query.length > 600 || pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    setQuestion(query); setAsked(query); setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/circle/graph-query", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: query }), signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The answer couldn’t be loaded. Please ask again.");
      if (pending.current === controller) setResult(body);
    } catch (error) {
      if (pending.current === controller && !controller.signal.aborted) setError(error instanceof Error ? error.message : "The answer couldn’t be loaded. Please ask again.");
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }

  function showSource(id: string) {
    const target = sources.current?.querySelector<HTMLDetailsElement>(`[data-source-id="${id}"]`);
    if (!target) return;
    target.open = true;
    target.querySelector("summary")?.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest", behavior: "instant" });
  }
  const sourceNumber = (id: string) => (result?.sources.findIndex(source => source.id === id) ?? -1) + 1;

  return <section className="circle-graph-questions" aria-labelledby={`${uid}-title`}>
    <form onSubmit={event => { event.preventDefault(); void ask(question); }}>
      <h2 id={`${uid}-title`} className="circle-graph-question-title"><label htmlFor={`${uid}-question`}>Ask about your family</label></h2>
      <div className="circle-graph-question-field">
        <textarea id={`${uid}-question`} ref={field} value={question} onChange={event => setQuestion(event.target.value)} maxLength={600} rows={1}
          placeholder="Ask about a person, place, or memory…" aria-describedby={`${uid}-hint`} readOnly={busy} />
        {busy ? <button type="button" className="circle-button" onClick={cancel}><X size={17} aria-hidden="true" />Cancel</button>
          : <button type="submit" className="circle-button primary" disabled={question.trim().length < 2}>Ask<ArrowRight size={17} aria-hidden="true" /></button>}
      </div>
      <div className="circle-graph-question-meta">
        <p id={`${uid}-hint`} className="circle-graph-question-hint">People, places, and stories, with sources.</p>
        {!result && !busy && !error && <details className="circle-graph-question-examples">
          <summary>Try a question</summary>
          <div className="circle-graph-question-suggestions" aria-label="Example questions">
            {suggestions.map(suggestion => <button key={suggestion} type="button" onClick={() => void ask(suggestion)}>{suggestion}</button>)}
          </div>
        </details>}
      </div>
    </form>
    <div role="status" className="circle-graph-question-status">{busy ? "Looking through your family’s connections…" : result ? `${result.sources.length} ${result.sources.length === 1 ? "source" : "sources"} found.` : ""}</div>
    {error && <p className="circle-graph-question-error" role="alert">{error}</p>}
    {result && <div className="circle-graph-question-result">
      <div className="circle-graph-answer">
        <div className="circle-graph-answer-heading"><h3>{asked}</h3><button type="button" className="circle-text-button" onClick={() => { setResult(null); setAsked(""); field.current?.focus(); }}>Clear answer</button></div>
        {result.mode === "search" && <p className="circle-graph-question-hint">People, places, and story search are available. Muse Spark isn’t connected for answers and conversation ideas yet.</p>}
        {result.answer.map((paragraph, index) => <p key={index}>{paragraph.text}{paragraph.citations.map(citation => <button key={citation.sourceId + citation.quote} type="button"
          className="circle-graph-citation" aria-label={`Read source ${sourceNumber(citation.sourceId)}`} onClick={() => showSource(citation.sourceId)}>[{sourceNumber(citation.sourceId)}]</button>)}</p>)}
        {!result.answer.length && <p>{result.sources.length ? "Here are shared sources to explore." : "No matching sources were found. Ask about another person, place, connection, or moment."}</p>}
        {result.limited && <p className="circle-graph-question-hint">This answer uses a selection of sources. A name, place, or date can help narrow your question.</p>}
        {result.ideas.length > 0 && <div className="circle-graph-ideas"><h4>Something to talk about together</h4><ul>{result.ideas.map((idea, index) => <li key={index}>{idea.question}<span>{idea.sourceIds.map(id => <button key={id} type="button" className="circle-graph-citation" aria-label={`Read source ${sourceNumber(id)}`} onClick={() => showSource(id)}>[{sourceNumber(id)}]</button>)}</span></li>)}</ul></div>}
      </div>
      {result.sources.length > 0 && <div ref={sources} className="circle-graph-sources"><h4>Sources</h4>{result.sources.map((source, index) => <details key={source.id} data-source-id={source.id}>
        <summary><span className="circle-graph-source-number">{index + 1}</span><span><strong>{source.title}</strong><small>{source.attribution}</small></span></summary>
        <div className="circle-graph-source-detail"><p>{source.text}</p>{source.date && <time dateTime={source.date}>{new Date(source.date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</time>}
          {source.momentId && <button type="button" className="circle-text-button" onClick={() => onOpenMoment(source.momentId!)}>Open photo group<ArrowRight size={15} aria-hidden="true" /></button>}
        </div>
      </details>)}</div>}
      <p className="circle-graph-answer-credit">{result.mode === "muse" ? "Answered with Muse Spark · Sources include graph records and original accounts." : "Matching sources from your family graph and collection."}</p>
    </div>}
  </section>;
}
