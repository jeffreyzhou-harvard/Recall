"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, MoveHorizontal } from "lucide-react";
import { sessionSupport, type SessionSummary } from "@/lib/recall-preview/sessions";
import { MemorySuggestionForm } from "./MemorySuggestionForm";

const envelope = [.12, .21, .32, .27, .46, .58, .49, .73, .86, 1, .82, .69, .77, .51, .43, .32, .38, .21, .12];
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fullDate = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const dateLabel = (date: string, full = false) => (full ? fullDate : shortDate).format(new Date(date + "T12:00:00Z"));

export function SessionWaveform({ sessions, children }: { sessions: SessionSummary[]; children?: ReactNode }) {
  const [active, setActive] = useState(Math.max(0, sessions.length - 1));
  const [announcement, setAnnouncement] = useState("");
  const track = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const activeRef = useRef(active);
  const reduced = useRef(false);
  const selected = sessions[active] ?? sessions.at(-1);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { reduced.current = preference.matches; };
    update(); preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useLayoutEffect(() => {
    const element = track.current;
    if (!element || !sessions.length) return;
    let frame = 0;
    let settled: ReturnType<typeof setTimeout>;
    let wheelEnd: ReturnType<typeof setTimeout>;
    let step = 144;
    const last = sessions.length - 1;
    activeRef.current = last;
    setActive(last);
    function align() {
      step = buttons.current[0]?.offsetWidth || 144;
      element!.scrollTo({ left: activeRef.current * step, behavior: "instant" });
    }
    align();
    const observer = new ResizeObserver(align);
    observer.observe(element);
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const measuredStep = buttons.current[0]?.offsetWidth || step;
        if (measuredStep !== step) { align(); return; }
        const next = Math.min(last, Math.max(0, Math.round(element.scrollLeft / step)));
        if (activeRef.current !== next) { activeRef.current = next; setActive(next); }
        clearTimeout(settled);
        settled = setTimeout(() => {
          const session = sessions[activeRef.current];
          if (session) setAnnouncement(`${dateLabel(session.date)}. ${session.topicName}. ${sessionSupport(session.outcome)}`);
        }, 180);
      });
    };
    // A mouse wheel traverses the waveform only while it can move. At either
    // boundary the page keeps its normal scroll; horizontal trackpads stay native.
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1);
      const limit = element.scrollWidth - element.clientWidth;
      if ((delta < 0 && element.scrollLeft <= 1) || (delta > 0 && element.scrollLeft >= limit - 1)) return;
      event.preventDefault();
      element.style.scrollSnapType = "none";
      element.scrollBy({ left: delta, behavior: "instant" });
      clearTimeout(wheelEnd);
      wheelEnd = setTimeout(() => {
        element.style.scrollSnapType = "";
        element.scrollTo({ left: Math.round(element.scrollLeft / step) * step, behavior: reduced.current ? "instant" : "smooth" });
      }, 120);
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(settled); clearTimeout(wheelEnd); element.style.scrollSnapType = ""; element.removeEventListener("scroll", onScroll); element.removeEventListener("wheel", onWheel); };
  }, [sessions]);

  function select(index: number, focus = false) {
    const next = Math.max(0, Math.min(sessions.length - 1, index));
    const element = track.current;
    const button = buttons.current[next];
    if (!element || !button) return;
    if (focus) button.focus({ preventScroll: true });
    element.scrollTo({ left: next * button.offsetWidth, behavior: reduced.current ? "instant" : "smooth" });
  }
  function keySelect(event: KeyboardEvent, index: number) {
    const next = event.key === "ArrowLeft" ? index - 1 : event.key === "ArrowRight" ? index + 1 : event.key === "Home" ? 0 : event.key === "End" ? sessions.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); select(next, true);
  }

  if (!selected) return <div className="care-overview"><p>No calls to explore yet. A session will appear here after a Recall conversation.</p><MemorySuggestionForm /></div>;

  return <>
    <div className="session-wave" aria-label="Recall session history">
      <div className="session-wave-toolbar">
        <p><MoveHorizontal size={19} aria-hidden="true" />Scroll through her calls</p>
        <div className="session-wave-controls">
          <button type="button" aria-label="Previous Recall session" disabled={active === 0} onClick={() => select(active - 1)}><ArrowLeft size={21} aria-hidden="true" /></button>
          <button type="button" aria-label="Next Recall session" disabled={active === sessions.length - 1} onClick={() => select(active + 1)}><ArrowRight size={21} aria-hidden="true" /></button>
        </div>
      </div>
      <div className="session-wave-window">
        <div className="session-wave-track" ref={track} role="group" aria-label="Choose a session" aria-describedby="session-wave-instructions">
          <span className="session-wave-space" aria-hidden="true" />
          {sessions.map((session, index) => <button type="button" className="session-wave-stop" key={session.id}
            ref={(element) => { buttons.current[index] = element; }}
            tabIndex={active === index ? 0 : -1} aria-pressed={active === index} aria-controls="selected-session"
            aria-label={`${dateLabel(session.date)}: ${session.topicName}. ${session.unaidedCalls === null ? "Not enough calls yet" : `${session.unaidedCalls} of ${session.recentCalls} recent calls unaided`}`}
            onClick={() => select(index)} onKeyDown={(event) => keySelect(event, index)}>
            <svg viewBox="0 0 144 184" aria-hidden="true" focusable="false">
              <line x1="0" y1="92" x2="144" y2="92" className="session-wave-axis" />
              {envelope.map((level, bar) => {
                const height = session.unaidedCalls === null ? 12 : 8 + session.unaidedCalls * 20 * level;
                return <rect key={bar} x={bar * 7 + 6} y={92 - height / 2} width="4" height={height} rx="2" className={session.unaidedCalls === null ? "session-wave-unmeasured" : "session-wave-bar"} />;
              })}
            </svg>
            <time dateTime={session.date}>{dateLabel(session.date)}</time>
          </button>)}
          <span className="session-wave-space" aria-hidden="true" />
        </div>
        <div className="session-wave-playhead" aria-hidden="true"><span /></div>
        {active === sessions.length - 1 && <p className="session-wave-end" aria-hidden="true">Latest call</p>}
        {active === 0 && <p className="session-wave-start" aria-hidden="true">First call</p>}
      </div>
      <div className="session-wave-caption" id="session-wave-instructions"><p>Taller peaks: more calls about that topic recalled without a cue. Counts use up to 8 calls, as of each date. Dashed marks: not enough calls yet.</p><span>Scroll, tap, or use arrow keys.</span></div>
      <p className="session-sr-only" role="status" aria-live="polite">{announcement}</p>
    </div>
    <div className="care-overview session-overview">
      <div>
        <section className="session-receipt" id="selected-session" aria-labelledby="selected-session-title">
          <div className="session-receipt-heading"><time dateTime={selected.date}>{dateLabel(selected.date, true)}</time><span>Sample call</span></div>
          <div className="session-receipt-content" key={selected.id}>
            <h3 id="selected-session-title">{selected.topicName}</h3>
            <p className="session-support">{sessionSupport(selected.outcome)}</p>
            <p className="session-count">{selected.unaidedCalls === null ? <><strong>Not enough calls yet</strong><span>This topic needs at least 3 calls before a peak is shown.</span></> : <><strong>{selected.unaidedCalls} of {selected.recentCalls} recent calls unaided</strong><span>For this topic, up to {dateLabel(selected.date)}.</span></>}</p>
          </div>
          <p className="care-caption session-privacy">A brief account of the support used. Personal words stay private.</p>
        </section>
        {children}
      </div>
      <MemorySuggestionForm />
    </div>
  </>;
}
