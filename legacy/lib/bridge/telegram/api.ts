/**
 * A minimal, typed client for the Telegram Bot API (https://core.telegram.org/bots/api).
 * No dependency: it is a thin layer over `fetch`, which is injected so tests
 * never need a token or a network.
 *
 * LIVE ONLY. This is the one file under /lib allowed to make a network call,
 * and nothing on the judged path may import anything under lib/bridge/telegram
 * (a test enforces both). The judged path talks to MemoryThreadBridge.
 *
 * Only the handful of methods Recall uses are modeled, and only the fields it
 * reads. Recall subscribes to `message` updates alone - not edits, reactions,
 * member changes, or anything else Telegram could tell it about the chat.
 */

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TgChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
}

export interface TgPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TgMessageEntity {
  type: string;
  offset: number;
  length: number;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  /** Unix time, seconds. */
  date: number;
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
  entities?: TgMessageEntity[];
  caption_entities?: TgMessageEntity[];
  reply_to_message?: TgMessage;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

export interface TgFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

/** The only update type Recall asks Telegram for. */
export const ALLOWED_UPDATES = ["message"] as const;

/** The header Telegram echoes on every webhook call when a secret was set with setWebhook. */
export const WEBHOOK_SECRET_HEADER = "x-telegram-bot-api-secret-token";

export class TelegramApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly code: number | null,
    description: string,
  ) {
    super(`Telegram ${method} failed${code ? ` (${code})` : ""}: ${description}`);
    this.name = "TelegramApiError";
  }
}

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | FormData }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

interface Reply {
  /** Reply to this message, so everything Recall says sits under the ask it answers. */
  reply_to_message_id?: number;
}

export interface OutboundFile {
  bytes: Uint8Array;
  filename: string;
  mime: string;
}

export class TelegramClient {
  private readonly base: string;
  private readonly fileBase: string;

  constructor(
    token: string,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    apiRoot = "https://api.telegram.org",
  ) {
    if (!/^\d+:[\w-]{30,}$/.test(token)) throw new Error("TELEGRAM_BOT_TOKEN does not look like a bot token (expected <digits>:<secret>)");
    this.base = `${apiRoot}/bot${token}`;
    this.fileBase = `${apiRoot}/file/bot${token}`;
  }

  private async call<T>(method: string, body: Record<string, unknown> | FormData): Promise<T> {
    const isForm = body instanceof FormData;
    const res = await this.fetchImpl(`${this.base}/${method}`, {
      method: "POST",
      ...(isForm ? { body } : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    const payload = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string; error_code?: number } | null;
    if (!payload?.ok) throw new TelegramApiError(method, payload?.error_code ?? res.status, payload?.description ?? "no response body");
    return payload.result as T;
  }

  private static reply(id: number | undefined): Record<string, unknown> {
    return id === undefined ? {} : { reply_parameters: { message_id: id, allow_sending_without_reply: true } };
  }

  getMe(): Promise<TgUser> {
    return this.call("getMe", {});
  }

  setMyCommands(commands: Array<{ command: string; description: string }>): Promise<true> {
    return this.call("setMyCommands", { commands });
  }

  setWebhook(url: string, secretToken: string): Promise<true> {
    return this.call("setWebhook", { url, secret_token: secretToken, allowed_updates: ALLOWED_UPDATES, drop_pending_updates: true });
  }

  deleteWebhook(): Promise<true> {
    return this.call("deleteWebhook", { drop_pending_updates: false });
  }

  /** Long polling. `timeoutSeconds` is how long Telegram holds the request open when there is nothing new. */
  getUpdates(offset: number | undefined, timeoutSeconds: number): Promise<TgUpdate[]> {
    return this.call("getUpdates", { offset, timeout: timeoutSeconds, allowed_updates: ALLOWED_UPDATES });
  }

  sendMessage(chatId: number, text: string, options: Reply = {}): Promise<TgMessage> {
    return this.call("sendMessage", { chat_id: chatId, text, ...TelegramClient.reply(options.reply_to_message_id) });
  }

  /**
   * Send her recording. Telegram shows a voice bubble only for OGG/Opus, and an audio player only
   * for MP3/M4A; anything else (a WAV cut straight from the source) goes as a playable document.
   */
  sendRecording(chatId: number, file: OutboundFile, caption: string, options: Reply = {}): Promise<TgMessage> {
    const [method, field] =
      file.mime === "audio/ogg" ? ["sendVoice", "voice"] : file.mime === "audio/mpeg" || file.mime === "audio/mp4" ? ["sendAudio", "audio"] : ["sendDocument", "document"];
    const form = new FormData();
    form.set("chat_id", String(chatId));
    form.set("caption", caption);
    if (options.reply_to_message_id !== undefined) {
      form.set("reply_parameters", JSON.stringify({ message_id: options.reply_to_message_id, allow_sending_without_reply: true }));
    }
    const copy = new Uint8Array(file.bytes.byteLength);
    copy.set(file.bytes);
    form.set(field!, new Blob([copy.buffer], { type: file.mime }), file.filename);
    return this.call(method!, form);
  }

  /** Download a file Telegram is holding, by id. Used for the one photo forwarded with an ask, and nothing else. */
  async downloadFile(fileId: string): Promise<{ bytes: Uint8Array; path: string }> {
    const file = await this.call<TgFile>("getFile", { file_id: fileId });
    if (!file.file_path) throw new TelegramApiError("getFile", null, "Telegram returned no file_path");
    const res = await this.fetchImpl(`${this.fileBase}/${file.file_path}`);
    if (!res.ok) throw new TelegramApiError("download", res.status, `could not download ${file.file_path}`);
    return { bytes: new Uint8Array(await res.arrayBuffer()), path: file.file_path };
  }
}
