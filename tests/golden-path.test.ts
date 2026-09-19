/** AGENTS.md section 12, test 1: the golden path, exactly as section 4 fixes it, run with the network disabled. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runJudgedPath, type FixtureRun } from "@/fixtures/harness";
import { THESIS_LINE } from "@/lib/provenance/receipt";
import { liveSessionView, receiptView, gatesView } from "@/lib/session/view";
import { replay, visitedStates } from "@/lib/state/reducer";
import { ENFORCED_SEQUENCE } from "@/lib/tools";
import { HER_LINE, SAID } from "./helpers";

let run: FixtureRun;
const fetchSpy = vi.fn(() => Promise.reject(new Error("the judged path must not touch the network")));

beforeAll(async () => {
  vi.stubGlobal("fetch", fetchSpy);
  run = await runJudgedPath();
});
afterAll(() => vi.unstubAllGlobals());

describe("the 90-second golden path", () => {
  it("walks idle -> stored, one rung at a time, and stops climbing the moment she reaches it", () => {
    const r = run.recording;
    expect(r.final_state).toBe("stored");
    expect(visitedStates(replay(r.trace))).toEqual(["idle", "scheduled", "policy_passed", "connected", "topic_selected", "asking", "lost", "reanchored", "lost", "reanchored", "recalled", "confirming", "confirmed", "stored"]);
    expect(replay(r.trace).context.rungs_fired).toEqual([1, 2, 3]); // recognition and reorientation never fire
    expect(replay(r.trace).context.reached_at_rung).toBe(3);
  });

  it("says exactly the lines section 4 fixes, in order, and the first one says what Recall is", () => {
    expect(run.recording.spoken.map((s) => s.text)).toEqual([SAID.greeting, SAID.rung1, SAID.rung2, SAID.rung3, SAID.elaborate, SAID.storeQuestion, SAID.shareQuestion, SAID.closeWarm]);
    expect(SAID.greeting).toBe("Hi Susan, I'm Recall, an AI assistant Maya set up to keep you company.");
    expect(SAID.rung1).toBe("I'd love to hear about the summers at Cape May. What comes to mind?");
    expect(SAID.rung3).toBe("You and Maya used to go there together.");
  });

  it("logs free recall as a genuine miss before any cue is given", () => {
    const assessed = run.recording.tool_log.filter((c) => c.tool === "assess_conversation_state").map((c) => (c.output as { state: string; evidence: { matched_rule: string } }));
    expect(assessed.map((a) => a.state)).toEqual(["no_answer", "no_answer", "recalled", "new_detail_offered"]);
    expect(assessed[0]!.evidence.matched_rule).toBe("echo_of_recall_words"); // "Cape May...?"
    expect(assessed[2]!.evidence.matched_rule).toBe("named_something_recall_had_not_said"); // "Maya, my daughter!"
  });

  it("every transition emits exactly one trace event, and tool-caused ones carry their tool-call id", () => {
    const { trace, tool_log } = run.recording;
    expect(trace.every((t) => t.accepted)).toBe(true);
    expect(trace.map((t) => t.seq)).toEqual(trace.map((_, i) => i + 1));
    for (const t of trace.filter((t) => t.tool_call_seq !== null)) expect(tool_log[t.tool_call_seq! - 1]).toBeDefined();
    const byEvent = (e: string): string | undefined => tool_log[(trace.find((t) => t.event === e)!.tool_call_seq ?? 0) - 1]?.tool;
    expect(byEvent("POLICY_GRANTED")).toBe("place_recall_call");
    expect(byEvent("CONTRIBUTION_CAPTURED")).toBe("capture_contribution");
    expect(byEvent("CONTRIBUTION_STORED")).toBe("confirm_and_store");
  });

  it("runs the tools in the enforced order, with the safety check ahead of every turn of hers", () => {
    const tools = run.recording.tool_log.map((c) => c.tool);
    // Dependency order. (Recall renders its opening and its closing lines BEFORE the call, so that ending a call
    // kindly never depends on a tool responding - which is why render_prompt first appears ahead of the listening tools.)
    const first = (t: string): number => tools.indexOf(t as never);
    const last = (t: string): number => tools.lastIndexOf(t as never);
    const chain = ["get_next_recall_topic", "place_recall_call", "query_context_graph", "verify_claim_support", "render_prompt"];
    expect(chain.map(first)).toEqual([...chain.map(first)].sort((a, b) => a - b));
    expect(first("assess_conversation_state")).toBeLessThan(first("capture_contribution"));
    expect(first("capture_contribution")).toBeLessThan(first("confirm_and_store"));
    expect(first("confirm_and_store")).toBeLessThan(first("confirm_share")); // the store question, then the share question
    expect(first("confirm_share")).toBeLessThan(last("confirm_and_store")); // and only then - last - the commit
    expect(last("confirm_and_store")).toBeLessThan(first("record_retrieval_outcome"));
    expect(last("build_caregiver_receipt")).toBe(tools.length - 1);
    expect(new Set(tools).size).toBe(ENFORCED_SEQUENCE.length - 1); // every call tool but the safety alert
    // Each assessment and each confirmation is directly preceded by a safety check on the same turn.
    tools.forEach((t, i) => {
      const hearsHer = t === "assess_conversation_state" || t === "confirm_share" || (t === "confirm_and_store" && (run.recording.tool_log[i]!.input as { step: string }).step === "confirm");
      if (hearsHer) expect(tools[i - 1]).toBe("check_safety_phrases");
    });
    expect(tools.filter((t) => t === "send_safety_alert")).toEqual([]);
  });

  it("stores her exact words, with both confirmations, and nothing else of hers", async () => {
    const p = run.recording.provenance_receipt!;
    expect(p.literal_transcript).toBe(HER_LINE);
    expect(p.edits).toEqual({ silence_trims: 2, disfluency_trims: 0, generated_first_person_words: 0 });
    expect(p.store_confirmation.recorded_at < p.share_confirmation.recorded_at).toBe(true);
    expect(p.share_confirmation.decision).toBe("yes");
    expect(p.retrieval_updates).toEqual([{ topic_label: "Cape May summers", cue_id: "person:maya", rung: 3, effective: true }]);
    expect(p.final_line).toBe(THESIS_LINE);

    const claim = await run.graph.getNode(p.claim_id);
    expect(claim).toMatchObject({ type: "EpisodicClaim", props: { text: HER_LINE }, prov: { author: "person:susan", status: "participant_confirmed", patient_confirmed: true, source_class: "recall_call" } });
    // "a new edge from Cape May to the summers-together claim, sourced to this call"
    const about = (await run.graph.edgesOf(p.claim_id)).filter((e) => e.type === "ABOUT").map((e) => e.to);
    expect(about.sort()).toEqual(["event:cape-may-summers", "place:cape-may"]);
  });

  it("then: the redirect, the Weekly Note, the record, and the receipt, exactly as the dashboard beat shows them", async () => {
    const ask = await run.service.askAboutHer("What did Mom say about her wedding?", "person:maya");
    expect(ask.line.text).toBe("Susan's talked about this before. Want to give her a call?");
    expect(ask.graph_content).toEqual([]);

    const note = await run.service.weeklyNote("person:maya");
    expect(note.note!.lines.slice(0, 2).map((l) => [l.kind, l.text])).toEqual([
      ["warm", "Recall talked with Susan about the summers at Cape May this week. Want to give her a call?"],
      ["share", HER_LINE],
    ]);
    expect(note.note!.lines[1]!.attribution).toMatchObject({ speaker_name: "Susan", content_hash: run.recording.provenance_receipt!.content_hash });

    const record = await run.service.topicRecord("person:maya");
    expect(record.header!.text).toBe("This is a record of what happened in Recall calls, not a measure of Susan's memory overall. Practice on a topic, call quality, and time of day all affect it.");
    expect(record.topics.find((t) => t.topic_name === "Cape May summers")!.lines[0]!.text).toBe("Cape May summers - recalled unaided in 6 of 8 recent calls.");
    expect(run.recording.caregiver_receipt!.lines.map((l) => l.text)).toEqual(["Cape May summers - recalled after one contextual cue (Maya) in this call.", "No correction, no distress."]);
  });

  it("drives the panes from the same trace: gates, one cue card at a time, and the contribution card", () => {
    expect(gatesView(run.recording).map((g) => g.status)).toEqual(["passed", "passed", "passed", "passed"]);
    const rungThree = run.recording.spoken.find((s) => s.rung === 3)!;
    expect(liveSessionView(run.recording, rungThree.at).cue).toMatchObject({ rung: 3, text: SAID.rung3 });
    expect(liveSessionView(run.recording).cue).toBeNull(); // the stage clears when the call ends
    expect(receiptView(run.recording).contribution!.provenance_rows).toEqual(["Source: live call", "Edited: 2 pauses trimmed, 0 words generated", "Confirmed by her voice", "Share confirmed by her voice"]);
  });

  it("never touched the network, and sent nothing to anyone", () => {
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(run.alerts.count()).toBe(0);
  });
});
