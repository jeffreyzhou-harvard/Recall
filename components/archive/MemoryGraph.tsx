"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, AudioLines, ChevronLeft, ChevronRight, ImageIcon, MapPin, Minus, Plus, RotateCcw, X } from "lucide-react";
import type { FamilyConnections, Moment, Photo, Story } from "@/lib/archive/types";
import "@/app/archive-visualizations.css";

type Kind = "person" | "event" | "place" | "story";
type GraphNode = { id: string; label: string; kind: Kind; x: number; y: number; photo?: string; detail: string; momentIds: string[]; stories?: Story[]; relationships?: string[] };
type GraphEdge = { from: string; to: string; kind: "named" | "story" | "relationship"; label: string; properties: Record<string, string>; evidence?: NonNullable<Story["callEvidence"]>[] };
const edgeKey = (edge: GraphEdge) => JSON.stringify([edge.from, edge.to, edge.kind]);
const displayDate = (value: string) => Number.isNaN(Date.parse(value)) ? value : new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
type Props = { moments: Moment[]; photos: Photo[]; stories: Story[]; connections?: FamilyConnections; onSelect: (moment: Moment) => void };
const filters: Array<{ value: "all" | Kind; label: string }> = [{ value: "all", label: "Everything" }, { value: "person", label: "People" }, { value: "place", label: "Places" }, { value: "story", label: "Stories" }];

export function MemoryGraph({ moments, photos, stories, connections, onSelect }: Props) {
  const [zoom, setZoom] = useState(1), [pan, setPan] = useState({ x: 0, y: 0 });
  const [selected, setSelected] = useState<string | null>(null), [filter, setFilter] = useState<"all" | Kind>("all");
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [width, setWidth] = useState(1000);
  const viewport = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const reduceMotion = useReducedMotion();
  const id = useId().replace(/:/g, "");
  const pageCount = Math.max(1, Math.ceil(moments.length / 4));
  const currentPage = Math.min(pageIndex, pageCount - 1);
  const pageMoments = useMemo(() => moments.slice(currentPage * 4, currentPage * 4 + 4), [moments, currentPage]);

  useEffect(() => {
    if (!viewport.current) return;
    const update = () => setWidth(Math.max(280, viewport.current?.clientWidth ?? 1000));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [moments.length, connections?.people.length]);

  const graph = useMemo(() => {
    const nodes: GraphNode[] = [], edges: GraphEdge[] = [];
    const centerX = width / 2, centerY = 325;
    const names = filter === "story" ? [] : [...new Set([...(connections?.people.map(person => person.name) ?? []), ...pageMoments.flatMap((moment) => [...moment.people,...stories.filter(s=>s.eventId===moment.id).map(s=>s.author)])].filter((name) => name.trim()))];
    names.forEach((name, index) => {
      const angle = index / Math.max(names.length, 1) * Math.PI * 2 - Math.PI / 2;
      const supplied = connections?.people.find(person => person.name === name);
      nodes.push({ id: `person:${name}`, label: name, kind: "person", x: centerX + Math.cos(angle) * Math.min(105,width*.17), y: centerY + Math.sin(angle) * 85, detail: supplied ? connections!.source : "Connected through family labels or an original story", momentIds: pageMoments.filter((moment) => supplied?.momentIds.includes(moment.id)||moment.people.includes(name)||stories.some(s=>s.eventId===moment.id&&s.author===name)).map((moment) => moment.id), relationships: connections?.relationships.filter(tie => tie.from === name || tie.to === name).map(tie => tie.label) });
    });
    if (filter !== "story") connections?.relationships.forEach(tie => {
      if (names.includes(tie.from) && names.includes(tie.to)) edges.push({ from: `person:${tie.from}`, to: `person:${tie.to}`, kind: "relationship", label: tie.label, properties: { Relationship: tie.relation ?? tie.label, Source: connections!.source } });
    });
    pageMoments.forEach((moment, index) => {
      const angle = index / Math.max(pageMoments.length, 1) * Math.PI * 2 - Math.PI / 2 + .35;
      const x = filter === "story" ? centerX + (index % 2 ? 150 : -220) : centerX + Math.cos(angle) * Math.min(285, width * .285);
      const y = filter === "story" ? 175 + Math.floor(index / 2) * 230 : centerY + Math.sin(angle) * 205;
      const eventId = `moment:${moment.id}`;
      nodes.push({ id: eventId, label: moment.title, kind: "event", x, y, photo: photos.find((photo) => photo.id === moment.coverId)?.url, detail: "A moment from your family photographs", momentIds: [moment.id] });
      if (filter !== "story") new Set([...moment.people, ...(connections?.people.filter(person => person.momentIds.includes(moment.id)).map(person => person.name) ?? [])].filter(name => name.trim())).forEach((name) => edges.push({ from: `person:${name}`, to: eventId, kind: "named", label: "Connected to this moment", properties: { Source: connections?.people.some(person => person.name === name && person.momentIds.includes(moment.id)) ? connections.source : "Photo group labels", Person: name, Moment: moment.title } }));
      if (filter !== "story" && moment.place?.trim()) {
        const placeId = `place:${moment.place}`;
        const existing = nodes.find((node) => node.id === placeId);
        if (existing) existing.momentIds.push(moment.id);
        else {
          // Keep the outer place nodes clear of the photo captions beneath them.
          const placeAngle = angle + (Math.cos(angle) < 0 && Math.sin(angle) > 0 ? .6 : .3);
          const lowerRight = Math.cos(angle) > 0 && Math.sin(angle) > 0;
          nodes.push({ id: placeId, label: moment.place, kind: "place", x: centerX + Math.cos(placeAngle) * Math.min(430, width * .42), y: centerY + Math.sin(placeAngle) * 250 + (lowerRight ? 60 : 0), detail: "A setting connected to these photographs", momentIds: [moment.id] });
        }
        edges.push({ from: eventId, to: placeId, kind: "named", label: "Photo location", properties: { Source: "Photo group location", Place: moment.place, ...(moment.startAt ? { "Photo date": displayDate(moment.startAt) } : {}) } });
      }
    });
    pageMoments.forEach((moment) => {
      const event = nodes.find((node) => node.id === `moment:${moment.id}`);
      const ownStories = stories.filter((story) => story.eventId === moment.id);
      const storyId = `stories:${moment.id}`;
      if (!event || !ownStories.length) return;
      const first = ownStories[0]!;
      // A source node opens every story for this memory without crowding the canvas.
      const x = filter === "story" ? event.x + 130 : event.x + (event.y < centerY ? 105 : -105);
      const y = filter === "story" ? event.y + 110 : event.y + (event.x >= centerX ? 130 : -130);
      nodes.push({ id: storyId, label: ownStories.length === 1 ? `${first.author}’s story` : `${ownStories.length} stories`, kind: "story", x, y, momentIds: [moment.id], detail: ownStories.length === 1 ? first.text : "Original stories for this memory", stories: ownStories });
      edges.push({ from: storyId, to: event.id, kind: "story", label: "Story about this moment", properties: { Source: "Attributed stories", Stories: String(ownStories.length) }, evidence: ownStories.flatMap(story => story.callEvidence ? [story.callEvidence] : []) });
      if(filter!=='story')for(const author of new Set(ownStories.map(s=>s.author))) edges.push({from:`person:${author}`,to:storyId,kind:'story', label: "Story told by", properties: { Author: author, Source: "Original contributions", Stories: String(ownStories.filter(story => story.author === author).length) }});
    });
    if(width<600)nodes.forEach(node=>{node.x=Math.max(72,Math.min(width-72,node.x));});
    return { nodes, edges, byId: new Map(nodes.map((node) => [node.id, node])) };
  }, [pageMoments, photos, stories, connections, width, filter]);

  const picked = selected ? graph.byId.get(selected) : undefined;
  const pickedEdge = graph.edges.find(edge => edgeKey(edge) === selectedEdge);
  const hasSelection = !!(picked || pickedEdge);
  const related = new Set(pickedEdge ? [pickedEdge.from, pickedEdge.to] : [selected, ...graph.edges.filter((edge) => edge.from === selected || edge.to === selected).flatMap((edge) => [edge.from, edge.to])]);
  const visibleCount = graph.nodes.filter((node) => filter === "all" || node.kind === filter).length;
  const clearSelection = () => { setSelected(null); setSelectedEdge(null); };
  const selectNode = (node: string) => { setSelected(selected === node ? null : node); setSelectedEdge(null); };
  const reset = () => { setZoom(1); setPan({ x: 0, y: 0 }); clearSelection(); };
  const changePage = (page: number) => { setPageIndex(page); reset(); };

  return <section className="archive-graph" aria-label="Connections in your contributions">
    <div className="archive-graph-toolbar">
      <div className="archive-graph-tabs" role="group" aria-label="Filter connections">{filters.map(({ value, label }) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); clearSelection(); }}>{label}</button>)}</div>
      {moments.length > 4 ? <nav className="archive-graph-paging" aria-label="Browse memory connections">
        <button type="button" disabled={currentPage === 0} onClick={() => changePage(currentPage - 1)}><ChevronLeft size={18} aria-hidden="true" />Previous</button>
        <span aria-live="polite">{currentPage * 4 + 1}–{Math.min(currentPage * 4 + 4, moments.length)} of {moments.length}</span>
        <button type="button" disabled={currentPage === pageCount - 1} onClick={() => changePage(currentPage + 1)}>Next<ChevronRight size={18} aria-hidden="true" /></button>
      </nav> : <p>{connections?.source ?? "Every connection has a source."}</p>}
    </div>
    {moments.length === 0 && !connections?.people.length ? <div className="archive-viz-empty"><h2>Your connections start with a memory.</h2><p>People and places you name in your contributions will appear here.</p></div> : <>
      <p className="archive-graph-help" id={`${id}-instructions`}>Select a person, memory, or connecting line to see its source and details.</p>
      <p className="archive-viz-sr" aria-live="polite">{visibleCount} {filter === "all" ? "connections" : filters.find((item) => item.value === filter)?.label.toLowerCase()} shown.</p>
      <div className="archive-graph-viewport" ref={viewport}>
        <svg className="archive-graph-svg" viewBox={`0 0 ${width} 650`} role="group" tabIndex={0} aria-label="Memory connections" aria-describedby={`${id}-instructions`}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            const directions: Record<string, { x: number; y: number }> = { ArrowLeft: { x: 50, y: 0 }, ArrowRight: { x: -50, y: 0 }, ArrowUp: { x: 0, y: 50 }, ArrowDown: { x: 0, y: -50 } };
            const direction = directions[event.key];
            if (direction) { event.preventDefault(); setPan((current) => ({ x: current.x + direction.x, y: current.y + direction.y })); }
            if (event.key === "Escape") clearSelection();
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 || (event.target as Element).closest("[data-node], [data-edge]")) return;
            dragging.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!dragging.current) return;
            const rect = event.currentTarget.getBoundingClientRect();
            setPan({ x: dragging.current.panX + (event.clientX - dragging.current.x) * width / rect.width, y: dragging.current.panY + (event.clientY - dragging.current.y) * 650 / rect.height });
          }}
          onPointerUp={() => { dragging.current = null; }} onPointerCancel={() => { dragging.current = null; }} onLostPointerCapture={() => { dragging.current = null; }}>
          <defs>
            <pattern id={`${id}-dots`} width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="var(--recall-line)" /></pattern>
            {graph.nodes.map((node, index) => node.photo && <clipPath key={node.id} id={`${id}-photo-${index}`}><circle cx={node.x} cy={node.y} r="38" /></clipPath>)}
          </defs>
          <rect width={width} height="650" fill={`url(#${id}-dots)`} opacity=".5" />
          <g transform={`translate(${pan.x + width / 2 * (1 - zoom)},${pan.y + 325 * (1 - zoom)}) scale(${zoom})`}>
            {graph.edges.map((edge, index) => {
              const from = graph.byId.get(edge.from), to = graph.byId.get(edge.to);
              if (!from || !to) return null;
              const key = edgeKey(edge), isPicked = selectedEdge === key;
              const isRelated = isPicked || edge.from === selected || edge.to === selected;
              const d = `M${from.x},${from.y} Q${(from.x + to.x) / 2 + 15},${(from.y + to.y) / 2 - 30} ${to.x},${to.y}`;
              const choose = () => { setSelected(null); setSelectedEdge(isPicked ? null : key); };
              return <g key={key} className="archive-graph-edge" data-edge={key} role="button" tabIndex={0} aria-pressed={isPicked} aria-label={`${from.label} to ${to.label}: ${edge.label}. Show connection details.`}
                onClick={choose} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(); } if (event.key === "Escape") clearSelection(); }}>
                <title>{edge.label}</title>
                <path className="archive-graph-edge-target" d={d} stroke="transparent" strokeWidth={18} fill="none" />
                <motion.path className="archive-graph-edge-line" initial={reduceMotion ? false : { pathLength: .05 }} animate={{ pathLength: 1, opacity: hasSelection && !isRelated ? .16 : 1 }} transition={{ duration: reduceMotion ? 0 : .9, delay: reduceMotion ? 0 : Math.min(index * .025, .4) }} d={d} stroke={edge.kind === "story" ? "var(--recall-clay)" : hasSelection && isRelated ? "var(--recall-focus)" : "var(--recall-muted)"} strokeWidth={isPicked ? 3 : hasSelection && isRelated ? 2 : 1.5} fill="none" />
              </g>;
            })}
            {graph.nodes.map((node, index) => {
              const filteredOut = filter !== "all" && filter !== node.kind;
              return <motion.g className="archive-graph-node" key={node.id} data-node={node.id} data-kind={node.kind} role="button" tabIndex={filteredOut ? -1 : 0} aria-label={`${node.label}. ${node.kind === "story" ? "Contributor’s original story" : node.detail}`} aria-pressed={selected === node.id} aria-disabled={filteredOut || undefined}
                initial={reduceMotion ? false : { opacity: .5, scale: .85 }} animate={{ opacity: filteredOut || (hasSelection && !related.has(node.id)) ? .2 : 1, scale: 1 }} transition={{ delay: reduceMotion ? 0 : Math.min(index * .035, .5), duration: reduceMotion ? 0 : .45 }} style={{ transformOrigin: `${node.x}px ${node.y}px`, pointerEvents: filteredOut ? "none" : "auto" }}
                onClick={() => selectNode(node.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectNode(node.id); } if (event.key === "Escape") clearSelection(); }}>
                <title>{node.label}</title>
                <circle className="archive-graph-node-ring" cx={node.x} cy={node.y} r={node.kind === "event" ? 44 : node.kind === "person" ? 33 : 27} strokeWidth={selected === node.id ? 3 : 1.5} />
                {node.photo ? <image href={node.photo} x={node.x - 38} y={node.y - 38} width="76" height="76" preserveAspectRatio="xMidYMid slice" clipPath={`url(#${id}-photo-${index})`} /> : node.kind === "person" ? <text className="archive-graph-initial" x={node.x} y={node.y + 9} textAnchor="middle">{node.label[0]}</text> : <g transform={`translate(${node.x - 12},${node.y - 12})`} aria-hidden="true">{node.kind === "place" ? <MapPin size={24} /> : node.kind === "event" ? <ImageIcon size={24} /> : <AudioLines size={24} />}</g>}
                <text className="archive-graph-label" x={node.x} y={node.y + (node.kind === "event" ? 68 : node.kind === "person" ? 57 : 49)} textAnchor="middle">{node.label.length > 27 ? `${node.label.slice(0, 26)}…` : node.label}</text>
              </motion.g>;
            })}
          </g>
        </svg>
        {filter !== "all" && visibleCount === 0 && <p className="archive-graph-filter-empty">No {filters.find((item) => item.value === filter)?.label.toLowerCase()} have been added to these memories.</p>}
      </div>
      <div className="archive-graph-footer">
        <div className="archive-graph-controls" role="group" aria-label="Graph view">
          <button type="button" aria-label="Zoom out" disabled={zoom <= .6} onClick={() => setZoom((current) => Math.max(.6, current - .15))}><Minus size={22} aria-hidden="true" /></button>
          <output aria-label="Zoom level">{Math.round(zoom * 100)}%</output>
          <button type="button" aria-label="Zoom in" disabled={zoom >= 2} onClick={() => setZoom((current) => Math.min(2, current + .15))}><Plus size={22} aria-hidden="true" /></button>
          <button type="button" aria-label="Reset graph view" onClick={reset}><RotateCcw size={22} aria-hidden="true" /></button>
        </div>
        <div className="archive-graph-legend" aria-label="Connection types"><span><i data-kind="person" />People</span><span><i data-kind="event" />Moments</span><span><i data-kind="place" />Places</span><span><i data-kind="story" />Stories</span></div>
      </div>
      {pickedEdge && <motion.aside className="archive-graph-inspector" key={selectedEdge} initial={reduceMotion ? false : { opacity: .6, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : .2 }} aria-label="Connection details">
        <button type="button" className="archive-viz-close" aria-label="Close connection details" onClick={clearSelection}><X size={22} aria-hidden="true" /></button>
        <h2>{pickedEdge.label}</h2>
        <p>{graph.byId.get(pickedEdge.from)?.label} <span aria-hidden="true">→</span> {graph.byId.get(pickedEdge.to)?.label}</p>
        <dl className="archive-graph-properties">{Object.entries(pickedEdge.properties).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {pickedEdge.evidence?.map((evidence, index) => <section className="archive-graph-evidence" key={`${evidence.recordedAt}:${index}`} aria-label={`Shared call source from ${evidence.author}`}>
          <h3>{evidence.author}’s shared words</h3>
          <dl className="archive-graph-properties">
            <div><dt>Edge type</dt><dd>{evidence.edgeType}</dd></div>
            <div><dt>Source</dt><dd>{evidence.source}</dd></div>
            <div><dt>Recorded</dt><dd>{displayDate(evidence.recordedAt)}</dd></div>
            <div><dt>Standing</dt><dd>{evidence.status === "participant_confirmed" ? "Confirmed by the speaker" : evidence.status.replaceAll("_", " ")}</dd></div>
            <div><dt>Sharing confirmed</dt><dd>{displayDate(evidence.shareConfirmedAt)}</dd></div>
            {Object.entries(evidence.properties).map(([label, value]) => <div key={label}><dt>{label.replaceAll("_", " ")}</dt><dd>{value === null ? "Not specified" : String(value)}</dd></div>)}
          </dl>
        </section>)}
      </motion.aside>}
      {picked && <motion.aside className="archive-graph-inspector" key={picked.id} initial={reduceMotion ? false : { opacity: .6, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : .2 }} aria-label={`Source for ${picked.label}`}>
        <button type="button" className="archive-viz-close" aria-label="Close source details" onClick={() => setSelected(null)}><X size={22} aria-hidden="true" /></button>
        <h2>{picked.label}</h2>
        {picked.stories && picked.stories.length > 1 ? <div className="archive-graph-story-list">{picked.stories.map((story) => <details key={story.id}><summary>{story.author}’s story</summary><p className="archive-graph-story">{story.text}</p></details>)}</div> : <p className={picked.kind === "story" ? "archive-graph-story" : undefined}>{picked.detail}</p>}
        {picked.relationships?.map(relationship => <p className="archive-graph-story" key={relationship}>{relationship}</p>)}
        {picked.momentIds.map((momentId) => {
          const moment = moments.find((item) => item.id === momentId);
          return moment && <button type="button" className="archive-viz-text-button" key={momentId} onClick={() => onSelect(moment)}>{picked.momentIds.length > 1 ? moment.title : "Open the memory"}<ArrowRight size={20} aria-hidden="true" /></button>;
        })}
      </motion.aside>}
    </>}
  </section>;
}
