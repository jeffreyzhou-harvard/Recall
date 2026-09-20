import type { ArchiveView } from "@/lib/archive/types";
import type { CircleMoment } from "@/server/circle/store";
export type CircleView = Omit<ArchiveView, "moments"> & {
  moments: CircleMoment[];
  member: string;
  name: string;
  personName: string;
  household: string;
  canManage: boolean;
  hasEmail: boolean;
  demo: boolean;
  aiConnected: boolean;
  messagingConnected: boolean;
  imports: {
    id: string;
    added: number;
    duplicates: number;
    moments: number;
    at: string;
  }[];
  people: {
    id: string;
    name: string;
    role: string;
    contact?: {
      phone: string;
      reminders: number;
      next_at: number | null;
      error: string | null;
      paused: number;
    };
  }[];
  invitations: { id: string; name: string; phone: string; expires: number }[];
};
export const dateLabel = (date: string | null) =>
  date
    ? new Date(date).toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      })
    : "A moment rediscovered";
export const post = async <T = Record<string, unknown>>(
  action: string,
  body: unknown,
): Promise<T> => {
  const response = await fetch("/api/circle/" + action, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error || "Something interrupted this step. Please try again.",
    );
  return data;
};
