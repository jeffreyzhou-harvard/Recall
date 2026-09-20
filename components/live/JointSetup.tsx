"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { api } from "@/client/api";
import { useLive } from "./LiveProvider";
import type { SetupVersion } from "@/lib/onboarding/types";
import type { Preferences } from "@/lib/onboarding/form";
type Status = { people: Array<{ person_id: string; display_name: string; role: string; removed_at: string | null }>; setup: SetupVersion | null; reconfirmation_due: boolean };
type Draft = Omit<Preferences, "patient_agreed" | "caregiver_agreed"> & { patient_agreed: boolean; caregiver_agreed: boolean };
const initial: Draft = { days: ["mon", "wed", "fri"], start: "09:00", end: "12:00", timezone: "America/New_York", max_minutes: 8, max_calls_per_week: 3, min_hours_between_calls: 24, pace: "standard", emergency_number: "", saved_contact_name: "", number_saved: false, photo_saved: false, introduced: false, dashboard: "none", patient_agreed: false, caregiver_agreed: false, expected_version: 0 };
const days = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]] as const;
export function JointSetup() {
  const { session, refreshSession, setMember } = useLive();
  const [step, setStep] = useState(0), [draft, setDraft] = useState<Draft>(initial), [household, setHousehold] = useState("");
  const [participant, setParticipant] = useState(""), [caregiver, setCaregiver] = useState(""), [phone, setPhone] = useState("");
  const [ids, setIds] = useState<{ participant: string; caregiver: string } | null>(null), [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [finished, setFinished] = useState(false), [statusMessage, setStatusMessage] = useState("");
  const title = useRef<HTMLHeadingElement>(null);
  const patch = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value, patient_agreed: key === "patient_agreed" ? value as boolean : false, caregiver_agreed: key === "caregiver_agreed" ? value as boolean : key === "patient_agreed" ? d.caregiver_agreed : false }));
  useEffect(() => { title.current?.focus(); }, [step, finished]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("household") || session?.household_id;
    if (!id) { setLoaded(true); return; }
    setHousehold(id); setPending(true);
    const controller = new AbortController();
    api<Status>(`/api/onboarding/households/${encodeURIComponent(id)}`, { signal: controller.signal }).then((status) => {
      const her = status.people.find((p) => p.role === "participant" && !p.removed_at), carer = status.people.find((p) => p.role === "caregiver" && !p.removed_at);
      if (!her || !carer) throw new Error("This household needs a participant and caregiver.");
      setParticipant(her.display_name); setCaregiver(carer.display_name); setIds({ participant: her.person_id, caregiver: carer.person_id });
      const p = status.setup?.document;
      if (p) setDraft({ ...initial, days: p.call_windows[0]?.days ?? [], start: p.call_windows[0]?.start ?? "09:00", end: p.call_windows[0]?.end ?? "12:00", timezone: p.timezone, max_minutes: p.speech.max_call_minutes, pace: p.speech.pace, max_calls_per_week: p.call_frequency.max_calls_per_week, min_hours_between_calls: p.call_frequency.min_hours_between_calls, emergency_number: p.safety.emergency_number, saved_contact_name: p.attestations.saved_contact_name, number_saved: p.attestations.number_saved_in_her_phone, photo_saved: p.attestations.saved_contact_photo, introduced: p.attestations.recall_introduced_to_her, dashboard: p.dashboard.grants.find((g) => g.member_id === carer.person_id && g.revoked_at === null)?.detail_level ?? "none", expected_version: status.setup!.version });
      setLoaded(true);
    }).catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Setup could not be loaded."); }).finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => controller.abort();
  }, [session?.household_id]);
  async function save(e: FormEvent) {
    e.preventDefault(); if (pending) return;
    if (step < 3) { setStep(step + 1); return; }
    setPending(true); setError("");
    try {
      let hid = household, people = ids;
      if (!hid) {
        const made = await api<{ household: { household_id: string }; participant_id: string; caregiver_id: string }>("/api/onboarding/households", { method: "POST", body: JSON.stringify({ participant: { display_name: participant, phone }, caregiver: { display_name: caregiver } }) });
        hid = made.household.household_id; people = { participant: made.participant_id, caregiver: made.caregiver_id };
        setHousehold(hid); setIds(people); setPhone(""); window.history.replaceState(null, "", `/onboarding?household=${encodeURIComponent(hid)}`);
      }
      const saved = await api<SetupVersion>(`/api/onboarding/households/${encodeURIComponent(hid)}/preferences`, { method: "POST", body: JSON.stringify(draft) });
      setDraft((d) => ({ ...d, expected_version: saved.version, patient_agreed: false, caregiver_agreed: false }));
      await api("/api/onboarding/activate", { method: "POST", body: JSON.stringify({ household_id: hid }) });
      if (people) setMember(people.caregiver);
      setFinished(true); await refreshSession();
    } catch (e) { setError(e instanceof Error ? e.message : "Your setup could not be saved."); }
    finally { setPending(false); }
  }
  async function revokeAccess() {
    if (!household || !ids || pending) return;
    setPending(true); setError(""); setStatusMessage("");
    try {
      const current = await api<Status>(`/api/onboarding/households/${encodeURIComponent(household)}`);
      if (!current.setup) throw new Error("Save the initial setup first.");
      const document = current.setup.document;
      document.dashboard.grants = document.dashboard.grants.map((grant) => grant.member_id === ids.caregiver && grant.revoked_at === null ? { ...grant, revoked_at: new Date().toISOString() } : grant);
      const saved = await api<SetupVersion>(`/api/onboarding/households/${encodeURIComponent(household)}/setup`, { method: "POST", body: JSON.stringify({ kind: "tightening", document, by: ids.caregiver }) });
      setDraft((d) => ({ ...d, dashboard: "none", expected_version: saved.version, patient_agreed: false, caregiver_agreed: false }));
      setStatusMessage("Family-view access has been revoked.");
    } catch (e) { setError(e instanceof Error ? e.message : "Access could not be changed."); }
    finally { setPending(false); }
  }
  if (!loaded) return <><p role="status">{pending ? "Loading joint setup…" : "Setup could not be opened."}</p>{error && <p role="alert" className="setup-error">{error}</p>}</>;
  return <div className="recall-onboarding">
    <Link className="setup-back" href="/caregiver"><ArrowLeft size={18} />Caregiver view</Link>
    {!finished && <ol className="setup-steps" aria-label="Setup steps">{["People", "Calls", "Family view", "Review"].map((label, index) => <li key={label}><button disabled={pending} aria-current={step === index ? "step" : undefined} onClick={() => setStep(index)}><span>{index + 1}</span>{label}</button></li>)}</ol>}
    {household && <p><Link href="/onboarding/manage">Manage invitations, access keys, and topics</Link></p>}
    <h1 ref={title} tabIndex={-1}>{finished ? "Your joint setup is saved." : ["Bring her people closer.", "Make room for familiar moments.", "Choose what to share.", "Set this up together."][step]}</h1>
    {!finished && <form onSubmit={save}>
      {step === 0 && <><p className="setup-intro">Start with the person using Recall and the caregiver setting it up with them.</p><fieldset className="setup-person-form"><legend>The people setting up Recall</legend><label>Participant’s name<input value={participant} disabled={!!ids} onChange={(e) => setParticipant(e.target.value)} maxLength={80} required /></label>{!ids && <label>Participant’s phone number<input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+16095550123" pattern="\+[1-9][0-9]{6,14}" required /><span className="setup-hint">International format. This is the only phone number Recall keeps.</span></label>}<label>Caregiver’s name<input value={caregiver} disabled={!!ids} onChange={(e) => setCaregiver(e.target.value)} maxLength={80} required /></label></fieldset><p>Additional people can join through an approved invitation. Contact and calendar imports are not enabled.</p></>}
      {step === 1 && <><fieldset className="setup-call-window"><legend>When would {participant || "the participant"} like a call?</legend><div className="setup-days">{days.map(([key, label]) => <label key={key}><input type="checkbox" checked={draft.days.includes(key)} onChange={(e) => patch("days", e.target.checked ? [...draft.days, key] : draft.days.filter((day) => day !== key))} />{label}</label>)}</div><div className="setup-time-row"><label>From<input type="time" value={draft.start} onChange={(e) => patch("start", e.target.value)} required /></label><label>Until<input type="time" value={draft.end} onChange={(e) => patch("end", e.target.value)} required /></label></div><label>Time zone<input value={draft.timezone} onChange={(e) => patch("timezone", e.target.value)} required /></label><div className="setup-time-row"><label>Maximum calls per week<input type="number" min={1} max={7} value={draft.max_calls_per_week} onChange={(e) => patch("max_calls_per_week", Number(e.target.value))} /></label><label>Hours between calls<input type="number" min={24} value={draft.min_hours_between_calls} onChange={(e) => patch("min_hours_between_calls", Number(e.target.value))} /></label><label>Maximum minutes per call<input type="number" min={1} max={10} value={draft.max_minutes} onChange={(e) => patch("max_minutes", Number(e.target.value))} /></label></div><label>Speech pace<select value={draft.pace} onChange={(e) => patch("pace", e.target.value as Draft["pace"])}><option value="standard">Standard</option><option value="slow">Slow</option></select></label></fieldset><p>Calling remains paused. After saving, open People and conversation topics to approve topics and enable web calls.</p></>}
      {step === 2 && <><fieldset className="setup-permissions"><legend>Family access for {caregiver || "the caregiver"}</legend><p>Choose together. The caregiver can revoke access at any time.</p><label>What may this caregiver see?<select value={draft.dashboard} onChange={(e) => patch("dashboard", e.target.value as Draft["dashboard"])}><option value="none">No dashboard access</option><option value="weekly_note">Weekly Note only</option><option value="weekly_note_and_record">Weekly Note and per-topic record</option></select></label>{draft.expected_version > 0 && draft.dashboard !== "none" && <button type="button" className="care-text-action" disabled={pending} onClick={() => void revokeAccess()}>Revoke this caregiver’s family-view access</button>}</fieldset><fieldset className="setup-person-form"><legend>Caregiver handoff</legend><p>{caregiver || "The caregiver"} will be the designated caregiver. Handoffs currently appear only in their dashboard. Recall is not an emergency service.</p><label>Local emergency number<input value={draft.emergency_number} onChange={(e) => patch("emergency_number", e.target.value)} maxLength={20} required disabled={draft.expected_version > 0} /></label></fieldset><fieldset className="setup-permissions"><legend>Introduce Recall together</legend><label>Name shown for Recall calls<input value={draft.saved_contact_name} onChange={(e) => patch("saved_contact_name", e.target.value)} maxLength={80} /></label><label><input type="checkbox" checked={draft.number_saved} onChange={(e) => patch("number_saved", e.target.checked)} />For telephone use, Recall’s number is saved in the participant’s phone (optional for web calls).</label><label><input type="checkbox" checked={draft.photo_saved} onChange={(e) => patch("photo_saved", e.target.checked)} />For telephone use, a family-chosen photo is saved with the contact (optional for web calls).</label><label><input type="checkbox" checked={draft.introduced} onChange={(e) => patch("introduced", e.target.checked)} />The caregiver has introduced Recall as an AI assistant.</label></fieldset></>}
      {step === 3 && <><dl className="setup-summary"><div><dt>Participant</dt><dd>{participant}</dd></div><div><dt>Caregiver</dt><dd>{caregiver}</dd></div><div><dt>Calling preferences</dt><dd>{draft.days.join(", ")} · {draft.start}–{draft.end} · {draft.timezone}</dd></div><div><dt>Call length</dt><dd>At most {draft.max_minutes} minutes</dd></div><div><dt>Family access</dt><dd>{draft.dashboard === "none" ? "Not enabled" : draft.dashboard === "weekly_note" ? "Weekly Note" : "Weekly Note and per-topic record"}</dd></div></dl><p>Calls remain paused. No topics have been added or approved by this form. No audio or photos are uploaded.</p><label className="setup-agreement"><input type="checkbox" checked={draft.patient_agreed} onChange={(e) => setDraft({ ...draft, patient_agreed: e.target.checked })} required /><span>{participant || "The participant"} agrees to these choices.</span></label><label className="setup-agreement"><input type="checkbox" checked={draft.caregiver_agreed} onChange={(e) => setDraft({ ...draft, caregiver_agreed: e.target.checked })} required /><span>{caregiver || "The caregiver"} agrees to these choices.</span></label></>}
      <footer className="setup-actions">{step > 0 && <button type="button" className="recall-button recall-secondary" disabled={pending} onClick={() => setStep(step - 1)}><ArrowLeft />Back</button>}<button className="recall-button recall-primary" disabled={pending}>{pending ? "Saving…" : step === 3 ? "Save joint setup" : "Continue"}<ArrowRight /></button></footer>
    </form>}
    {statusMessage && <p role="status">{statusMessage}</p>}
    {error && <p role="alert" className="setup-error">{error}</p>}
    {finished && <div className="setup-complete"><p>Your choices are stored in Recall. Calls remain paused.</p><p>Caregiver member ID: <code>{ids?.caregiver}</code></p><Link className="recall-button recall-primary" href={`/caregiver?member=${encodeURIComponent(ids?.caregiver ?? "")}`}>Open caregiver view<ArrowRight /></Link><button className="setup-text-button" onClick={() => { setFinished(false); setStep(3); }}>Review setup</button></div>}
  </div>;
}
