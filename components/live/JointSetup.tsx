"use client";
import Link from "next/link";
import "@/app/onboarding-live.css";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { api } from "@/client/api";
import { useLive } from "./LiveProvider";
import { PhoneField } from "./PhoneField";
import { isCompletePhone } from "@/lib/phone/format";
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
    const id = session?.managed_household_id || new URLSearchParams(window.location.search).get("household") || session?.household_id;
    if (!id) { setLoaded(true); return; }
    setHousehold(id); setPending(true);
    const controller = new AbortController();
    api<Status>(`/api/onboarding/households/${encodeURIComponent(id)}`, { signal: controller.signal }).then((status) => {
      const her = status.people.find((p) => p.role === "participant" && !p.removed_at), carer = status.people.find((p) => p.role === "caregiver" && !p.removed_at && (session?.principal?.role !== "family" || p.person_id === session.principal.member_id));
      if (!her || !carer) throw new Error("This household needs a participant and caregiver.");
      setParticipant(her.display_name); setCaregiver(carer.display_name); setIds({ participant: her.person_id, caregiver: carer.person_id });
      const p = status.setup?.document;
      if (p) setDraft({ ...initial, days: p.call_windows[0]?.days ?? [], start: p.call_windows[0]?.start ?? "09:00", end: p.call_windows[0]?.end ?? "12:00", timezone: p.timezone, max_minutes: p.speech.max_call_minutes, pace: p.speech.pace, max_calls_per_week: p.call_frequency.max_calls_per_week, min_hours_between_calls: p.call_frequency.min_hours_between_calls, emergency_number: p.safety.emergency_number, saved_contact_name: p.attestations.saved_contact_name, number_saved: p.attestations.number_saved_in_her_phone, photo_saved: p.attestations.saved_contact_photo, introduced: p.attestations.recall_introduced_to_her, dashboard: p.dashboard.grants.find((g) => g.member_id === carer.person_id && g.revoked_at === null)?.detail_level ?? "none", expected_version: status.setup!.version });
      setLoaded(true);
    }).catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Setup could not be loaded."); }).finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => controller.abort();
  }, [session?.household_id, session?.managed_household_id, session?.principal?.role, session?.principal?.member_id]);
  async function save(e: FormEvent) {
    e.preventDefault(); if (pending) return;
    setError("");
    if (step === 0 && (!participant.trim() || !caregiver.trim())) { setError("Enter both names to continue."); return; }
    if (step === 0 && !ids && !isCompletePhone(phone)) { setError("Enter a complete phone number."); return; }
    if (step === 1 && (draft.days.length === 0 || draft.end <= draft.start)) { setError(draft.days.length === 0 ? "Choose at least one day for calls." : "Choose an end time after the start time."); return; }
    if (step < 3) { setStep(step + 1); return; }
    setPending(true); setError("");
    try {
      let hid = household, people = ids;
      if (!hid) {
        const made = await api<{ household: { household_id: string }; participant_id: string; caregiver_id: string }>(session?.principal?.role === "operator" ? "/api/onboarding/households" : "/api/onboarding/start", { method: "POST", body: JSON.stringify({ participant: { display_name: participant, phone }, caregiver: { display_name: caregiver } }) });
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
  if (!loaded) return <div className="live-setup"><p role="status">{pending ? "Opening your setup…" : "Your setup could not be opened."}</p>{error && <p role="alert" className="setup-error">{error}</p>}</div>;
  const headings = ["Set up Recall together.", "Choose a time to talk.", "Privacy, chosen together.", "Review your choices."];
  const dayNames = days.filter(([key]) => draft.days.includes(key)).map(([, label]) => label).join(", ");
  return <div className="recall-onboarding live-setup">
    <Link className="setup-back" href={household ? "/caregiver" : "/"}><ArrowLeft size={18} aria-hidden="true" />{household ? "Caregiver view" : "Home"}</Link>
    {!finished && <ol className="live-setup-steps" aria-label={`Step ${step + 1} of 4`}>{["People", "Calls", "Privacy", "Review"].map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined}><span aria-hidden="true">{index + 1}</span>{label}</li>)}</ol>}
    <h1 ref={title} tabIndex={-1}>{finished ? "Your choices are saved." : headings[step]}</h1>
    {!finished && <form onSubmit={save} aria-busy={pending}>
      {step === 0 && <>
        <p className="setup-intro">Start with the person who will receive calls and the caregiver beside them.</p>
        <fieldset className="live-setup-fields" disabled={pending}><legend className="sr-only">The people setting up Recall</legend>
          <label>Their name<input autoComplete="off" value={participant} disabled={!!ids} onChange={(e) => { setParticipant(e.target.value); setDraft((d) => ({ ...d, patient_agreed: false, caregiver_agreed: false })); }} maxLength={80} required /></label>
          {!ids && <>
            <PhoneField value={phone} required disabled={pending} describedBy="setup-phone-help" onChange={(next) => { setPhone(next); setDraft((d) => ({ ...d, patient_agreed: false, caregiver_agreed: false })); }} />
            <span id="setup-phone-help" className="live-setup-hint">This number belongs to the person who will receive Recall’s calls, not the caregiver.</span>
          </>}
          <label>Your name<input autoComplete="name" value={caregiver} disabled={!!ids} onChange={(e) => { setCaregiver(e.target.value); setDraft((d) => ({ ...d, patient_agreed: false, caregiver_agreed: false })); }} maxLength={80} required /></label>
        </fieldset>
        <p className="live-setup-hint">You can invite more family members after setup.</p>
      </>}
      {step === 1 && <>
        <p className="setup-intro">Choose a window that feels comfortable for {participant || "the person receiving calls"}.</p>
        <fieldset className="live-setup-section" disabled={pending}><legend>Days for calls</legend>
          <div className="live-setup-days">{days.map(([key, label]) => <label className="live-setup-check" key={key}><input type="checkbox" checked={draft.days.includes(key)} onChange={(e) => patch("days", e.target.checked ? [...draft.days, key] : draft.days.filter((day) => day !== key))} />{label}</label>)}</div>
        </fieldset>
        <fieldset className="live-setup-fields live-setup-section" disabled={pending}><legend>Time of day</legend>
          <div className="live-setup-pair"><label>From<input type="time" value={draft.start} onChange={(e) => patch("start", e.target.value)} required /></label><label>Until<input type="time" value={draft.end} onChange={(e) => patch("end", e.target.value)} required /></label></div>
          <label>Time zone<input value={draft.timezone} onChange={(e) => patch("timezone", e.target.value)} required autoComplete="off" aria-describedby="setup-timezone-help" /><span id="setup-timezone-help" className="live-setup-hint">Use the person’s local time zone, such as America/New_York.</span></label>
        </fieldset>
        <details className="live-setup-disclosure"><summary>Call length and pace</summary><div className="live-setup-fields">
          <p className="live-setup-hint">Up to {draft.max_calls_per_week} calls a week, at least {draft.min_hours_between_calls} hours apart. Each call lasts at most {draft.max_minutes} minutes.</p>
          <label>Maximum calls per week<input type="number" min={1} max={7} required value={draft.max_calls_per_week} onChange={(e) => patch("max_calls_per_week", Number(e.target.value))} /></label>
          <label>Hours between calls<input type="number" min={24} required value={draft.min_hours_between_calls} onChange={(e) => patch("min_hours_between_calls", Number(e.target.value))} /></label>
          <label>Maximum minutes per call<input type="number" min={1} max={10} required value={draft.max_minutes} onChange={(e) => patch("max_minutes", Number(e.target.value))} /></label>
          <label>Speech pace<select value={draft.pace} onChange={(e) => patch("pace", e.target.value as Draft["pace"])}><option value="standard">Standard</option><option value="slow">Slow</option></select></label>
        </div></details>
        <p className="live-setup-hint">Calls stay paused until you approve conversation topics and turn them on together.</p>
      </>}
      {step === 2 && <>
        <p className="setup-intro">Decide what {caregiver || "the caregiver"} can see. These choices can be changed later.</p>
        <fieldset className="live-setup-fields live-setup-section" disabled={pending}><legend>Family view</legend>
          <label>What may {caregiver || "the caregiver"} see?<select value={draft.dashboard} onChange={(e) => patch("dashboard", e.target.value as Draft["dashboard"])}><option value="none">No family view</option><option value="weekly_note">Weekly Note only</option><option value="weekly_note_and_record">Weekly Note and call counts by topic</option></select></label>
          <p className="live-setup-hint">The record describes what happened in calls. It does not rate the person.</p>
          {draft.expected_version > 0 && draft.dashboard !== "none" && <button type="button" className="setup-text-button" disabled={pending} onClick={() => void revokeAccess()}>Remove family-view access now</button>}
        </fieldset>
        <fieldset className="live-setup-fields live-setup-section" disabled={pending}><legend>If help is needed</legend>
          <p>{caregiver || "The caregiver"} is the designated caregiver. Recall can pass a safety notice to them. It is not an emergency service.</p>
          <label>Local emergency number<input inputMode="tel" value={draft.emergency_number} onChange={(e) => patch("emergency_number", e.target.value)} maxLength={20} required disabled={draft.expected_version > 0} /><span className="live-setup-hint">The emergency number where {participant || "the person receiving calls"} lives.</span></label>
        </fieldset>
        <fieldset className="live-setup-section" disabled={pending}><legend>Introduce Recall</legend>
          <p>Let {participant || "the person receiving calls"} know Recall is a computer assistant, and that they can end a call at any time.</p>
          <label className="live-setup-check"><input type="checkbox" checked={draft.introduced} onChange={(e) => patch("introduced", e.target.checked)} />{caregiver || "The caregiver"} has introduced Recall as an AI assistant.</label>
          <details className="live-setup-disclosure"><summary>For telephone calls</summary><div className="live-setup-fields">
            <p className="live-setup-hint">These contact settings are optional for calls in the web app.</p>
            <label>Name shown for Recall calls<input value={draft.saved_contact_name} onChange={(e) => patch("saved_contact_name", e.target.value)} maxLength={80} /></label>
            <label className="live-setup-check"><input type="checkbox" checked={draft.number_saved} onChange={(e) => patch("number_saved", e.target.checked)} />Recall’s number is saved in their phone.</label>
            <label className="live-setup-check"><input type="checkbox" checked={draft.photo_saved} onChange={(e) => patch("photo_saved", e.target.checked)} />A familiar photo is saved with the contact.</label>
          </div></details>
        </fieldset>
      </>}
      {step === 3 && <>
        <p className="setup-intro">Read these choices together before saving.</p>
        <dl className="live-setup-summary">
          <div><dt>Receiving calls</dt><dd>{participant}</dd></div><div><dt>Setting up together</dt><dd>{caregiver}</dd></div>
          <div><dt>Call window</dt><dd>{dayNames}<br />{draft.start}–{draft.end}<br />{draft.timezone.replaceAll("_", " ")}</dd></div>
          <div><dt>Call length and pace</dt><dd>Up to {draft.max_minutes} minutes · {draft.pace === "slow" ? "Slow" : "Standard"} pace<br />At most {draft.max_calls_per_week} a week, {draft.min_hours_between_calls} hours apart</dd></div>
          <div><dt>Family view</dt><dd>{draft.dashboard === "none" ? "Not enabled" : draft.dashboard === "weekly_note" ? "Weekly Note only" : "Weekly Note and call counts by topic"}</dd></div>
          <div><dt>Caregiver handoff</dt><dd>{caregiver}<br />Local emergency number: {draft.emergency_number}</dd></div>
          <div><dt>Introduction</dt><dd>{draft.introduced ? "Recall has been introduced as an AI assistant." : "Still to do before calls begin."}</dd></div>
        </dl>
        <p className="live-setup-hint">Calls will stay paused. Next, you can add and approve a conversation topic.</p>
        <div className="live-setup-agreements">
          <label className="live-setup-check"><input type="checkbox" checked={draft.patient_agreed} onChange={(e) => setDraft({ ...draft, patient_agreed: e.target.checked })} required /><span>{participant || "The person receiving calls"} agrees to these choices.</span></label>
          <label className="live-setup-check"><input type="checkbox" checked={draft.caregiver_agreed} onChange={(e) => setDraft({ ...draft, caregiver_agreed: e.target.checked })} required /><span>{caregiver || "The caregiver"} agrees to these choices.</span></label>
        </div>
      </>}
      {statusMessage && <p role="status" className="live-setup-status">{statusMessage}</p>}
      {error && <p role="alert" className="setup-error">{error}</p>}
      <footer className="setup-actions">{step > 0 && <button type="button" className="recall-button recall-secondary" disabled={pending} onClick={() => { setError(""); setStep(step - 1); }}><ArrowLeft aria-hidden="true" />Back</button>}<button className="recall-button recall-primary" disabled={pending}>{pending ? "Saving…" : step === 3 ? "Save choices" : "Continue"}<ArrowRight aria-hidden="true" /></button></footer>
    </form>}
    {finished && <div className="setup-complete"><p>You’re signed in on this browser. Calls are paused. Add a familiar topic, then review it together before turning on calls.</p><Link className="recall-button recall-primary" href="/onboarding/manage">Add a conversation topic<ArrowRight aria-hidden="true" /></Link><Link className="setup-text-button" href={`/caregiver?member=${encodeURIComponent(ids?.caregiver ?? "")}`}>Open caregiver view</Link><button className="setup-text-button" onClick={() => { setFinished(false); setStep(3); }}>Review your choices</button></div>}
  </div>;
}
