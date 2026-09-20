"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { useLive } from "@/components/live/LiveProvider";

export function RecallFrame({ children, family = false }: { children: ReactNode; family?: boolean }) {
  const { largeText, dark } = useLive();
  return <div className={`recall-workspace ${family ? "recall-family-workspace" : ""}`} data-large-text={largeText} data-dark={dark}>{children}</div>;
}

export function RecallMark({ size }: { size?: number }) {
  return <svg className="recall-brand-mark" style={size ? { width: size, height: size } : undefined} viewBox="0 0 40 40" aria-hidden="true"><path className="recall-brand-path" d="M6 34V20H20V6H34" fill="none" strokeWidth="4" /><rect x="1" y="1" width="10" height="10" /><rect x="15" y="15" width="10" height="10" /><rect x="1" y="29" width="10" height="10" /><rect x="29" y="29" width="10" height="10" /><rect x="29" y="1" width="10" height="10" className="recall-brand-beat" /></svg>;
}

export function RecallWordmark() {
  return <span className="recall-wordmark"><RecallMark /><span className="recall-brand-name">Recall</span></span>;
}

export function RecallHeader({ family = false, compact = false }: { family?: boolean; compact?: boolean }) {
  return <>
    <header className={`recall-masthead${compact ? " recall-masthead-compact" : ""}`}><Link href="/" className="recall-home-link" aria-label="Recall home"><RecallWordmark /></Link></header>
    {!compact && <div className="recall-familiar">{family ? "Your family view" : "Familiar conversations, in your own words"}</div>}
  </>;
}
