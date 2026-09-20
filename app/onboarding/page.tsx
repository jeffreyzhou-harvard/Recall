"use client";
import { RecallFrame, RecallHeader } from "@/components/recall/RecallFrame";
import { AccessGate } from "@/components/live/AccessGate";
import { JointSetup } from "@/components/live/JointSetup";
export default function OnboardingPage() {
  return <RecallFrame family><div className="recall-family-shell recall-setup-shell"><RecallHeader family compact /><main className="care-main recall-setup-main"><AccessGate setup firstSetup><JointSetup /></AccessGate></main></div></RecallFrame>;
}
