/**
 * Reading a Telegram update. Pure: no network, no clock, no state.
 *
 * How a relative forwards an ask:
 *
 *   1. They post their question in the family group, as usual, with or
 *      without a photo.
 *   2. They reply to that message with `/ask`. If the photo needs describing
 *      they say what it shows: `/ask kheer and halwa`.
 *
 *   (`/ask Mom, which should I make?` on its own, or as a photo's caption,
 *   also works when there is no earlier message to reply to.)
 *
 * Keep the bot's group privacy mode ON (BotFather's default). With it on,
 * Telegram delivers only commands addressed to the bot, and the single message
 * such a command replies to. The rest of the conversation never reaches Recall
 * at all - rule 8 is enforced by Telegram before it is enforced by us.
 *
 * What is read from an update is exactly: who sent the command, which chat,
 * when, the question's text, and at most one photo. Nothing else is looked at.
 */
import type { TgMessage, TgPhotoSize, TgUpdate } from "./api";

export const ASK_COMMAND = "ask";
const HELP_COMMANDS = new Set(["start", "help"]);

export const USAGE_TEXT = "To ask with Recall, reply to your own question with /ask. If there is a photo, say what it shows: /ask kheer and halwa.";

export interface ParsedAsk {
  kind: "ask";
  chat_id: number;
  from_user_id: number;
  /** The message that carries the question. Replies from Recall attach to it. */
  ask_message_id: number;
  text: string;
  photo: { file_id: string; file_unique_id: string } | null;
  /** What the asker says the photo shows. Their words, never a guess about the image. */
  shows: string | null;
  received_at: string;
}

export type ParsedUpdate =
  | ParsedAsk
  | { kind: "usage"; chat_id: number; reply_to_message_id: number; reason: "help" | "empty_ask" | "not_your_message" }
  | { kind: "ignored"; reason: string };

interface Command {
  name: string;
  args: string;
}

/** A bot command at the very start of the text or caption, addressed to this bot or to nobody in particular. */
function commandIn(message: TgMessage, botUsername: string): Command | null {
  const body = message.text ?? message.caption ?? "";
  const entity = (message.entities ?? message.caption_entities ?? []).find((e) => e.type === "bot_command" && e.offset === 0);
  if (!entity) return null;
  const [name, target] = body.slice(1, entity.length).split("@");
  if (target !== undefined && target.toLowerCase() !== botUsername.toLowerCase()) return null;
  return { name: name!.toLowerCase(), args: body.slice(entity.length).trim() };
}

/** Telegram sends several sizes of one photo. Take the largest: it is still one photo. */
function largest(photo: TgPhotoSize[] | undefined): ParsedAsk["photo"] {
  if (!photo || photo.length === 0) return null;
  const best = [...photo].sort((a, b) => b.width * b.height - a.width * a.height)[0]!;
  return { file_id: best.file_id, file_unique_id: best.file_unique_id };
}

export function parseUpdate(update: TgUpdate, botUsername: string): ParsedUpdate {
  const message = update.message;
  if (!message) return { kind: "ignored", reason: "not a message update" };
  if (!message.from || message.from.is_bot) return { kind: "ignored", reason: "no human sender" };
  if (message.chat.type === "channel") return { kind: "ignored", reason: "channels are not family threads" };

  const command = commandIn(message, botUsername);
  if (!command) return { kind: "ignored", reason: "not a command for this bot" };
  const usage = (reason: "help" | "empty_ask" | "not_your_message"): ParsedUpdate => ({
    kind: "usage",
    chat_id: message.chat.id,
    reply_to_message_id: message.message_id,
    reason,
  });
  if (HELP_COMMANDS.has(command.name)) return usage("help");
  if (command.name !== ASK_COMMAND) return { kind: "ignored", reason: `unknown command /${command.name}` };

  const base = { kind: "ask" as const, chat_id: message.chat.id, from_user_id: message.from.id, received_at: new Date(message.date * 1000).toISOString() };
  const question = message.reply_to_message;
  if (question) {
    // You forward your own question. Pointing Recall at someone else's message would make them the
    // asker without their having asked.
    if (question.from?.id !== message.from.id) return usage("not_your_message");
    const text = (question.text ?? question.caption ?? "").trim();
    if (!text) return usage("empty_ask");
    const photo = largest(question.photo);
    return { ...base, ask_message_id: question.message_id, text, photo, shows: photo && command.args ? command.args : null };
  }
  if (!command.args) return usage("empty_ask");
  return { ...base, ask_message_id: message.message_id, text: command.args, photo: largest(message.photo), shows: null };
}

/** Deterministic, so Telegram redelivering an update cannot create a second ask. */
export const forwardIdFor = (ask: Pick<ParsedAsk, "chat_id" | "ask_message_id">): string => `tg:${ask.chat_id}:${ask.ask_message_id}`;
