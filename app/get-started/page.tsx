import Link from "next/link";
import { WelcomeLayout } from "@/components/live/Welcome";

export default function GetStartedPage() {
  return <WelcomeLayout back>
    <section className="recall-welcome-content">
      <h1>Start together</h1>
      <p>Set up Recall with the person who’ll receive the calls. You’ll choose the people, topics and times together.</p>
      <div className="recall-welcome-actions">
        <Link href="/onboarding" className="recall-button recall-primary">Set up together</Link>
        <Link href="/join" className="recall-button recall-secondary">I have an invitation</Link>
      </div>
      <p className="recall-welcome-footnote">Have your setup key or family invitation ready.</p>
    </section>
  </WelcomeLayout>;
}
