"use client";

/**
 * /present will become the autoplay judged route (AGENTS.md section 9).
 *
 * For now it is an engine check, not a design: it forwards the ask and runs
 * the session in the browser - in-memory graph and bridge, WebCrypto hashing,
 * no backend and no network - then prints the three view models the panes
 * will render. None of this markup is meant to survive; the panes replace it.
 */
import { useEffect, useState } from "react";
import { runJudgedPath } from "@/fixtures/harness";
import type { SessionRecording } from "@/lib/session/recording";
import { intakeView, liveSessionView, receiptView } from "@/lib/session/view";
import { replay, visitedStates } from "@/lib/state/reducer";

export default function Present() {
  const [recording, setRecording] = useState<SessionRecording | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    runJudgedPath()
      .then((run) => !cancelled && setRecording(run.recording))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const intake = recording && intakeView(recording);
  const live = recording && liveSessionView(recording);
  const receipt = recording && receiptView(recording);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold">Judged-path engine check</h1>
      <p className="mt-2">Scaffold, not the demo. Runs entirely in this tab on placeholder media.</p>

      {error && <p role="alert" className="mt-6">The run failed: {error}</p>}
      {!recording && !error && <p className="mt-6">Running…</p>}

      {recording && intake && live && receipt && (
        <div className="mt-8 space-y-8" data-testid="engine-result" data-final-state={recording.final_state}>
          <section>
            <h2 className="text-lg font-semibold">Request intake</h2>
            <p className="mt-2">&ldquo;{intake.ask?.text}&rdquo; &mdash; {intake.ask?.asker.name}, {intake.ask?.photos.length} photo</p>
            <ul className="mt-2 list-disc pl-6">
              {intake.gates.map((g) => (
                <li key={g.gate}>
                  {g.label}: <span className="font-mono text-sm">{g.status}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="text-lg font-semibold">Live session</h2>
            <p className="mt-2 font-mono text-sm">{visitedStates(replay(recording.trace)).join(" → ")}</p>
            <ol className="mt-3 list-decimal pl-6">
              {recording.spoken.map((line) => (
                <li key={line.prompt_id}>{line.text}</li>
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
            <h2 className="text-lg font-semibold">Receipt and provenance</h2>
            {receipt.delivered && <p className="mt-2">&ldquo;{receipt.delivered.card.literal_transcript}&rdquo;</p>}
            {receipt.provenance && (
              <ul className="mt-2 list-disc pl-6 font-mono text-sm">
                <li>silence trims: {receipt.provenance.edits.silence_trims}</li>
                <li>generated first-person words: {receipt.provenance.edits.generated_first_person_words}</li>
                <li>her words: {receipt.provenance.her_words_pct}%</li>
                <li>delivered to: {receipt.provenance.delivered_to.join(", ")}</li>
                <li>support receipt sent to: {receipt.support_receipt_sent_to.join(", ")}</li>
              </ul>
            )}
            {receipt.provenance && <p className="mt-4">{receipt.provenance.final_line}</p>}
          </section>
        </div>
      )}
    </main>
  );
}
