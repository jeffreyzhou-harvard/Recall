"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePreview } from "@/components/recall/PreviewProvider";
import { PreviewNav } from "@/components/recall/PreviewNav";
import { RecallFrame, RecallHeader } from "@/components/recall/RecallFrame";
import { Phone } from "lucide-react";

export default function RevisitPage() {
  const { data, dispatch } = usePreview();
  const [later, setLater] = useState(false);
  const router = useRouter();
  const topic = data.topics.find((item) => item.id === "lincoln")!;
  const begin = () => {
    dispatch({ type: "prepare", topicId: topic.id });
    dispatch({ type: "answer" });
    router.push("/");
  };
  return <RecallFrame>
    <div className="recall-preview-label">Next conversation preview <span>· No call is placed</span></div>
    <main className="recall-phone">
      <RecallHeader />
      <section className="recall-revisit">
        <h1>{later ? "Another time is fine." : "Let’s talk about a familiar place."}</h1>
        {later ? <p>You can put your phone down.</p> : <>
          <div className="recall-place-name">{topic.name}</div>
          <p className="recall-revisit-prompt">{topic.invitation}</p>
        </>}
      </section>
      <footer className="recall-actions">{!later && <>
        <button className="recall-button recall-primary" onClick={begin}><Phone aria-hidden="true" />Let’s talk</button>
        <button className="recall-button recall-secondary" onClick={() => setLater(true)}>Another time</button>
      </>}</footer>
    </main>
    <aside className="recall-review-tools" aria-label="Prototype navigation"><PreviewNav />{later && <button className="recall-reset-link" onClick={() => setLater(false)}>Show invitation again</button>}</aside>
  </RecallFrame>;
}
