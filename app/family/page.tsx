"use client";
import { RecallFrame, RecallHeader } from "@/components/recall/RecallFrame";
import { AccessGate } from "@/components/live/AccessGate";
import { FamilyDashboard } from "@/components/live/FamilyDashboard";
export default function FamilyPage() {
  return <RecallFrame family><div className="recall-family-shell care-dashboard"><RecallHeader family compact /><main className="care-main"><AccessGate><FamilyDashboard /></AccessGate></main></div></RecallFrame>;
}
