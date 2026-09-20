import { CircleError, readCircle, withCircleDb } from "./store";
import { createLink } from "./access";
import { getOnboarding } from "../onboarding";
import { accountForMember } from "../accounts";
export const publicBase = () =>
  (process.env.RECALL_PUBLIC_URL || process.env.RELAY_PUBLIC_URL || "").replace(
    /\/$/,
    "",
  );
export async function sendText(phone: string, text: string, id: string) {
  if (!/^\+[1-9]\d{7,14}$/.test(phone))
    throw new CircleError(
      "Include the country code, for example +1 617 555 0123.",
    );
  if (!process.env.LINQ_API_KEY)
    throw new CircleError(
      "Text messaging is not connected yet. Copy the invitation link instead.",
      503,
    );
  const base = publicBase();
  if (!base.startsWith("https://"))
    throw new CircleError(
      "A public HTTPS address is needed for phone links. You can copy a local link for this demo.",
      503,
    );
  const response = await fetch(
    "https://api.linqapp.com/api/partner/v3/messages",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.LINQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: [phone],
        message: {
          parts: [{ type: "text", value: text }],
          idempotency_key: id,
        },
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok)
    throw new CircleError(
      `The text wasn’t accepted by the messaging provider (${response.status}). Your invitation link is still ready.`,
      502,
    );
}
export async function tickCircleReminders() {
  const contacts = withCircleDb((db) =>
    db
      .prepare(
        "SELECT * FROM contacts WHERE reminders=1 AND paused=0 AND next_at<=?",
      )
      .all(Date.now()),
  ) as {
    member: string;
    household: string;
    phone: string;
    next_at: number;
    last_moment: string | null;
  }[];
  let sent = 0;
  for (const contact of contacts) {
    const now = new Date(),
      hour = Number(
        new Intl.DateTimeFormat("en-US", {
          timeZone: process.env.RECALL_REMINDER_TIMEZONE || "America/New_York",
          hour: "numeric",
          hourCycle: "h23",
        }).format(now),
      );
    if (hour < 10 || hour >= 18) continue;
    const state = readCircle(contact.household);
    if (state.demo) continue;
    const person = (await getOnboarding().people(contact.household)).find(
      (p) => p.person_id === contact.member && !p.removed_at,
    );
    const account = accountForMember(contact.member);
    if (!person || !account || account.household_id !== contact.household) continue;
    // Only send to people explicitly connected to a moment. Never guess who a face belongs to.
    const eligible = state.moments.filter(
      (m) =>
        m.participantIds.includes(contact.member) &&
        m.id !== contact.last_moment &&
        !state.stories.some(
          (s) => s.owner === contact.member && s.eventId === m.id,
        ),
    );
    if (!eligible.length) continue;
    const m = eligible[Math.floor(Math.random() * eligible.length)]!;
    const claimed = withCircleDb(
      (db) =>
        db
          .prepare(
            "UPDATE contacts SET next_at=? WHERE member=? AND reminders=1 AND paused=0 AND next_at=?",
          )
          .run(
            Date.now() + (3 + Math.random() * 4) * 86400_000,
            contact.member,
            contact.next_at,
          ).changes,
    );
    if (!claimed) continue;
    try {
      const token = createLink(
        {
          household: contact.household,
          member: contact.member,
          invitation: null,
          name: person.display_name,
          phone: contact.phone,
          role: person.role === "participant" ? "patient" : "family",
          destination: "/contribute?moment=" + encodeURIComponent(m.id),
        },
        168,
      );
      await sendText(
        contact.phone,
        `Hi ${person.display_name}, a photograph from ${m.title} is waiting in your family’s Recall collection. ${m.question}\n\nOnly when you feel like it: ${publicBase()}/open#${token}\n\nYou can pause photo invitations in Recall.`,
        `recall-memory-${contact.member}-${contact.next_at}`,
      );
      withCircleDb((db) =>
        db
          .prepare(
            "UPDATE contacts SET last_moment=?,error=NULL WHERE member=?",
          )
          .run(m.id, contact.member),
      );
      sent++;
    } catch (e) {
      withCircleDb((db) =>
        db
          .prepare("UPDATE contacts SET error=?,paused=1 WHERE member=?")
          .run(
            e instanceof Error ? e.message : "Message could not be sent.",
            contact.member,
          ),
      );
    }
  }
  return { sent };
}
