/**
 * Inbound caregiver SMS. A body of `1` (trimmed, case-insensitive) acknowledges
 * the sender's most recent pending safety alert. Anything else is ignored.
 * Operator-only: this is the SMS provider's webhook, not a family route
 * (AGENTS.md rule 5).
 */
import { isOperator } from "@/server/operator";
import { getLiveRecall } from "@/server/recall-live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readField(body: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string") return value;
  }
  return "";
}

export async function POST(request: Request): Promise<Response> {
  if (!isOperator(request)) return Response.json({ error: "not allowed" }, { status: 403 });
  let raw: unknown = null;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "expected JSON" }, { status: 400 });
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return Response.json({ error: "expected JSON" }, { status: 400 });
  const body = raw as Record<string, unknown>;
  const from = readField(body, "from", "From");
  const text = readField(body, "body", "Body", "text");
  if (!from) return Response.json({ error: "expected from" }, { status: 400 });
  const recall = await getLiveRecall();
  // Never echo the body back: a non-ack, or a 1 with nothing pending, is a silent no-op.
  const result = await recall.service.receiveCaregiverSms(from, text);
  return Response.json({ status: result.status });
}
