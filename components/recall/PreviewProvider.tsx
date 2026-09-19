"use client";

import { createContext, useContext, useReducer, useState, type Dispatch, type ReactNode } from "react";
import { initialPreview, reducePreview, type PreviewAction, type PreviewData, type PreviewState } from "@/lib/recall-preview/model";
import { emptySetup, type SetupSelections } from "@/lib/recall-preview/imports";
import type { MemorySuggestion } from "@/lib/recall-preview/contributions";

const PreviewContext = createContext<{ data: PreviewData; state: PreviewState; dispatch: Dispatch<PreviewAction>; largeText: boolean; setLargeText: (value: boolean) => void; dark: boolean; setDark: (value: boolean) => void; setup: SetupSelections; setSetup: (value: SetupSelections) => void; suggestions: MemorySuggestion[]; setSuggestions: Dispatch<React.SetStateAction<MemorySuggestion[]>> } | null>(null);

export function PreviewProvider({ data, children }: { data: PreviewData; children: ReactNode }) {
  const [state, dispatch] = useReducer((value: PreviewState, action: PreviewAction) => reducePreview(value, action, data), data, initialPreview);
  const [largeText, setLargeText] = useState(false);
  const [dark, setDark] = useState(false);
  const [setup, setSetup] = useState(emptySetup);
  const [suggestions, setSuggestions] = useState<MemorySuggestion[]>([]);
  return <PreviewContext.Provider value={{ data, state, dispatch, largeText, setLargeText, dark, setDark, setup, setSetup, suggestions, setSuggestions }}>{children}</PreviewContext.Provider>;
}

export function usePreview() {
  const value = useContext(PreviewContext);
  if (!value) throw new Error("The recall preview requires PreviewProvider");
  return value;
}
