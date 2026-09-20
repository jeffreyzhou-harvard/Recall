"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RecallFrame, RecallHeader } from "@/components/recall/RecallFrame";
import { accountDestination, SessionLoading } from "./AccessGate";
import { useLive } from "./LiveProvider";
import "@/app/welcome.css";

export function WelcomeLayout({ children, back = false }: { children: ReactNode; back?: boolean }) {
  return <RecallFrame family>
    <div className="recall-welcome-shell">
      <RecallHeader family compact />
      <main className="recall-welcome-main" id="main-content">
        {back && <Link className="recall-welcome-back" href="/">Back</Link>}
        {children}
      </main>
    </div>
  </RecallFrame>;
}

export function ContinueToAccount() {
  const { session } = useLive();
  const router = useRouter();
  const destination = session?.principal ? accountDestination(session.principal.role) : null;
  useEffect(() => { if (destination) router.replace(destination); }, [destination, router]);
  return <section className="recall-access" aria-live="polite">
    <p>Opening your account…</p>
    {destination && <Link className="care-text-action" href={destination}>Continue</Link>}
  </section>;
}

export function Welcome() {
  const { session } = useLive();
  return <WelcomeLayout>
    {!session ? <SessionLoading /> : session.principal ? <ContinueToAccount /> : <section className="recall-welcome-content">
      <h1>Welcome to Recall</h1>
      <p>Familiar conversations, in your own words.</p>
      <div className="recall-welcome-actions">
        <Link href="/get-started" className="recall-button recall-primary">I’m new here</Link>
        <Link href="/sign-in" className="recall-button recall-secondary">Sign in</Link>
      </div>
      <p className="recall-welcome-footnote">An AI assistant to help you revisit your memories.</p>
    </section>}
  </WelcomeLayout>;
}
