"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import "./sidebar.css";

const KEY = "recall.sidebar.v1";
const MIN = 200, MAX = 340;
const clamp = (width: number) => Math.max(MIN, Math.min(MAX, width));
export function useResizableSidebar(defaultWidth = 222) {
  const [width, setWidth] = useState(defaultWidth), [collapsed, setCollapsed] = useState(false), [ready, setReady] = useState(false), [resizing, setResizing] = useState(false);
  const drag = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (typeof saved?.width === "number" && Number.isFinite(saved.width)) setWidth(clamp(saved.width));
      if (typeof saved?.collapsed === "boolean") setCollapsed(saved.collapsed);
    } catch { /* Storage can be disabled; the sidebar still works. */ }
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) try { localStorage.setItem(KEY, JSON.stringify({ width, collapsed })); } catch { /* Optional preference. */ }
  }, [width, collapsed, ready]);
  return {
    width, collapsed, resizing, defaultWidth, setCollapsed, setWidth, setResizing, drag,
    layoutProps: {
      style: { "--sidebar-size": `${collapsed ? 76 : width}px` } as CSSProperties,
      "data-sidebar-collapsed": collapsed,
      "data-sidebar-resizing": resizing,
    },
  };
}
type Sidebar = ReturnType<typeof useResizableSidebar>;
export function SidebarToggle({ sidebar, controls }: { sidebar: Sidebar; controls: string }) {
  const Icon = sidebar.collapsed ? PanelLeftOpen : PanelLeftClose;
  const label = sidebar.collapsed ? "Expand sidebar" : "Collapse sidebar";
  return <button type="button" className="sidebar-toggle" aria-label={label} title={label} aria-expanded={!sidebar.collapsed} aria-controls={controls} onClick={() => sidebar.setCollapsed(!sidebar.collapsed)}><Icon size={20} aria-hidden="true" /></button>;
}
export function SidebarResizeHandle({ sidebar, controls }: { sidebar: Sidebar; controls: string }) {
  return <div className="sidebar-resizer" role="separator" tabIndex={sidebar.collapsed ? -1 : 0} aria-label="Resize sidebar" aria-orientation="vertical" aria-controls={controls} aria-valuemin={MIN} aria-valuemax={MAX} aria-valuenow={sidebar.width}
    title="Drag to resize. Arrow keys adjust width; double-click to reset."
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      sidebar.drag.current = { x: event.clientX, width: sidebar.width }; sidebar.setResizing(true);
    }}
    onPointerMove={event => {
      const start = sidebar.drag.current;
      if (start) sidebar.setWidth(clamp(start.width + event.clientX - start.x));
    }}
    onPointerUp={event => { sidebar.drag.current = null; sidebar.setResizing(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onLostPointerCapture={() => { sidebar.drag.current = null; sidebar.setResizing(false); }}
    onPointerCancel={() => { sidebar.drag.current = null; sidebar.setResizing(false); }}
    onDoubleClick={() => sidebar.setWidth(sidebar.defaultWidth)}
    onKeyDown={event => {
      const next = event.key === "ArrowLeft" ? sidebar.width - 10 : event.key === "ArrowRight" ? sidebar.width + 10 : event.key === "Home" ? MIN : event.key === "End" ? MAX : null;
      if (next !== null) { event.preventDefault(); sidebar.setWidth(clamp(next)); }
    }} />;
}
