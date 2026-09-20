"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";

/** Shared focus and dismissal behavior for the archive's upload and photo drawer. */
export function ArchiveDialog({ title, children, onClose, drawer = false, busy = false, focusKey = "" }: { title: string; children: ReactNode; onClose: () => void; drawer?: boolean; busy?: boolean; focusKey?: string }) {
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  const isBusy = useRef(busy);
  close.current = onClose;
  isBusy.current = busy;
  const reduced = useReducedMotion();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isBusy.current) { event.preventDefault(); close.current(); }
      if (event.key !== "Tab" || !dialog.current) return;
      const targets = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex="0"]')).filter((item) => item.getClientRects().length);
      const first = targets[0], last = targets.at(-1);
      if (!first) { event.preventDefault(); dialog.current.focus(); return; }
      if (!dialog.current.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); document.body.style.overflow = before; previous?.isConnected && previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => { dialog.current?.focus(); }, [focusKey]);
  return <motion.div className={`archive-backdrop${drawer ? " archive-backdrop-drawer" : ""}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .16 }} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <motion.section ref={dialog} className={drawer ? "archive-drawer" : "archive-dialog"} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} initial={reduced ? false : { opacity: 0, x: drawer ? 48 : 0, y: drawer ? 0 : 16 }} animate={{ opacity: 1, x: 0, y: 0 }} exit={reduced ? undefined : { opacity: 0, x: drawer ? 24 : 0 }} transition={{ duration: .24, ease: [.16, 1, .3, 1] }}>
      <button className="archive-close" onClick={onClose} disabled={busy} aria-label={`Close ${title.toLowerCase()}`}><X size={22} aria-hidden="true" /></button>
      {children}
    </motion.section>
  </motion.div>;
}
