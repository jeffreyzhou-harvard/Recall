"use client";
import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import {
  ArrowRight,
  Bell,
  Check,
  Copy,
  Link2,
  Mail,
  Phone,
  Settings,
  UserPlus,
} from "lucide-react";
import { ArchiveDialog } from "@/components/archive/ArchiveDialog";
import { SignOut } from "@/components/live/AccessGate";
import { post, type CircleView } from "./types";
export function FamilyPanel({
  data,
  onClose,
  onChanged,
}: {
  data: CircleView;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<{
      url: string;
      sent: boolean;
      deliveryError: string;
      name: string;
    } | null>(null),
    [copied, setCopied] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [accountSaved, setAccountSaved] = useState(false);
  const resultPanel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (result)
      resultPanel.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
  }, [result]);
  const mine = data.people.find((p) => p.id === data.member)?.contact;
  async function invite(patient = false) {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(
        await post(patient ? "patient-link" : "invite", {
          name,
          phone,
          send: !!phone && !patient,
        }),
      );
      setName("");
      setPhone("");
      await onChanged();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Your invitation could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(result!.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Select the link below to copy it.");
    }
  }
  return (
    <ArchiveDialog title="Your family" drawer onClose={onClose} busy={busy}>
      <div className="circle-panel">
        <p className="circle-eyebrow">BETTER WITH EVERY VOICE</p>
        <h2>Your little circle.</h2>
        <p>Different photographs. Different stories. One place to keep them.</p>
        <div className="circle-family-list">
          {data.people.map((p, i) => (
            <div key={p.id}>
              <span className={`circle-avatar tone-${i % 4}`}>{p.name[0]}</span>
              <div>
                <strong>
                  {p.name}
                  {p.id === data.member ? " · you" : ""}
                </strong>
                <span>
                  {p.role === "participant"
                    ? "Their memories, in their words"
                    : p.role === "caregiver"
                      ? "Family organizer"
                      : "Family contributor"}
                </span>
              </div>
              {p.contact?.reminders === 1 && (
                <Bell size={17} aria-label="Photo invitations enabled" />
              )}
            </div>
          ))}
          {data.invitations.map((i, n) => (
            <div key={n}>
              <span className="circle-avatar pending">
                <Mail size={18} />
              </span>
              <div>
                <strong>{i.name}</strong>
                <span>Invitation ready · waiting to join</span>
              </div>
              <button
                className="circle-text-button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void post("cancel-invitation", { id: i.id })
                    .then(onChanged)
                    .catch((e) => setError(e.message))
                    .finally(() => setBusy(false));
                }}
              >
                Cancel
              </button>
            </div>
          ))}
        </div>
        {data.canManage && (
          <>
            <section className="circle-panel-section">
              <h3>A seat for someone else.</h3>
              <p>They tap one link and they’re in. No codes to copy.</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void invite();
                }}
              >
                <label>
                  Their name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Priya"
                    required
                    maxLength={80}
                    autoComplete="off"
                  />
                </label>
                <label>
                  Phone number
                  <span className="circle-label-optional">
                    Optional — you can copy a link
                  </span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 617 555 0123"
                    autoComplete="tel"
                  />
                </label>
                <button
                  className="circle-button primary wide"
                  disabled={busy || !name.trim()}
                >
                  <UserPlus size={18} />
                  {busy
                    ? "Preparing invitation…"
                    : phone
                      ? "Send invitation"
                      : "Create invitation link"}
                </button>
              </form>
            </section>
            <section className="circle-panel-section">
              <h3>Make it easy for {data.personName}.</h3>
              <p>
                A personal link opens their photographs and a simple invitation
                to talk. No sign-in form.
              </p>
              <button
                className="circle-button secondary wide"
                disabled={busy}
                onClick={() => void invite(true)}
              >
                <Phone size={18} />
                Create {data.personName}’s link
                <ArrowRight size={18} />
              </button>
            </section>
          </>
        )}
        {result && (
          <section
            ref={resultPanel}
            className="circle-link-result"
            role="status"
          >
            <span className="circle-eyebrow">
              {result.sent ? "INVITATION SENT" : "YOUR INVITATION IS READY"}
            </span>
            <h3>{result.name} can join with one tap.</h3>
            <div className="circle-copy-row">
              <input
                aria-label="Private invitation link"
                readOnly
                value={result.url}
                onFocus={(e) => e.target.select()}
              />
              <button
                className="circle-icon-button"
                onClick={() => void copy()}
                aria-label="Copy invitation link"
              >
                {copied ? <Check size={18} /> : <Copy size={18} />}
              </button>
            </div>
            <a className="circle-text-button" href={result.url}>
              Open invitation
              <ArrowRight size={16} />
            </a>
            {result.deliveryError && (
              <p className="circle-notice">{result.deliveryError}</p>
            )}
            <p className="circle-fine">
              Private, single-use link · expires in 3 days.
            </p>
          </section>
        )}
        <section className="circle-panel-section">
          <h3>The occasional little nudge.</h3>
          <p>
            Receive a photo every few days, during daytime, when your family has
            named you in that moment. Always optional.
          </p>
          {mine?.phone ? (
            <label className="circle-switch">
              <span>Photo invitations by text</span>
              <input
                type="checkbox"
                checked={mine.reminders === 1 && !mine.paused}
                onChange={(e) => {
                  void post("preferences", { reminders: e.target.checked })
                    .then(onChanged)
                    .catch((e) => setError(e.message));
                }}
              />
            </label>
          ) : (
            <p className="circle-fine">
              Available after joining through a phone invitation.
            </p>
          )}
          {mine?.error && (
            <p className="circle-notice">
              Invitations are paused: {mine.error}
            </p>
          )}
        </section>
        <details className="circle-account">
          <summary>Sign-in & preferences</summary>
          {!data.hasEmail && !accountSaved ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                void post("register", { email, password })
                  .then(() => {
                    setAccountSaved(true);
                    setPassword("");
                  })
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              <p>Add an email and password to return on any device.</p>
              <label>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={10}
                  maxLength={128}
                  required
                  autoComplete="new-password"
                />
              </label>
              <button className="circle-button secondary" disabled={busy}>
                Save sign-in
              </button>
              {accountSaved && <p role="status">Your sign-in is ready.</p>}
            </form>
          ) : (
            <p className="circle-fine">
              Email sign-in is set up for your account.
            </p>
          )}
          {data.canManage && (
            <Link className="circle-text-button" href="/onboarding">
              <Settings size={16} />
              Conversation & privacy choices
            </Link>
          )}
          <Link className="circle-text-button" href="/conversations">
            Scheduled conversation records
            <ArrowRight size={16} />
          </Link>
          <SignOut />
        </details>
        {error && (
          <p className="circle-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </ArchiveDialog>
  );
}
