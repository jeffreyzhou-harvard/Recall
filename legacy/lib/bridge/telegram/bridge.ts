/**
 * Telegram as the family's thread: the transport behind the shared guard.
 *
 * LIVE ONLY - never on the judged path. Whether a message may be sent is
 * decided by GuardedThreadBridge (no autonomous outreach; replies go only to
 * the ask's own thread; notices carry only their fixed wording). This class
 * only knows how to say an allowed thing on Telegram, and it says everything
 * as a reply to the message that carried the ask.
 */
import { BridgeError, GuardedThreadBridge, type SupportReceipt, type ThreadMessage, type VoiceCard } from "../thread-bridge";
import { TelegramApiError, type OutboundFile, type TelegramClient } from "./api";
import { chatIdForPerson, type TelegramBindings } from "./bindings";

/** Where a forward came from on Telegram, so Relay's answer lands directly under the question. */
export interface TelegramOrigin {
  chat_id: number;
  message_id: number;
}

/** Produces the audio of a voice card: the kept spans of her recording. Null means text only. */
export type RecordingProvider = (card: VoiceCard) => Promise<OutboundFile | null>;

/** Her words first, in quotation marks, unchanged. The rows under them are the card's own provenance rows. */
export function voiceCardText(card: VoiceCard): string {
  return [`${card.speaker_name}, in her own voice:`, `“${card.literal_transcript}”`, "", ...card.provenance_rows].join("\n");
}

export function supportReceiptText(receipt: SupportReceipt): string {
  return ["What Relay made possible:", ...receipt.lines.map((l) => `• ${l.text}`)].join("\n");
}

export class TelegramThreadBridge extends GuardedThreadBridge {
  private readonly origins = new Map<string, TelegramOrigin>();

  constructor(
    private readonly client: TelegramClient,
    private readonly bindings: TelegramBindings,
    private readonly recording: RecordingProvider = async () => null,
  ) {
    super();
  }

  /** Called by the inbound side for every forward, before intake, so even a refusal can be answered in place. */
  noteOrigin(forwardId: string, origin: TelegramOrigin): void {
    this.origins.set(forwardId, origin);
  }

  protected async deliver(message: ThreadMessage): Promise<void> {
    const origin = this.origins.get(message.in_reply_to);
    if (!origin) throw new BridgeError(`no Telegram message is on record for forward "${message.in_reply_to}"`);
    try {
      switch (message.kind) {
        case "family_notice":
          await this.client.sendMessage(origin.chat_id, message.text, { reply_to_message_id: origin.message_id });
          return;
        case "voice_contribution": {
          const text = voiceCardText(message.card);
          const audio = await this.recording(message.card);
          if (audio) await this.client.sendRecording(origin.chat_id, audio, text, { reply_to_message_id: origin.message_id });
          else await this.client.sendMessage(origin.chat_id, text, { reply_to_message_id: origin.message_id });
          return;
        }
        case "support_receipt": {
          // Privately, to the named relative - never into the group. Telegram only allows this once
          // that person has started the bot themselves; until then it fails, and says so.
          const chatId = chatIdForPerson(this.bindings, message.to.person_id);
          if (chatId === null) throw new BridgeError(`${message.to.person_id} has no Telegram account bound, so the support receipt cannot be sent`);
          await this.client.sendMessage(chatId, supportReceiptText(message.receipt));
          return;
        }
      }
    } catch (e) {
      if (e instanceof TelegramApiError) throw new BridgeError(e.message);
      throw e;
    }
  }
}
