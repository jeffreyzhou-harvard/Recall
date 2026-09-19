"use client";

/**
 * /present will become the autoplay judged route (AGENTS.md section 9).
 *
 * For now it is an engine check, not a design: it runs the golden recall call
 * and then the family side in the browser - in-memory graph, WebCrypto hashing,
 * no backend and no network - and prints what the panes will render. None of
 * this markup is meant to survive; the panes replace it.
 */
import { useEffect, useState } from "react";
import { runJudgedPath } from "@/fixtures/harness";
import type { SessionRecording } from "@/lib/session/recording";
import { gatesView, liveSessionView, receiptView } from "@/lib/session/view";
import { replay, visitedStates } from "@/lib/state/reducer";
import type { ToolOutput } from "@/lib/tools";

interface FamilySide {
  redirect: ToolOutput<"handle_family_query">;
  note: ToolOutput<"build_weekly_note">;
  record: ToolOutput<"get_topic_record">;
}

export default function Present() {
  const [recording, setRecording] = useState<SessionRecording | null>(null);
  const [family, setFamily] = useState<FamilySide | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const run = await runJudgedPath();
      const side: FamilySide = {
        redirect: await run.service.askAboutHer("What did Mom say about her wedding?", "person:maya"),
        note: await run.service.weeklyNote("person:maya"),
        record: await run.service.topicRecord("person:maya"),
      };
      if (cancelled) return;
      setRecording(run.recording);
      setFamily(side);
    })().catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const gates = recording && gatesView(recording);
  const live = recording && liveSessionView(recording);
  const receipt = recording && receiptView(recording);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold">Judged-path engine check</h1>
      <p className="mt-2">Scaffold, not the demo. Runs entirely in this tab on placeholder media.</p>

      {error && <p role="alert" className="mt-6">The run failed: {error}</p>}
      {!recording && !error && <p className="mt-6">Running…</p>}

      {recording && family && gates && live && receipt && (
        <div className="mt-8 space-y-8" data-testid="engine-result" data-final-state={recording.final_state}>
          <section>
            <h2 className="text-lg font-semibold">The call: {recording.topic?.label}</h2>
            <ul className="mt-2 list-disc pl-6">
              {gates.map((g) => (
                <li key={g.gate}>
                  {g.label}: <span className="font-mono text-sm">{g.status}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 font-mono text-sm">{visitedStates(replay(recording.trace)).join(" → ")}</p>
            <ol className="mt-3 list-decimal pl-6">
              {recording.spoken.map((line) => (
                <li key={line.prompt_id}>
                  {line.text}
                  {line.rung !== null && <span className="font-mono text-sm opacity-70"> (rung {line.rung})</span>}
                </li>
              ))}
            </ol>
            <ol className="mt-3 list-decimal pl-6 font-mono text-sm">
              {live.trace_cards.map((card) => (
                <li key={card.seq}>
                  {card.label}
                  {card.tool && <span className="opacity-70"> ({card.tool})</span>}
                </li>
              ))}
            </ol>
          </section>
          <section>
            <h2 className="text-lg font-semibold">The family side</h2>
            <p className="mt-2" data-testid="family-redirect">
              &ldquo;What did Mom say about her wedding?&rdquo; &rarr; {family.redirect.line.text}{" "}
              <span className="font-mono text-sm">(graph content shown: {family.redirect.graph_content.length})</span>
            </p>
            <ul className="mt-3 list-disc pl-6">
              {family.note.note?.lines.map((l) => (
                <li key={l.script_id}>
                  {l.kind === "share" ? <>&ldquo;{l.text}&rdquo; &mdash; {l.attribution?.speaker_name}</> : l.text}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm">{family.record.header?.text}</p>
            <ul className="mt-2 list-disc pl-6">
              {family.record.topics.flatMap((t) => t.lines).map((l) => (
                <li key={l.text}>{l.text}</li>
              ))}
              {family.record.change_lines.map((l) => (
                <li key={l.text}>{l.text}</li>
              ))}
            </ul>
            <ul className="mt-3 list-disc pl-6">
              {receipt.support?.lines.map((l) => (
                <li key={l.script_id}>{l.text}</li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="text-lg font-semibold">Receipt and provenance</h2>
            {receipt.contribution && <p className="mt-2">&ldquo;{receipt.contribution.literal_transcript}&rdquo;</p>}
            {receipt.provenance && (
              <ul className="mt-2 list-disc pl-6 font-mono text-sm">
                {receipt.contribution?.provenance_rows.map((row) => <li key={row}>{row}</li>)}
                <li>her words: {receipt.provenance.her_words_pct}%</li>
                <li>ladder rungs used: {receipt.provenance.rungs_used}</li>
                {receipt.provenance.retrieval_updates.map((u) => (
                  <li key={u.cue_id}>
                    {u.cue_id} logged as {u.effective ? "an effective" : "an ineffective"} cue for {u.topic_label}
                  </li>
                ))}
              </ul>
            )}
            {receipt.provenance && <p className="mt-4">{receipt.provenance.final_line}</p>}
          </section>
        </div>
      )}
    </main>
  );
}
