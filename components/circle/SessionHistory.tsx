"use client";

import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { withoutTopic, type SessionSummary } from "@/lib/family/session-summary";
import familyCopy from "@/fixtures/family-copy.json";
import thresholds from "@/fixtures/record-thresholds.json";

// A closed spine reads its unaided count as height. The shortest measured book keeps
// most of the tallest one's height, so the shelf stays legible without exaggerating
// a difference of one or two calls. Insufficient history uses a dashed outline.
const MEASURED_FLOOR = .5;
const MEASURED_CEILING = .82;
const UNMEASURED_SCALE = .5;
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const fullDate = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const dateLabel = (date: string, full = false) => (full ? fullDate : shortDate).format(new Date(date + "T12:00:00Z"));

export function SessionHistory({ sessions: allSessions, recordWindow = thresholds.record_window_calls, minimumCalls = thresholds.min_calls_to_show }: { sessions: SessionSummary[]; recordWindow?: number; minimumCalls?: number }) {
  const [topicFilter, setTopicFilter] = useState("all");
  const sessions = useMemo(() => allSessions.filter((session) => topicFilter === "all" || session.topicId === topicFilter).sort((a, b) => a.date.localeCompare(b.date)), [allSessions, topicFilter]);
  const topics = [...new Map(allSessions.map((session) => [session.topicId, session.topicName])).entries()];
  const [selectedId, setSelectedId] = useState(sessions.at(-1)?.id);
  const found = sessions.findIndex((session) => session.id === selectedId);
  const active = found < 0 ? Math.max(0, sessions.length - 1) : found;
  const [announcement, setAnnouncement] = useState("");
  const [navigationTarget, setNavigationTarget] = useState<number | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const books = useRef<(HTMLSpanElement | null)[]>([]);
  const placements = useRef<(HTMLSpanElement | null)[]>([]);
  const positions = useRef<number[]>([]);
  const activeRef = useRef(active);
  const selectedRef = useRef(selectedId);
  const targetRef = useRef<number | null>(null);
  const cancelPending = useRef<() => void>(() => {});
  const reduced = useRef(false);
  const selected = sessions[active] ?? sessions.at(-1);
  const firstDate = sessions[0]?.date;
  const lastDate = sessions.at(-1)?.date;
  const dateSpan = firstDate && lastDate ? Date.parse(lastDate) - Date.parse(firstDate) : 0;
  const timelinePosition = selected && firstDate && dateSpan > 0 ? (Date.parse(selected.date) - Date.parse(firstDate)) / dateSpan * 100 : 50;

  useLayoutEffect(() => {
    const element = track.current;
    if (!element || !sessions.length) return;
    let frame = 0;
    let settled: ReturnType<typeof setTimeout>;
    let wheelEnd: ReturnType<typeof setTimeout>;
    cancelPending.current = () => {
      clearTimeout(settled);
      clearTimeout(wheelEnd);
      element.style.scrollSnapType = "";
    };
    let step = 72;
    let endOffset = 0;
    let visibleRadius = 20;
    const last = sessions.length - 1;
    const preserved = sessions.findIndex((session) => session.id === selectedRef.current);
    activeRef.current = preserved < 0 ? last : preserved;
    selectedRef.current = sessions[activeRef.current]!.id;
    setSelectedId(selectedRef.current);
    targetRef.current = null;
    setNavigationTarget(null);
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduced.current = preference.matches;
    // Only transforms change while scrolling. Slot geometry is cached on resize;
    // neither React nor layout measurement runs for every animation frame.
    function paint() {
      const progress = (element!.scrollLeft - (positions.current[0] ?? 0)) / step;
      const shelfOffset = last ? (progress / last * 2 - 1) * endOffset : 0;
      // Offscreen books keep their last transform. Update only the visible band
      // (plus a cover-width buffer), even when the sample archive contains months.
      const start = Math.max(0, Math.floor(progress - visibleRadius));
      const end = Math.min(last, Math.ceil(progress + visibleRadius));
      for (let index = start; index <= end; index++) {
        const button = buttons.current[index];
        if (!button) continue;
        const distance = index - progress;
        const closed = Math.min(1, Math.abs(distance));
        const openness = 1 - closed * closed * (3 - 2 * closed);
        const count = sessions[index]?.unaidedCalls;
        const restingScale = count === null || count === undefined ? UNMEASURED_SCALE : MEASURED_FLOOR + (MEASURED_CEILING - MEASURED_FLOOR) * Math.min(1, Math.max(0, count / Math.max(1, recordWindow)));
        const heightScale = restingScale + (1 - restingScale) * openness;
        // Keep the snap target untransformed; only its visual child moves.
        if (placements.current[index]) placements.current[index]!.style.transform = reduced.current ? "none" : `translateX(${Math.sign(distance) * closed * 112 + shelfOffset}px)`;
        button.style.zIndex = String(100 - Math.min(99, Math.round(Math.abs(distance) * 10)));
        const book = books.current[index];
        if (book) {
          book.style.transform = reduced.current ? "none" : `rotateY(${-90 + openness * 82}deg) scaleY(${heightScale})`;
          book.style.setProperty("--book-unscale", reduced.current ? "1" : String(1 / heightScale));
          book.style.setProperty("--cover-opacity", reduced.current ? "1" : String(Math.max(0, (openness - .5) * 2)));
        }
      }
    }
    function align() {
      endOffset = Math.min(190, Math.max(0, (element!.clientWidth - 560) / 2));
      positions.current = sessions.map((_, index) => {
        const button = buttons.current[index]!;
        return button.offsetLeft + button.offsetWidth / 2 - element!.clientWidth / 2;
      });
      step = positions.current.length > 1 ? positions.current[1]! - positions.current[0]! : buttons.current[0]!.offsetWidth;
      visibleRadius = Math.ceil((element!.clientWidth / 2 + endOffset + 350) / step);
      element!.scrollTo({ left: positions.current[targetRef.current ?? activeRef.current], behavior: "instant" });
      paint();
    }
    align();
    const observer = new ResizeObserver(align);
    observer.observe(element);
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        paint();
        const next = Math.min(last, Math.max(0, Math.round((element.scrollLeft - (positions.current[0] ?? 0)) / step)));
        if (activeRef.current !== next) {
          activeRef.current = next;
          selectedRef.current = sessions[next]!.id;
          setSelectedId(sessions[next]!.id);
        }
        clearTimeout(settled);
        settled = setTimeout(() => {
          const target = targetRef.current;
          if (target === null || Math.abs(element.scrollLeft - (positions.current[target] ?? 0)) < 1) {
            targetRef.current = null;
            setNavigationTarget(null);
          }
          const session = sessions[activeRef.current];
          if (session) setAnnouncement(`${dateLabel(session.date)}. ${session.topicName}. ${recordCount(session)}`);
        }, 180);
      });
    };
    // A mouse wheel traverses the shelf only while it can move. At either
    // boundary the page keeps its normal scroll; horizontal trackpads stay native.
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      clearTimeout(settled);
      clearTimeout(wheelEnd);
      targetRef.current = null;
      setNavigationTarget(null);
      if (event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) {
        element.style.scrollSnapType = "";
        return;
      }
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1);
      const limit = element.scrollWidth - element.clientWidth;
      if ((delta < 0 && element.scrollLeft <= 1) || (delta > 0 && element.scrollLeft >= limit - 1)) {
        element.style.scrollSnapType = "";
        return;
      }
      event.preventDefault();
      element.style.scrollSnapType = "none";
      element.scrollBy({ left: delta, behavior: "instant" });
      wheelEnd = setTimeout(() => {
        element.style.scrollSnapType = "";
        element.scrollTo({ left: positions.current[Math.min(last, Math.max(0, Math.round((element.scrollLeft - (positions.current[0] ?? 0)) / step)))], behavior: reduced.current ? "instant" : "smooth" });
      }, 120);
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    element.addEventListener("wheel", onWheel, { passive: false });
    const onPreference = () => { reduced.current = preference.matches; align(); };
    const onPointer = () => { cancelPending.current(); targetRef.current = null; setNavigationTarget(null); };
    preference.addEventListener("change", onPreference);
    element.addEventListener("pointerdown", onPointer, { passive: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      cancelPending.current();
      cancelPending.current = () => {};
      element.removeEventListener("scroll", onScroll);
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("pointerdown", onPointer);
      preference.removeEventListener("change", onPreference);
    };
  }, [sessions, recordWindow]);

  function select(index: number, focus = false) {
    const next = Math.max(0, Math.min(sessions.length - 1, index));
    const element = track.current;
    const button = buttons.current[next];
    if (!element || !button) return;
    cancelPending.current();
    targetRef.current = next;
    setNavigationTarget(next);
    if (focus) button.focus({ preventScroll: true });
    element.scrollTo({ left: positions.current[next], behavior: reduced.current ? "instant" : "smooth" });
  }
  function keySelect(event: KeyboardEvent, index: number) {
    const next = event.key === "ArrowLeft" ? index - 1 : event.key === "ArrowRight" ? index + 1 : event.key === "Home" ? 0 : event.key === "End" ? sessions.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); select(next, true);
  }

  if (!selected) return <p className="circle-record-empty">No Recall calls yet.</p>;

  return <>
    <div className="circle-session-shelf" aria-label="Recall session history">
      <div className="circle-session-shelf-toolbar">
        <p>Scroll to explore</p>
        <div className="circle-session-shelf-controls">

          <button type="button" aria-label="Previous Recall session" disabled={(navigationTarget ?? active) === 0} onClick={() => select((targetRef.current ?? activeRef.current) - 1)}>Previous</button>
          <button type="button" aria-label="Next Recall session" disabled={(navigationTarget ?? active) === sessions.length - 1} onClick={() => select((targetRef.current ?? activeRef.current) + 1)}>Next</button>
        </div>
      </div>
      <div className="circle-session-topic-filter" role="group" aria-label="Filter sessions by topic">
        {[["all", "All calls"], ...topics].map(([id, name]) => <button type="button" key={id} aria-pressed={topicFilter === id} onClick={() => setTopicFilter(id!)}>{name}</button>)}
      </div>
      <div className="circle-session-shelf-window">
        <div className="circle-session-shelf-track" ref={track} role="group" aria-label="Choose a session" aria-describedby="circle-session-shelf-instructions">
          <span className="circle-session-shelf-space" aria-hidden="true" />
          {sessions.map((session, index) => <button type="button" className="circle-session-shelf-stop" key={session.id}
            ref={(element) => { buttons.current[index] = element; }}
            tabIndex={active === index ? 0 : -1} aria-pressed={active === index} aria-controls="selected-circle-session"
            aria-label={`${dateLabel(session.date)}: ${session.topicName}. ${recordCount(session)}`}
            onClick={() => select(index)} onKeyDown={(event) => keySelect(event, index)}>
            <span className="circle-session-book-placement" aria-hidden="true" ref={(element) => { placements.current[index] = element; }}>
            <span className="circle-session-book" ref={(element) => { books.current[index] = element; }}>
              <span className="circle-session-book-cover">
                <span className="circle-session-book-content">
                <span className="circle-session-book-title">{session.topicName}</span>
                <span className="circle-session-book-count">{recordCount(session)}</span>
                <span className="circle-session-book-date"><time dateTime={session.date}>{dateLabel(session.date)}</time><span>Recall</span></span>
                </span>
              </span>
              <span className="circle-session-book-spine" data-unmeasured={session.unaidedCalls === null}><time dateTime={session.date}>{dateLabel(session.date)}</time></span>
              <span className="circle-session-book-back" />
            </span>
            </span>
          </button>)}
          <span className="circle-session-shelf-space" aria-hidden="true" />
        </div>
      </div>
      <div className="circle-session-timeline" aria-label={`Call dates: ${dateLabel(firstDate!)} to ${dateLabel(lastDate!)}. Selected ${dateLabel(selected.date)}.`}>
        <div className="circle-session-timeline-line" aria-hidden="true"><span className="circle-session-timeline-marker" style={{ left: `${timelinePosition}%` }} /></div>
        <div className="circle-session-timeline-dates" aria-hidden="true"><time dateTime={firstDate}>{dateLabel(firstDate!)}</time><span>Call dates</span><time dateTime={lastDate}>{dateLabel(lastDate!)}</time></div>
      </div>
      <div className="circle-session-shelf-legend" id="circle-session-shelf-instructions">
        <span><svg viewBox="0 0 36 28" aria-hidden="true"><rect x="2" y="12" width="7" height="14" rx="1" /><rect x="14" y="8" width="7" height="18" rx="1" /><rect x="26" y="3" width="7" height="23" rx="1" /></svg>Closed spine height: calls unaided for this topic, within the last {recordWindow} calls</span>
        <span><svg viewBox="0 0 24 28" aria-hidden="true" className="circle-session-legend-outline"><rect x="5" y="3" width="14" height="23" rx="1" /></svg>Dashed outline: fewer than {minimumCalls} calls</span>
      </div>
      <p className="circle-session-shelf-help">One book per call. The selected cover opens for reading. Use Left / Right, Home / End, or scroll to choose a call. The timeline dot marks its date.</p>
      <p className="circle-session-motion-help">Reduced motion: equal-sized covers show the counts in words. The outlined cover is selected.</p>
      <p className="circle-session-sr-only" role="status" aria-live="polite">{announcement}</p>
    </div>
    <section className="circle-session-receipt" id="selected-circle-session" aria-labelledby="selected-circle-session-title">
      <div className="circle-session-receipt-heading"><time dateTime={selected.date}>{dateLabel(selected.date, true)}</time><span>Selected call</span></div>
      <div className="circle-session-receipt-content">
        <h3 id="selected-circle-session-title">{selected.topicName}</h3>
        <p className="circle-session-count">{recordCount(selected)}</p>
      </div>
    </section>
  </>;
}

/** All factual record sentences come from the same fixed copy as the record tools. */
function recordCount(session: SessionSummary) {
  const template = session.unaidedCalls === null ? familyCopy.lines.record_not_enough : familyCopy.lines.record_unaided;
  const slots: Record<string, string> = { topic: session.topicName, unaided: String(session.unaidedCalls), calls: String(session.recentCalls) };
  // The cover, the receipt and every label already name the topic beside this sentence.
  return withoutTopic(template.text.replace(/\{(\w+)\}/g, (_, key: string) => slots[key] ?? ""), session.topicName);
}
