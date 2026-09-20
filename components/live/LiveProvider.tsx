"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Principal } from "@/server/session";
import { api } from "@/client/api";
export type SessionInfo = { principal: Principal | null; local_setup_available: boolean; first_setup_available: boolean; can_manage_setup: boolean; managed_household_id: string | null; household_id: string | null };
const Context = createContext<{
  session: SessionInfo | null; refreshSession: () => Promise<void>; sessionError: string;
  largeText: boolean; setLargeText: (v: boolean) => void; dark: boolean; setDark: (v: boolean) => void;
  member: string; setMember: (v: string) => void;
} | null>(null);
export function LiveProvider({ children, sessionEndpoint = "/api/session" }: { children: ReactNode; sessionEndpoint?: string }) {
  const [session, setSession] = useState<SessionInfo | null>(null), [sessionError, setSessionError] = useState("");
  const [largeText, setLargeText] = useState(false), [dark, setDark] = useState(false), [member, setMember] = useState("");
  const refreshSession = useCallback(async () => {
    try { const next = await api<SessionInfo>(sessionEndpoint); setSession(next); setSessionError(""); if (next.principal?.role === "family") setMember(next.principal.member_id); }
    catch (error) { setSession(null); setSessionError(error instanceof Error ? error.message : "Recall could not load your session."); }
  }, [sessionEndpoint]);
  useEffect(() => { void refreshSession(); setMember(new URLSearchParams(window.location.search).get("member") ?? ""); }, [refreshSession]);
  return <Context.Provider value={{ session, refreshSession, sessionError, largeText, setLargeText, dark, setDark, member, setMember }}>{children}</Context.Provider>;
}
export function useLive() { const value = useContext(Context); if (!value) throw new Error("LiveProvider is required"); return value; }
