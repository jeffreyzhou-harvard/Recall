"use client";
import { RecallFrame, RecallHeader } from "@/components/recall/RecallFrame";
import { AccessGate } from "@/components/live/AccessGate";
import { HouseholdManager } from "@/components/live/HouseholdManager";
export default function ManagePage() { return <RecallFrame family><div className="recall-family-shell"><RecallHeader family compact /><main className="care-main"><AccessGate setup><HouseholdManager /></AccessGate></main></div></RecallFrame>; }
