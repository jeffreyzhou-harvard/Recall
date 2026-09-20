"use client";
import Link from "next/link";
import { KnowledgeReview } from "./KnowledgeReview";
import { KnowledgeImport } from "./KnowledgeImport";
import { ArrowLeft, ArrowRight } from "lucide-react";
import "@/app/onboarding-live.css";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "@/client/api";
import { useLive } from "./LiveProvider";
import type { SetupVersion } from "@/lib/onboarding/types";
type Member = { person_id: string; display_name: string; role: string; removed_at: string | null };
type Choice = { id: string; approved: boolean; detail: "none" | "weekly_note" | "weekly_note_and_record" };
type Topic = { id: string; label: string; contributor_id: string };
export function HouseholdManager() {
  const { session } = useLive(), household = session?.household_id;
  const [people, setPeople] = useState<Member[]>([]), [setup, setSetup] = useState<SetupVersion | null>(null), [topics, setTopics] = useState<Topic[]>([]);
  const [diagnostics, setDiagnostics] = useState<{ web_configured: boolean; scheduler_enabled: boolean; issue: string | null } | null>(null);
  const [webEnabled, setWebEnabled] = useState(false), [channel, setChannel] = useState("dashboard");
  const [choices, setChoices] = useState<Choice[]>([]), [allowed, setAllowed] = useState<string[]>([]), [patientAgreed, setPatientAgreed] = useState(false), [caregiverAgreed, setCaregiverAgreed] = useState(false);
  const [name, setName] = useState(""), [role, setRole] = useState("family"), [label, setLabel] = useState(""), [story, setStory] = useState("");
  const [secret, setSecret] = useState(""), [secretLabel, setSecretLabel] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const base = `/api/onboarding/households/${encodeURIComponent(household ?? "")}`;
  const resetAgreement = () => { setPatientAgreed(false); setCaregiverAgreed(false); };
  const load = useCallback(async () => {
    if (!household) return;
    const [status, nextTopics, liveStatus] = await Promise.all([api<{ people: Member[]; setup: SetupVersion | null }>(base), api<Topic[]>("/api/onboarding/topics"), api<{ web_configured: boolean; scheduler_enabled: boolean; issue: string | null }>("/api/live/schedule")]);
    if (!status.setup) throw new Error("Complete joint setup before choosing people and topics.");
    setDiagnostics(liveStatus);
    setPeople(status.people.filter((p) => !p.removed_at)); setSetup(status.setup); setTopics(nextTopics);
    const doc = status.setup.document; setWebEnabled(!doc.calls_paused); setChannel(doc.safety.designated_caregivers[0]?.alert_channel ?? "dashboard");
    setChoices(status.people.filter((p) => !p.removed_at && p.role !== "participant").map((p) => ({ id: p.person_id, approved: doc.approved_people.includes(p.person_id), detail: doc.dashboard.grants.find((g) => g.member_id === p.person_id && !g.revoked_at)?.detail_level ?? "none" })));
    setAllowed(doc.topics.allow); resetAgreement();
  }, [base, household]);
  useEffect(() => { void load().catch(() => setError("Household choices could not be loaded.")); }, [load]);
  async function work(fn: () => Promise<void>) { if (busy) return; setBusy(true); setError(""); setMessage(""); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "The change could not be saved."); } finally { setBusy(false); } }
  if (!household) return <div className="live-setup"><h1>Start with joint setup.</h1><p>Choose who Recall is for and what they are comfortable sharing.</p><Link className="care-action" href="/onboarding">Set up Recall<ArrowRight size={18} aria-hidden="true" /></Link></div>;
  if (!setup) return <div className="live-setup"><p role={error ? "alert" : "status"}>{error || "Opening your choices…"}</p>{error && <Link className="setup-text-button" href="/onboarding">Return to joint setup</Link>}</div>;
  const caregiver = people.find((p) => p.person_id === setup.document.recall_set_up_by), patient = people.find((p) => p.role === "participant");
  return <section className="recall-onboarding live-setup live-manage">
    <Link className="setup-back" href="/onboarding"><ArrowLeft size={18} aria-hidden="true" />Joint setup</Link>
    <h1>Familiar things to talk about.</h1>
    <p className="setup-intro">Add a memory, then decide together what Recall can bring into a conversation.</p>
    {error && <p role="alert" className="setup-error">{error}</p>}{message && <p role="status" className="live-setup-status">{message}</p>}
    <form className="live-setup-fields live-setup-section" aria-busy={busy} onSubmit={(e) => { e.preventDefault(); void work(async () => { await api("/api/onboarding/topics", { method: "POST", body: JSON.stringify({ contributor_id: caregiver?.person_id, label, story }) }); setLabel(""); setStory(""); await load(); setMessage("Your memory is saved. Review the topic together below."); }); }}>
      <h2>Add a conversation topic</h2>
      <p className="live-setup-hint">From {caregiver?.display_name}. Recall will say who contributed it.</p>
      <label>Topic name<input required value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} aria-describedby="topic-name-help" /><span id="topic-name-help" className="live-setup-hint">A place, event, or familiar activity.</span></label>
      <label>Your memory<textarea required value={story} maxLength={2000} onChange={(e) => setStory(e.target.value)} rows={4} /></label>
      <button className="care-action" disabled={busy}>Save topic for review<ArrowRight size={18} aria-hidden="true" /></button>
    </form>
    {caregiver && <KnowledgeReview member={caregiver.person_id} refreshKey={message} />}
    {caregiver && <KnowledgeImport key={caregiver.person_id} contributor={caregiver} members={people.filter((p) => setup.document.approved_people.includes(p.person_id))} onSaved={load} />}
    <form className="live-setup-section" aria-busy={busy} onSubmit={(e) => { e.preventDefault(); void work(async () => { await api(`${base}/choices`, { method: "POST", body: JSON.stringify({ expected_version: setup.version, patient_agreed: patientAgreed, caregiver_agreed: caregiverAgreed, members: choices, topics: allowed, web_calls_enabled: webEnabled, alert_channel: channel }) }); await load(); setMessage("Your joint choices are saved."); }); }}>
      <h2>Review together</h2>
      <p>These choices need agreement from {patient?.display_name} and {caregiver?.display_name}.</p>
      <fieldset disabled={busy} className="live-setup-section"><legend>Topics for future calls</legend>
        {topics.length === 0 && <p className="live-setup-hint">Add a memory above. Its topic will appear here for review.</p>}
        {topics.map((t) => <label className="live-setup-check" key={t.id}><input type="checkbox" checked={allowed.includes(t.id)} disabled={!choices.some((m) => m.id === t.contributor_id && m.approved)} onChange={(e) => { resetAgreement(); setAllowed(e.target.checked ? [...allowed, t.id] : allowed.filter((id) => id !== t.id)); }} /><span>{t.label}<span className="live-setup-hint">From {people.find((p) => p.person_id === t.contributor_id)?.display_name || "a family contributor"}{!choices.some((m) => m.id === t.contributor_id && m.approved) ? " · approve this contributor below first" : ""}</span></span></label>)}
      </fieldset>
      <details className="live-setup-disclosure"><summary>People and family-view access</summary>
        <fieldset disabled={busy} className="live-setup-fields"><legend className="sr-only">Contributions and family view</legend>
          {choices.map((c) => <div className="live-member" key={c.id}>
            <label className="live-setup-check"><input type="checkbox" checked={c.approved} onChange={(e) => { resetAgreement(); setChoices(choices.map((m) => m.id === c.id ? { ...m, approved: e.target.checked, detail: e.target.checked ? m.detail : "none" } : m)); if (!e.target.checked) setAllowed(allowed.filter((id) => topics.find((t) => t.id === id)?.contributor_id !== c.id)); }} /><span>{people.find((p) => p.person_id === c.id)?.display_name} may contribute memories</span></label>
            <label>What may they see?<select disabled={!c.approved} value={c.detail} onChange={(e) => { resetAgreement(); setChoices(choices.map((m) => m.id === c.id ? { ...m, detail: e.target.value as Choice["detail"] } : m)); }}><option value="none">No family view</option><option value="weekly_note">Weekly Note only</option><option value="weekly_note_and_record">Weekly Note and call counts by topic</option></select></label>
          </div>)}
        </fieldset>
      </details>
      <fieldset disabled={busy} className="live-setup-section"><legend>Calls in the web app</legend>
        <label className="live-setup-check"><input type="checkbox" checked={webEnabled} onChange={(e) => { resetAgreement(); setWebEnabled(e.target.checked); }} />Allow calls during the times you chose</label>
        <p className="live-setup-hint">Keep the call page open on {patient?.display_name || "the participant"}’s device to receive a scheduled call.</p>
        {diagnostics && (!diagnostics.web_configured || !diagnostics.scheduler_enabled) && <p className="live-setup-hint">Web calling still needs to be connected by the person running Recall.</p>}
        <details className="live-setup-disclosure"><summary>Caregiver handoff and connection</summary><div className="live-setup-fields">
          <label>Where safety notices appear<select value={channel} onChange={(e) => { resetAgreement(); setChannel(e.target.value); }}><option value="dashboard">Caregiver dashboard</option><option value="webhook">Connected caregiver alert service</option></select></label>
          <p className="live-setup-hint">Recall is not an emergency service.</p>
          {diagnostics && <p className="live-setup-hint">Voice connection: {diagnostics.web_configured ? "configured" : "not configured"}. Scheduled calling: {diagnostics.scheduler_enabled ? "enabled" : "not enabled"}.</p>}
          {diagnostics?.issue && <p role="alert">{diagnostics.issue}</p>}
        </div></details>
      </fieldset>
      <div className="live-setup-agreements">
        <label className="live-setup-check"><input type="checkbox" required checked={patientAgreed} onChange={(e) => setPatientAgreed(e.target.checked)} />{patient?.display_name} agrees to these choices.</label>
        <label className="live-setup-check"><input type="checkbox" required checked={caregiverAgreed} onChange={(e) => setCaregiverAgreed(e.target.checked)} />{caregiver?.display_name} agrees to these choices.</label>
      </div>
      <button className="recall-button recall-primary live-setup-save" disabled={busy}>{busy ? "Saving…" : "Save joint choices"}<ArrowRight aria-hidden="true" /></button>
    </form>
    <details className="live-setup-disclosure"><summary>Invite a family member</summary>
      <form className="live-setup-fields" aria-busy={busy} onSubmit={(e: FormEvent) => { e.preventDefault(); void work(async () => { const r = await api<{ token: string }>(`${base}/invitations`, { method: "POST", body: JSON.stringify({ display_name: name, role, invited_by: caregiver?.person_id }) }); setSecret(r.token); setSecretLabel(`Invitation code for ${name}. Share it privately, along with ${window.location.origin}/join.`); setName(""); }); }}>
        <p>After they join, review their access together.</p>
        <label>Their name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></label>
        <label>Joining as<select value={role} onChange={(e) => setRole(e.target.value)}><option value="family">Family member</option><option value="caregiver">Caregiver</option></select></label>
        <button className="care-action" disabled={busy}>Create invitation</button>
        <button type="button" className="setup-text-button" disabled={busy} onClick={() => void work(async () => { await load(); setMessage("The list of people is up to date. Review their access above."); })}>Refresh people who have joined</button>
      </form>
    </details>
    <details className="live-setup-disclosure"><summary>Sign-in keys</summary>
      <p className="live-setup-hint">Give each person their own key. A replacement immediately stops their previous key from working.</p>
      {people.map((p) => <div className="live-member" key={p.person_id}>
        <h3>{p.display_name}</h3><p className="live-setup-hint">{p.role === "participant" ? "Call page access" : "Family access"}</p>
        <div className="live-member-actions"><button className="setup-text-button" disabled={busy} onClick={() => void work(async () => { const r = await api<{ key: string }>(`${base}/accounts`, { method: "POST", body: JSON.stringify({ member_id: p.person_id }) }); setSecret(r.key); setSecretLabel(`Access key for ${p.display_name}. Save it privately. Any previous key has stopped working.`); })}>Create or replace key</button><button className="setup-text-button" disabled={busy} onClick={() => void work(async () => { await api(`${base}/accounts`, { method: "DELETE", body: JSON.stringify({ member_id: p.person_id }) }); setMessage(`${p.display_name}’s sign-in key has been removed.`); setSecret(""); })}>Remove key</button></div>
      </div>)}
    </details>
    {secret && <section className="live-secret live-setup-fields"><h2>Save this code privately.</h2><p>{secretLabel}</p><textarea aria-label="One-time private code" readOnly value={secret} rows={3} autoComplete="off" spellCheck={false} /><button className="setup-text-button" onClick={() => setSecret("")}>I’ve saved it · hide code</button></section>}
    <Link className="setup-text-button" href="/caregiver">Open caregiver view<ArrowRight size={18} aria-hidden="true" /></Link>
  </section>;
}
