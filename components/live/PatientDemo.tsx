"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { post } from "@/components/circle/types";
import { CallWaiting } from "./CallWaiting";
import { LiveProvider } from "./LiveProvider";
import { WelcomeLayout } from "./Welcome";

export function PatientDemo() {
  const opening = useRef<Promise<unknown> | null>(null);
  const [ready, setReady] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    opening.current ??= post("demo-patient", {});
    opening.current.then(() => { if (mounted) setReady(true); }).catch(e => { if (mounted) setError(e instanceof Error ? e.message : "The patient demo could not be opened."); });
    return () => { mounted = false; };
  }, []);
  if (!ready) return <WelcomeLayout back><section className="recall-access"><p role={error ? "alert" : "status"}>{error || "Opening Susan’s sample call…"}</p>{error && <Link href="/" className="recall-button recall-secondary">Back to home</Link>}</section></WelcomeLayout>;
  return <LiveProvider sessionEndpoint="/api/demo/session"><CallWaiting demo /></LiveProvider>;
}
