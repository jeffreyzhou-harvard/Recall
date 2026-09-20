"use client";

import { createPortal } from "react-dom";

/**
 * The per-topic record as a printable page, so an approved member can save a PDF
 * for a doctor (AGENTS.md section 6.4.5). It mounts at the body so the print
 * stylesheet can drop the rest of the page without leaving blank sheets behind.
 */
export function RecordPrintout({ name, text }: { name: string; text: string }) {
  if (typeof document === "undefined") return null;
  return createPortal(<article className="care-record-print">
    <h1>Recall call record</h1>
    <p className="care-record-print-subject">{name}</p>
    {text.split("\n").map((line, index) => line.trim()
      ? <p key={index} className={line.startsWith("  ") ? "care-record-print-detail" : undefined}>{line.trim()}</p>
      : <span key={index} className="care-record-print-gap" />)}
  </article>, document.body);
}
