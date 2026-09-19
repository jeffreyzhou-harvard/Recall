/**
 * Who is who on Telegram. Part of the one-time joint setup: which Telegram
 * chat is the family's thread, who it reaches, and which Telegram accounts are
 * which people.
 *
 * Telegram ids are personal data. Bindings come from the environment
 * (RELAY_TELEGRAM_BINDINGS) or a git-ignored file - never from a committed
 * fixture. A binding grants nothing by itself: the identity gate and the
 * access policy still decide, on every run, whether the ask goes anywhere.
 */
import { z } from "zod";

const numericId = z.string().regex(/^-?\d+$/, "Telegram ids are integers, written as strings");

export const telegramBindingsSchema = z.strictObject({
  /** Telegram chat id -> the thread it is, and who asks in it are addressed to. Group ids are negative. */
  chats: z.record(numericId, z.strictObject({ thread_id: z.string().min(1), addressee_id: z.string().min(1) })),
  /** Telegram user id -> person. Also where that person's support receipt is sent, if the policy names them. */
  users: z.record(numericId, z.string().min(1)),
});
export type TelegramBindings = z.infer<typeof telegramBindingsSchema>;

export function parseBindings(json: string | undefined): TelegramBindings {
  if (!json || json.trim() === "") return { chats: {}, users: {} };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("RELAY_TELEGRAM_BINDINGS is not valid JSON");
  }
  const parsed = telegramBindingsSchema.safeParse(raw);
  if (!parsed.success) {
    const why = (i: z.core.$ZodIssue): string => (i.code === "invalid_key" ? "Telegram ids are integers, written as strings" : i.message);
    throw new Error(`RELAY_TELEGRAM_BINDINGS is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${why(i)}`).join("; ")}`);
  }
  return parsed.data;
}

/** A Telegram account nobody bound. Intake does not know this id, so it refuses the forward and asks the family to clarify. */
export const unboundUser = (telegramUserId: number): string => `telegram:user:${telegramUserId}`;

/** The private chat with a person is addressed by their user id. It only works once they have started the bot themselves. */
export function chatIdForPerson(bindings: TelegramBindings, personId: string): number | null {
  const entry = Object.entries(bindings.users).find(([, person]) => person === personId);
  return entry ? Number(entry[0]) : null;
}
