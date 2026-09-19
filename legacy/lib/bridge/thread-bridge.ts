/**
 * The bridge to the family's existing thread.
 *
 * Recall does not own a chat surface. A relative forwards one ask out of the
 * thread the family already uses; Recall replies into that same thread. This
 * file is the whole of that seam, and it is deliberately neutral: there is no
 * branded or mocked messaging integration behind it on the judged path
 * (product flow spec, "Telegram bot" row). A real transport implements
 * `ThreadBridge`; nothing else in Recall knows which one it is.
 *
 * Rule 5, no autonomous outreach, is enforced here rather than trusted to
 * callers: every outbound message must be a reply to a forward this bridge
 * actually received, and must go back to that forward's own thread or to a
 * person the policy named. Recall has no way to start a conversation.
 */
import type { MediaSpan } from "@/lib/graph/types";

/** What lands in the family's thread on success. Her words, her audio, and the receipt rows - nothing generated. */
export interface VoiceCard {
  delivery_id: string;
  thread_id: string;
  speaker_id: string;
  speaker_name: string;
  delivered_at: string;
  literal_transcript: string;
  audio: { asset_id: string; source_sha256: string; kept: MediaSpan[] };
  content_hash: string;
  provenance_rows: string[];
}

/**
 * The two things Recall itself may say to the family. Both are fixed, both are
 * labeled as Recall, and neither says anything about her: the words are the
 * same whatever the reason the ask did not complete.
 */
export const NOTICE_TEXT = {
  /** Identity, audience, or evidence was missing: stop safely and ask the family to clarify. */
  clarify: "Recall needs a bit more detail before it can pass this along. Could you clarify and send it again?",
  /** Anything else that ended without a delivery. */
  not_this_time: "Not this time. You're welcome to ask again.",
} as const;
export type FamilyNotice = keyof typeof NOTICE_TEXT;

/** A short, non-clinical account of the support Recall gave. Goes to approved relatives only, never to the thread. */
export interface SupportReceipt {
  session_id: string;
  lines: Array<{ dimension: "social" | "emotional" | "intellectual"; text: string; citations: string[] }>;
  scaffolds_logged: number;
}

interface Reply {
  /** The forward this answers. A message with no forward to answer cannot be sent. */
  in_reply_to: string;
}

export type ThreadMessage =
  | (Reply & { kind: "voice_contribution"; to: { thread_id: string }; card: VoiceCard })
  | (Reply & { kind: "family_notice"; to: { thread_id: string }; notice: FamilyNotice; text: string; authored_by: "recall" })
  | (Reply & { kind: "support_receipt"; to: { person_id: string }; receipt: SupportReceipt });

export type PostedMessage = ThreadMessage & { posted_at: string };

export class BridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeError";
  }
}

export interface ThreadBridge {
  /** Record that a forward arrived from a thread. Only a received forward can be replied to. */
  registerForward(forwardId: string, threadId: string): void;
  post(message: ThreadMessage, postedAt: string): Promise<void>;
  posted(): PostedMessage[];
}

/**
 * The guard every bridge shares. A transport only has to say how to deliver a message; whether a
 * message may be sent at all is decided here, once, and cannot be skipped by a subclass: `post`
 * checks first, delivers second, and records only what was actually delivered.
 */
export abstract class GuardedThreadBridge implements ThreadBridge {
  private readonly forwards = new Map<string, string>();
  private readonly messages: PostedMessage[] = [];

  registerForward(forwardId: string, threadId: string): void {
    this.forwards.set(forwardId, threadId);
  }

  /** Deliver a message that has already passed the guard. Throw BridgeError if it could not be delivered. */
  protected abstract deliver(message: ThreadMessage, originThreadId: string): Promise<void>;

  async post(message: ThreadMessage, postedAt: string): Promise<void> {
    const origin = this.forwards.get(message.in_reply_to);
    if (origin === undefined) {
      throw new BridgeError(`refusing to send: "${message.in_reply_to}" is not a forward this bridge received (no autonomous outreach)`);
    }
    if ("thread_id" in message.to && message.to.thread_id !== origin) {
      throw new BridgeError(`refusing to send: a reply goes only to the thread the ask came from ("${origin}")`);
    }
    if (message.kind === "family_notice" && message.text !== NOTICE_TEXT[message.notice]) {
      throw new BridgeError("refusing to send: a family notice carries only its fixed wording");
    }
    await this.deliver(message, origin);
    this.messages.push(structuredClone({ ...message, posted_at: postedAt }));
  }

  posted(): PostedMessage[] {
    return structuredClone(this.messages);
  }

  voiceCards(): VoiceCard[] {
    return this.posted().flatMap((m) => (m.kind === "voice_contribution" ? [m.card] : []));
  }
}

/** In-process bridge with nowhere to deliver to. The judged path uses this; the family-thread pane reads `posted()`. */
export class MemoryThreadBridge extends GuardedThreadBridge {
  protected async deliver(): Promise<void> {}
}
