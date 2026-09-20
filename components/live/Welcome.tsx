"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RecallFrame, RecallHeader, RecallWordmark, RecallMark } from "@/components/recall/RecallFrame";
import { accountDestination, SignOut } from "./AccessGate";
import { useLive } from "./LiveProvider";
import "@/app/welcome.css";
import "@/components/circle/circle.css";
import { ArrowRight, Images } from "lucide-react";
import { post } from "@/components/circle/types";

export function WelcomeLayout({
  children,
  back = false,
  wide = false,
}: {
  children: ReactNode;
  back?: boolean;
  wide?: boolean;
}) {
  return (
    <RecallFrame family>
      <div className={`recall-welcome-shell${wide ? " recall-welcome-shell-wide" : ""}`}>
        <RecallHeader family compact />
        <main className="recall-welcome-main" id="main-content">
          {back && (
            <Link className="recall-welcome-back" href="/">
              Back to home
            </Link>
          )}
          {children}
        </main>
      </div>
    </RecallFrame>
  );
}

export function ContinueToAccount() {
  const { session } = useLive();
  const router = useRouter();
  const destination = session?.principal
    ? accountDestination(session.principal.role)
    : null;
  useEffect(() => {
    if (destination) router.replace(destination);
  }, [destination, router]);
  return (
    <section className="recall-access" aria-live="polite">
      <p>Opening your account…</p>
      {destination && (
        <Link className="care-text-action" href={destination}>
          Continue
        </Link>
      )}
    </section>
  );
}

export function Welcome() {
  const { session, refreshSession } = useLive();
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const artRef = useRef<HTMLDivElement>(null);
  const hasSession = session !== null;
  useEffect(() => {
    const art = artRef.current;
    if (!art || typeof IntersectionObserver === "undefined") return;
    let visible = false;
    const syncMotion = () => { art.dataset.floating = String(visible && !document.hidden); };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      syncMotion();
    });
    observer.observe(art);
    document.addEventListener("visibilitychange", syncMotion);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", syncMotion);
      art.dataset.floating = "false";
    };
  }, [hasSession]);
  async function demo() {
    setBusy(true);
    setError("");
    try {
      await post("demo", {});
      await refreshSession();
      router.push("/caregiver");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not open the sample family.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!session)
    return (
      <main className="circle-landing"><header>
        <Link className="circle-entry-brand" href="/" aria-label="Recall home"><RecallWordmark /></Link>
        <span role="status">Opening Recall…</span>
      </header></main>
    );
  const role = session.principal?.role;
  const destination = role ? accountDestination(role) : null;
  const returnLabel = role === "patient" ? "Your photographs" : role === "operator" ? "Joint setup" : "Your collection";
  return (
    <main className="circle-landing">
      <header>
        <Link className="circle-entry-brand" href="/" aria-label="Recall home">
          <RecallWordmark />
        </Link>
        <Link className="circle-button secondary" href={destination || "/sign-in"}>
          {destination ? returnLabel : "Sign in"}
          <ArrowRight size={16} />
        </Link>
      </header>
      <div className="circle-landing-layout">
        <section>
          <h1>
            A photograph holds
            <br />a moment.
            <br />
            <em>You hold the story.</em>
          </h1>
          <p>
            Add your family’s photographs. Recall gathers them into moments, so
            the stories behind them have a place to live.
          </p>
          <Link href={destination || "/onboarding"} className="circle-button primary">
            {destination ? `Open ${returnLabel.toLowerCase()}` : "Start your family"}
            <ArrowRight size={19} />
          </Link>
          {destination && <div className="circle-home-account"><SignOut /></div>}
          {process.env.NODE_ENV === "development" && (
            <>
            <button
              className="circle-text-button"
              onClick={() => void demo()}
              disabled={busy}
            >
              {busy ? "Opening a sample family…" : "Explore a sample family"}
              <ArrowRight size={17} />
            </button>
            <Link className="circle-text-button" href="/demo/call" target="_blank" rel="noopener">
              Try the patient call demo
              <ArrowRight size={17} />
            </Link>
            </>
          )}
          {error && (
            <p className="circle-error" role="alert">
              {error}
            </p>
          )}
          <div className="circle-landing-promise">
            <Images size={20} />
            <span>
              Just add photos.
              <br />
              <small>We’ll make room for the memories.</small>
            </span>
          </div>
        </section>
        <div
          className="circle-landing-art"
          ref={artRef}
          aria-label="Illustrative sample family photographs"
        >
          <div className="circle-landing-collage">
            <figure>
              <img
                src="/preview/princeton-kitchen.png"
                alt="A family moment in the kitchen"
              />
              <figcaption>The little things.</figcaption>
            </figure>
            <figure>
              <img
                src="/sample-family/beach-01.jpg"
                alt="A family day beside the ocean"
              />
              <figcaption>A whole afternoon, together.</figcaption>
            </figure>
            <figure>
              <img src="/preview/princeton-garden.png" alt="A familiar garden" />
              <figcaption>Somewhere that feels like home.</figcaption>
            </figure>
          </div>
          <div className="circle-art-caption">
            <RecallMark size={23} />
            <span>Every picture has more to tell.</span>
          </div>
        </div>
      </div>
      <footer>
        <span>One family. Many perspectives.</span>
        <span>Private by design · Your words, always yours</span>
      </footer>
    </main>
  );
}
