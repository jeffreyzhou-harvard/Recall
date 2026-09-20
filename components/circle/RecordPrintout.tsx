"use client";

import { createPortal } from "react-dom";
import { withoutTopic } from "@/lib/family/session-summary";

/**
 * The per-topic record as a printable document, so an approved member can hand a doctor a paper
 * copy or a PDF (AGENTS.md section 6.4.5). Every sentence is the text tool 16 returned; the
 * headings and the letterhead are the only things added, and neither states anything about her.
 * It mounts at the body so the print stylesheet can drop the rest of the page without leaving
 * blank sheets behind.
 */
export function RecordPrintout({ name, member, text }: { name: string; member: string; text: string }) {
  if (typeof document === "undefined") return null;
  // renderExport (lib/family/record.ts) writes the fixed header, the export note and the generated
  // date first, then a blank line before the topics and before each comparison block.
  const [preamble = [], topics = [], ...rest] = blocks(text);
  const generated = preamble.find((line) => line.startsWith("Generated "));
  const notes = preamble.filter((line) => line !== generated);
  const comparisons = rest.flat();
  return createPortal(<article className="care-record-print">
    <header className="care-record-print-head">
      <p className="care-record-print-mark">Recall</p>
      <h1>Record of Recall calls</h1>
      <dl>
        <div><dt>Person</dt><dd>{name}</dd></div>
        <div><dt>Prepared by</dt><dd>{member}</dd></div>
        {generated && <div><dt>Generated</dt><dd>{generated.replace(/^Generated /, "").replace(/\.$/, "")}</dd></div>}
      </dl>
    </header>
    <section className="care-record-print-note">{notes.map((line, index) => <p key={index}>{line}</p>)}</section>
    {topics.length > 0 && <section className="care-record-print-section">
      <h2>Calls by topic</h2>
      {group(topics).map((topic) => <div className="care-record-print-topic" key={topic.name}>
        <h3>{topic.name}</h3>
        <div>{topic.lines.map((line, index) => <p key={index}>{line}</p>)}</div>
      </div>)}
    </section>}
    {comparisons.length > 0 && <section className="care-record-print-section">
      <h2>Earlier and recent calls</h2>
      {comparisons.map((line, index) => <p key={index}>{line}</p>)}
    </section>}
    <footer className="care-record-print-foot"><p>Recall call record · {name}</p></footer>
  </article>, document.body);
}

/** Blank-line-separated blocks of the exported text, each without its empty lines. */
function blocks(text: string): string[][] {
  const out: string[][] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) { if (out.at(-1)?.length) out.push([]); continue; }
    (out.at(-1) ?? (out[out.push([]) - 1] as string[])).push(line);
  }
  return out.filter((block) => block.length);
}

/**
 * Every record sentence opens with "{topic} - ", so the topic name can carry a row of its own and
 * each sentence keeps only what it says about that topic. An indented line belongs to the row above.
 */
function group(lines: string[]): Array<{ name: string; lines: string[] }> {
  const topics: Array<{ name: string; lines: string[] }> = [];
  for (const raw of lines) {
    const text = raw.trim();
    const name = raw.startsWith("  ") ? null : text.split(" - ")[0]!;
    const last = topics.at(-1);
    if (name && name !== last?.name) topics.push({ name, lines: [withoutTopic(text, name)] });
    else if (last) last.lines.push(name ? withoutTopic(text, name) : text);
  }
  return topics;
}
