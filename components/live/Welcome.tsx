"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RecallFrame, RecallHeader } from "@/components/recall/RecallFrame";
import { accountDestination, SessionLoading, SignOut } from "./AccessGate";
import { useLive } from "./LiveProvider";
import "@/app/welcome.css";
import "@/components/circle/circle.css";
import { Flower2, ArrowRight, Images } from "lucide-react";
import { post } from "@/components/circle/types";

export function WelcomeLayout({
  children,
  back = false,
}: {
  children: ReactNode;
  back?: boolean;
}) {
  return (
    <RecallFrame family>
      <div className="recall-welcome-shell">
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
      <WelcomeLayout>
        <SessionLoading />
      </WelcomeLayout>
    );
  const role = session.principal?.role;
  const destination = role ? accountDestination(role) : null;
  const returnLabel = role === "patient" ? "Your photographs" : role === "operator" ? "Joint setup" : "Your collection";
  return (
    <main className="circle-landing">
      <header>
        <Link className="circle-entry-brand" href="/" aria-label="Recall home">
          <Flower2 />
          recall<span>·</span>
        </Link>
        <Link className="circle-button secondary" href={destination || "/sign-in"}>
          {destination ? returnLabel : "Sign in"}
          <ArrowRight size={16} />
        </Link>
      </header>
      <div className="circle-landing-layout">
        <section>
          <p className="circle-eyebrow">THE LITTLE THINGS, KEPT CLOSE</p>
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
          {!destination && process.env.NODE_ENV === "development" && (
            <button
              className="circle-text-button"
              onClick={() => void demo()}
              disabled={busy}
            >
              {busy ? "Opening a sample family…" : "Explore a sample family"}
              <ArrowRight size={17} />
            </button>
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
          aria-label="Illustrative sample family photographs"
        >
          <figure>
            <img
              src="/preview/princeton-kitchen.png"
              alt="A family moment in the kitchen"
            />
            <figcaption>The little things.</figcaption>
          </figure>
          <figure>
            <img
              src="/preview/family-beach.png"
              alt="A family day beside the ocean"
            />
            <figcaption>A whole afternoon, together.</figcaption>
          </figure>
          <figure>
            <img src="/preview/princeton-garden.png" alt="A familiar garden" />
            <figcaption>Somewhere that feels like home.</figcaption>
          </figure>
          <div className="circle-art-caption">
            <Flower2 size={23} />
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
