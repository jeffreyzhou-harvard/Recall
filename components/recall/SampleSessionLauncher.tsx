"use client";

import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { usePreview } from "./PreviewProvider";

/** Explicit prototype navigation, never a call request or scheduling action. */
export function SampleSessionLauncher({ compact = false }: { compact?: boolean }) {
  const { data, setup, dispatch } = usePreview();
  const router = useRouter();
  const selectedTopics = new Set(setup.samplePhotos?.map((photo) => photo.topicId));
  const topics = data.topics.filter((topic) => topic.lines.length && (!setup.agreed || !selectedTopics.size || selectedTopics.has(topic.id)));
  return <section className={`sample-session-launcher${compact ? " sample-session-compact" : ""}`} aria-label="Explore a sample conversation">
    <h3>See a sample conversation</h3>
    <p>Follow a selected photo into Susan’s phone view, then return here to see the call record. This plays a fictional script; it does not place a call.</p>
    <div>{topics.map((topic) => <button key={topic.id} type="button" onClick={() => {
      dispatch({ type: "prepare", topicId: topic.id });
      router.push("/");
    }}>{topic.shortName}<ArrowRight size={18} aria-hidden="true" /></button>)}</div>
    {!topics.length && <p>The selected topic has no sample conversation yet. You can still review its photo and family context.</p>}
  </section>;
}
