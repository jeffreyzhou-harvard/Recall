/**
 * Telegram -> Recall. One update in, at most one forwarded ask out.
 *
 * LIVE ONLY - never on the judged path.
 *
 * This is an adapter and holds no policy of its own. It maps Telegram ids to
 * the people and thread the family set up, fetches the one photo if there is
 * one, and hands `RecallService.forwardAsk` exactly the payload intake expects.
 * Whether the asker is approved, the topic allowed, or the hour acceptable is
 * decided where it always is: the identity gate and the access policy.
 */
import type { AssetIndex } from "@/lib/provenance/assets";
import { sha256Bytes } from "@/lib/provenance/hash";
import type { ForwardOutcome, RecallService } from "@/lib/service/recall-service";
import type { TelegramClient, TgUpdate } from "./api";
import { unboundUser, type TelegramBindings } from "./bindings";
import type { TelegramThreadBridge } from "./bridge";
import { USAGE_TEXT, forwardIdFor, parseUpdate } from "./updates";

/** Keeps the bytes of a forwarded photo. Runtime media lives outside /assets, which is for hashed demo media only. */
export interface MediaStore {
  put(assetId: string, bytes: Uint8Array, extension: string): Promise<string>;
}

export type HandledUpdate =
  | { kind: "ignored"; reason: string }
  | { kind: "usage_sent" }
  | { kind: "forwarded"; forward_id: string; thread_id: string; outcome: ForwardOutcome };

export interface TelegramInboundDeps {
  client: TelegramClient;
  bridge: TelegramThreadBridge;
  service: RecallService;
  assets: AssetIndex;
  media: MediaStore;
  bindings: TelegramBindings;
  botUsername: string;
}

export class TelegramInbound {
  constructor(private readonly deps: TelegramInboundDeps) {}

  async handleUpdate(update: TgUpdate): Promise<HandledUpdate> {
    const { client, bridge, service, assets, media, bindings, botUsername } = this.deps;
    const parsed = parseUpdate(update, botUsername);
    if (parsed.kind === "ignored") return parsed;

    // A chat nobody set up gets no reply of any kind - not even usage help. Recall does not speak in
    // rooms it was not invited into by the joint setup.
    const chat = bindings.chats[String(parsed.chat_id)];
    if (!chat) return { kind: "ignored", reason: "this chat is not bound to a family thread" };

    if (parsed.kind === "usage") {
      await client.sendMessage(parsed.chat_id, USAGE_TEXT, { reply_to_message_id: parsed.reply_to_message_id });
      return { kind: "usage_sent" };
    }

    const forwardId = forwardIdFor(parsed);
    bridge.noteOrigin(forwardId, { chat_id: parsed.chat_id, message_id: parsed.ask_message_id });

    const photos: Array<{ asset_id: string; caption: string | null }> = [];
    if (parsed.photo) {
      const { bytes, path } = await client.downloadFile(parsed.photo.file_id);
      const assetId = `tg-${parsed.photo.file_unique_id}`;
      const extension = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1) : "jpg";
      assets.register({
        id: assetId,
        path: await media.put(assetId, bytes, extension),
        kind: "image",
        sha256: await sha256Bytes(bytes),
        bytes: bytes.byteLength,
        duration_ms: null,
        status: "final",
        description: "Photo forwarded with an ask",
      });
      photos.push({ asset_id: assetId, caption: parsed.shows });
    }

    const outcome = await service.forwardAsk({
      forward_id: forwardId,
      thread_id: chat.thread_id,
      asker_id: bindings.users[String(parsed.from_user_id)] ?? unboundUser(parsed.from_user_id),
      addressee_id: chat.addressee_id,
      text: parsed.text,
      photos,
      requested_audience: chat.thread_id,
      received_at: parsed.received_at,
    });
    return { kind: "forwarded", forward_id: forwardId, thread_id: chat.thread_id, outcome };
  }
}
