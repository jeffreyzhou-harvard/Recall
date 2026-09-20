"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Flower2, Check } from "lucide-react";
import { useLive } from "@/components/live/LiveProvider";
import { post } from "./types";
import "./circle.css";
export function OpenInvitation() {
  const [token, setToken] = useState(""),
    [info, setInfo] = useState<{
      name: string;
      role: string;
      canReceiveReminders: boolean;
      reminders: boolean;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reminders, setReminders] = useState(false);
  const { refreshSession } = useLive();
  useEffect(() => {
    const t = window.location.hash.slice(1);
    setToken(t);
    if (!t) {
      setError(
        "This invitation is missing its private link. Ask your family to send it again.",
      );
      return;
    }
    void post<
      NonNullable<typeof info> & {
        alreadyJoined?: boolean;
        destination?: string;
      }
    >("link", { token: t })
      .then((d) => {
        if (d.alreadyJoined && d.destination)
          window.location.replace(d.destination);
        else { setInfo(d); setReminders(d.reminders); }
      })
      .catch((e) => setError(e.message));
  }, []);
  async function accept() {
    setBusy(true);
    setError("");
    try {
      const d = await post<{ destination: string }>("link", {
        token,
        accept: true,
        reminders,
      });
      history.replaceState(null, "", "/open");
      await refreshSession();
      window.location.assign(d.destination);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Please try opening your invitation again.",
      );
      setBusy(false);
    }
  }
  return (
    <main className="circle-entry">
      <Link className="circle-entry-brand" href="/">
        <Flower2 /> recall<span>·</span>
      </Link>
      <div className="circle-invite-art">
        <span />
        <span />
        <span />
        <Flower2 size={46} />
      </div>
      <p className="circle-eyebrow">A PLACE IN YOUR FAMILY’S STORY</p>
      <h1>
        {info ? `You’re invited, ${info.name}.` : "A little closer, together."}
      </h1>
      <p>
        {info?.role === "patient"
          ? "Your family has kept some photographs for you. Take your time. Enjoy a familiar moment, and share a story if you feel like it."
          : "The photographs bring you back. Your stories bring them to life. Join your family’s private collection."}
      </p>
      {info?.canReceiveReminders && (
        <label className="circle-invite-consent">
          <input
            type="checkbox"
            checked={reminders}
            onChange={(e) => setReminders(e.target.checked)}
          />
          <span>
            Send me an occasional photo invitation by text.
            <small>
              Optional. Every 3–7 days, during daytime. Change this anytime in
              Family.
            </small>
          </span>
        </label>
      )}
      {info && (
        <button
          className="circle-button primary"
          onClick={() => void accept()}
          disabled={busy}
        >
          {busy
            ? "Opening your collection…"
            : info.role === "patient"
              ? "Open my photographs"
              : "Join my family"}
          <ArrowRight size={19} />
        </button>
      )}
      {!info && !error && <p role="status">Opening your invitation…</p>}
      {error && (
        <p className="circle-error" role="alert">
          {error}
        </p>
      )}
      <p className="circle-fine">
        Private family photographs. Original voices. Shared with care.
      </p>
      <Link className="circle-text-button" href="/sign-in">
        Already joined? Sign in
      </Link>
    </main>
  );
}
