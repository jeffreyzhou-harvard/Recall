"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Principal } from "@/server/session";
import { api } from "@/client/api";
type Session = { principal: Principal | null; local_setup_available: boolean; household_id: string | null };
const Context = createContext<{
  session: Session | null; refreshSession: () => Promise<void>; sessionError: string;
  largeText: boolean; setLargeText: (v: boolean) => void; dark: boolean; setDark: (v: boolean) => void;
  member: string; setMember: (v: string) => void;
} | null>(null);
export function LiveProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null), [sessionError, setSessionError] = useState("");
  const [largeText, setLargeText] = useState(false), [dark, setDark] = useState(false), [member, setMember] = useState("");
  const refreshSession = useCallback(async () => {
    try { const next = await api<Session>("/api/session"); setSession(next); setSessionError(""); if (next.principal?.role === "family") setMember(next.principal.member_id); }
    catch (error) { setSession(null); setSessionError(error instanceof Error ? error.message : "Recall could not load your session."); }
  }, []);
  useEffect(() => { void refreshSession(); setMember(new URLSearchParams(window.location.search).get("member") ?? ""); }, [refreshSession]);
  return <Context.Provider value={{ session, refreshSession, sessionError, largeText, setLargeText, dark, setDark, member, setMember }}>{children}</Context.Provider>;
}
export function useLive() { const value = useContext(Context); if (!value) throw new Error("LiveProvider is required"); return value; }
