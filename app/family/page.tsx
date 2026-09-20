"use client";
import { RecallFrame, RecallHeader } from "@/components/recall/RecallFrame";
import { AccessGate } from "@/components/live/AccessGate";
import { FamilyDashboard } from "@/components/live/FamilyDashboard";
import { useLive } from "@/components/live/LiveProvider";
import "@/app/caregiver.css";
export default function FamilyPage() {
  const { session } = useLive();
  const hasFamilyAccess = session?.principal && session.principal.role !== "patient";
  return <RecallFrame family><div className="care-portal">{!hasFamilyAccess && <RecallHeader family compact />}<AccessGate><FamilyDashboard /></AccessGate></div></RecallFrame>;
}
