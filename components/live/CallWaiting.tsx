"use client";
import { useEffect, useState } from "react";
import { RecallFrame, RecallHeader } from "@/components/recall/RecallFrame";
import { api } from "@/client/api";
export function CallWaiting() {
  const [message, setMessage] = useState("Checking for a call…");
  useEffect(() => {
    const controller = new AbortController();
    api<{ status: string; message: string }>("/api/call/status", { signal: controller.signal }).then((data) => setMessage(data.message)).catch(() => { if (!controller.signal.aborted) setMessage("Recall is unavailable right now."); });
    return () => controller.abort();
  }, []);
  return <RecallFrame><main className="recall-phone"><RecallHeader /><section className="recall-revisit"><h1>{message}</h1><p>You can put your phone down.</p></section></main></RecallFrame>;
}
