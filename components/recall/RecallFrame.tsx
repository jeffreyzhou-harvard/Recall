"use client";

import { type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { usePreview } from "./PreviewProvider";

export function RecallFrame({ children, family = false }: { children: ReactNode; family?: boolean }) {
  const { largeText, dark } = usePreview();
  return <div className={`recall-workspace ${family ? "recall-family-workspace" : ""}`} data-large-text={largeText} data-dark={dark}>{children}</div>;
}

export function RecallHeader({ family = false, compact = false }: { family?: boolean; compact?: boolean }) {
  const { largeText, setLargeText, dark, setDark } = usePreview();
  return <>
    <header className={`recall-masthead${compact ? " recall-masthead-compact" : ""}`}>
      <span className="recall-wordmark"><svg className="recall-brand-mark" viewBox="0 0 40 40" aria-hidden="true"><path className="recall-brand-path" d="M6 34V20H20V6H34" fill="none" strokeWidth="4" /><rect x="1" y="1" width="10" height="10" /><rect x="15" y="15" width="10" height="10" /><rect x="1" y="29" width="10" height="10" /><rect x="29" y="29" width="10" height="10" /><rect x="29" y="1" width="10" height="10" className="recall-brand-beat" /></svg>Recall</span>
      {family && <details className="recall-display-options">
        <summary>Text & contrast<ChevronDown size={18} aria-hidden="true" /></summary>
        <fieldset>
          <legend>Make this comfortable to read</legend>
          <label><input type="checkbox" checked={largeText} onChange={(event) => setLargeText(event.target.checked)} />Larger text</label>
          <label><input type="checkbox" checked={dark} onChange={(event) => setDark(event.target.checked)} />Dark background</label>
        </fieldset>
      </details>}
    </header>
    {!compact && <div className="recall-familiar">{family ? "Maya’s family view" : "Set up by Maya, your daughter"}</div>}
  </>;
}
