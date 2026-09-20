"use client";
import { AccessGate } from "@/components/live/AccessGate";
import { CircleApp } from "@/components/circle/CircleApp";
export default function ConversationsPage() {
  return <AccessGate><CircleApp initialSection="sessions" /></AccessGate>;
}
