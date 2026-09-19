/**
 * Telegram as the family's thread. No token and no network: `fetch` is a fake
 * that records what would have been sent to the Bot API.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TelegramClient, type FetchLike, type TgMessage, type TgUpdate } from "@/lib/bridge/telegram/api";
import { parseBindings, type TelegramBindings } from "@/lib/bridge/telegram/bindings";
import { TelegramThreadBridge } from "@/lib/bridge/telegram/bridge";
import { USAGE_TEXT, parseUpdate } from "@/lib/bridge/telegram/updates";
import { BridgeError, NOTICE_TEXT } from "@/lib/bridge/thread-bridge";
import { cutWav } from "@/lib/provenance/wav";
import { createLiveRelay } from "@/server/relay-live";
import { THREAD } from "./fixtures";

const ROOT = join(import.meta.dirname, "..");
const TOKEN = `123456:${"A".repeat(35)}`;
const BOT = "RelayTestBot";
const GROUP = -1001234567890;
const ANIKA = 111;
const NOW = "2026-11-05T17:30:00.000Z"; // Thursday 12:30 in New York: inside the call window
const SENT_AT = Date.parse("2026-11-05T17:25:00.000Z") / 1000;

const BINDINGS: TelegramBindings = {
  chats: { [String(GROUP)]: { thread_id: THREAD, addressee_id: "person:mom" } },
  users: { [String(ANIKA)]: "person:anika" },
};

interface Sent {
  method: string;
  fields: Record<string, unknown>;
}

/** A fake Bot API. Optionally fails one method, to stand in for Telegram being unreachable. */
function fakeTelegram(failMethod?: string): { fetchImpl: FetchLike; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const respond = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body, arrayBuffer: async () => new Uint8Array([9, 8, 7, 6]).buffer as ArrayBuffer });
    if (url.includes("/file/bot")) return respond(null);
    const method = url.slice(url.lastIndexOf("/") + 1);
    const fields: Record<string, unknown> =
      init?.body instanceof FormData ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : `<file ${(v as File).name} ${(v as File).size}b>`])) : JSON.parse((init?.body as string) ?? "{}");
    if (method !== "getMe") sent.push({ method, fields });
    if (method === failMethod) return respond({ ok: false, error_code: 502, description: "Bad Gateway" }, false);
    const results: Record<string, unknown> = { getMe: { id: 1, is_bot: true, first_name: "Relay", username: BOT }, getFile: { file_id: "f", file_unique_id: "u", file_path: "photos/file_7.jpg" } };
    return respond({ ok: true, result: results[method] ?? { message_id: 900 + sent.length, chat: { id: GROUP, type: "supergroup" }, date: SENT_AT } });
  };
  return { fetchImpl, sent };
}

const message = (over: Partial<TgMessage>): TgMessage => ({
  message_id: 50,
  from: { id: ANIKA, is_bot: false, first_name: "Anika" },
  chat: { id: GROUP, type: "supergroup", title: "Family" },
  date: SENT_AT,
  ...over,
});
const command = (text: string, over: Partial<TgMessage> = {}): TgUpdate => ({
  update_id: 1,
  message: message({ message_id: 51, text, entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }], ...over }),
});
const QUESTION = message({ caption: "Mom, which should I make for Diwali?", photo: [{ file_id: "small", file_unique_id: "u1", width: 90, height: 90 }, { file_id: "large", file_unique_id: "u1", width: 1280, height: 960 }] });
/** Anika replies to her own photo-and-question with /ask, saying what the photo shows. */
const THE_ASK = command("/ask kheer and halwa", { reply_to_message: QUESTION });

describe("reading an update", () => {
  it("takes the question, the one largest photo, and the asker's own description of it - and nothing else", () => {
    expect(parseUpdate(THE_ASK, BOT)).toEqual({
      kind: "ask",
      chat_id: GROUP,
      from_user_id: ANIKA,
      ask_message_id: 50, // replies attach to the question, not to the command
      text: "Mom, which should I make for Diwali?",
      photo: { file_id: "large", file_unique_id: "u1" },
      shows: "kheer and halwa",
      received_at: "2026-11-05T17:25:00.000Z",
    });
  });

  it("accepts a question written after the command when there is nothing to reply to", () => {
    expect(parseUpdate(command("/ask@RelayTestBot Mom, kheer or halwa?"), BOT)).toMatchObject({ kind: "ask", ask_message_id: 51, text: "Mom, kheer or halwa?", photo: null, shows: null });
  });

  it("ignores ordinary chat, other bots' commands, bots, channels, and edits: only a command addressed to it counts", () => {
    const ignored = (u: TgUpdate) => parseUpdate(u, BOT).kind;
    expect(ignored({ update_id: 1, message: message({ text: "what time is dinner?" }) })).toBe("ignored");
    expect(ignored(command("/ask@SomeOtherBot hello"))).toBe("ignored");
    expect(ignored(command("/ask hi", { from: { id: 5, is_bot: true, first_name: "bot" } }))).toBe("ignored");
    expect(ignored(command("/ask hi", { chat: { id: 9, type: "channel" } }))).toBe("ignored");
    expect(ignored({ update_id: 2 })).toBe("ignored");
  });

  it("will not make someone the asker by pointing at their message: you forward your own question", () => {
    const someoneElses = command("/ask", { reply_to_message: message({ from: { id: 222, is_bot: false, first_name: "Rohan" }, text: "Mom, call me?" }) });
    expect(parseUpdate(someoneElses, BOT)).toMatchObject({ kind: "usage", reason: "not_your_message" });
    expect(parseUpdate(command("/ask"), BOT)).toMatchObject({ kind: "usage", reason: "empty_ask" });
  });
});

describe("bindings", () => {
  it("come from the environment and are validated", () => {
    expect(parseBindings(JSON.stringify(BINDINGS))).toEqual(BINDINGS);
    expect(parseBindings(undefined)).toEqual({ chats: {}, users: {} });
    expect(() => parseBindings('{"chats":{"family":{"thread_id":"t","addressee_id":"p"}},"users":{}}')).toThrow(/integers/);
    expect(() => parseBindings("{not json")).toThrow(/not valid JSON/);
  });
});

describe("a forward arriving from Telegram", () => {
  const live = async (over: { bindings?: TelegramBindings; callMode?: "none" | "prerecorded"; failMethod?: string } = {}) => {
    const tg = fakeTelegram(over.failMethod);
    const relay = await createLiveRelay({ token: TOKEN, bindings: over.bindings ?? BINDINGS, callMode: over.callMode ?? "none", root: ROOT, fetchImpl: tg.fetchImpl, now: NOW });
    return { relay, sent: tg.sent };
  };

  it("goes through real intake: the photo is fetched, hashed, and the ask is understood from her own words", async () => {
    const { relay, sent } = await live();
    const { update } = await relay.handle(THE_ASK);
    expect(update).toMatchObject({ kind: "forwarded", forward_id: `tg:${GROUP}:50`, thread_id: THREAD, outcome: { accepted: true, created: true } });
    if (update.kind !== "forwarded" || !update.outcome.accepted) throw new Error("unreachable");
    expect(update.outcome.interpretation).toMatchObject({ option_topic_ids: ["topic:kheer", "topic:halwa"], subject_topic_ids: ["topic:dessert"], event_ids: ["event:diwali-2026"] });
    expect(sent.map((s) => s.method)).toEqual(["getFile"]); // intake-only mode says nothing to the family
  });

  it("is idempotent when Telegram redelivers the same update", async () => {
    const { relay } = await live();
    await relay.handle(THE_ASK);
    expect((await relay.handle(THE_ASK)).update).toMatchObject({ kind: "forwarded", outcome: { accepted: true, created: false } });
  });

  it("says nothing at all in a chat nobody set up - not even usage help", async () => {
    const { relay, sent } = await live({ bindings: { chats: {}, users: BINDINGS.users } });
    expect((await relay.handle(THE_ASK)).update).toEqual({ kind: "ignored", reason: "this chat is not bound to a family thread" });
    expect((await relay.handle(command("/help"))).update.kind).toBe("ignored");
    expect(sent).toEqual([]);
  });

  it("asks the family to clarify, under the question, when the sender is someone the setup does not know", async () => {
    const { relay, sent } = await live({ bindings: { chats: BINDINGS.chats, users: {} } });
    expect((await relay.handle(THE_ASK)).update).toMatchObject({ kind: "forwarded", outcome: { accepted: false, code: "unknown_party", clarify_posted: true } });
    expect(sent.at(-1)).toEqual({ method: "sendMessage", fields: { chat_id: GROUP, text: NOTICE_TEXT.clarify, reply_parameters: { message_id: 50, allow_sending_without_reply: true } } });
  });

  it("answers /help with fixed usage text, as a reply to the command", async () => {
    const { relay, sent } = await live();
    expect((await relay.handle(command("/help"))).update).toEqual({ kind: "usage_sent" });
    expect(sent).toEqual([{ method: "sendMessage", fields: { chat_id: GROUP, text: USAGE_TEXT, reply_parameters: { message_id: 51, allow_sending_without_reply: true } } }]);
  });

  it("with the prerecorded call: her voice card lands under the question, and the receipt goes to Anika privately", async () => {
    const { relay, sent } = await live({ callMode: "prerecorded" });
    const { recording } = await relay.handle(THE_ASK);
    expect(recording).toMatchObject({ final_state: "delivered", delivery_failures: [] });

    const [, card, receipt] = sent;
    expect(card!.method).toBe("sendDocument"); // a WAV cut straight from the source; OGG/Opus would make it a voice bubble
    expect(card!.fields).toMatchObject({ chat_id: String(GROUP), reply_parameters: JSON.stringify({ message_id: 50, allow_sending_without_reply: true }) });
    expect(card!.fields.caption).toBe(
      ["Mom, in her own voice:", "“Make the kheer. Your grandfather always added cardamom last.”", "", "Source: live call", "Edited: 3 pauses trimmed, 0 words generated", "Approved by Mom's voice"].join("\n"),
    );
    expect(card!.fields.document).toMatch(/^<file mom-answer\.wav \d+b>$/);
    expect(receipt).toMatchObject({ method: "sendMessage", fields: { chat_id: ANIKA } }); // her private chat, never the group
    expect(receipt!.fields.text).toContain("Mom answered Anika directly.");
    expect(sent).toHaveLength(3);
  });

  it("ends safely, sends nothing, and records why when Telegram cannot be reached at delivery", async () => {
    const { relay } = await live({ callMode: "prerecorded", failMethod: "sendDocument" });
    const { recording } = await relay.handle(THE_ASK);
    expect(recording!.final_state).toBe("not_sent");
    expect(recording!.messages.map((m) => m.kind)).toEqual(["family_notice"]);
    expect(recording!.delivery_failures).toEqual([expect.stringContaining("Bad Gateway")]);
    expect(recording!.provenance_receipt).toBeNull();
  });
});

describe("the Telegram bridge", () => {
  it("inherits the guard: it cannot send anything that is not a reply to a forward it received", async () => {
    const { fetchImpl, sent } = fakeTelegram();
    const bridge = new TelegramThreadBridge(new TelegramClient(TOKEN, fetchImpl), BINDINGS);
    const notice = { kind: "family_notice" as const, in_reply_to: "tg:1:1", to: { thread_id: THREAD }, notice: "not_this_time" as const, text: NOTICE_TEXT.not_this_time, authored_by: "relay" as const };
    await expect(bridge.post(notice, NOW)).rejects.toBeInstanceOf(BridgeError);
    bridge.registerForward("tg:1:1", THREAD);
    await expect(bridge.post({ ...notice, text: "She seemed tired." }, NOW)).rejects.toThrow(/fixed wording/);
    expect(sent).toEqual([]);
  });

  it("refuses a malformed token before making any request", () => {
    expect(() => new TelegramClient("not-a-token")).toThrow(/does not look like a bot token/);
  });
});

describe("cutting the recording to the kept spans", () => {
  const wav = (samples: number[]): Uint8Array => {
    const out = new Uint8Array(44 + samples.length);
    const v = new DataView(out.buffer);
    [..."RIFF"].forEach((c, i) => (out[i] = c.charCodeAt(0)));
    v.setUint32(4, 36 + samples.length, true);
    [..."WAVEfmt "].forEach((c, i) => (out[8 + i] = c.charCodeAt(0)));
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, 1000, true); // 1000 samples per second, one byte each: 1 ms = 1 byte
    v.setUint32(28, 1000, true);
    v.setUint16(32, 1, true);
    v.setUint16(34, 8, true);
    [..."data"].forEach((c, i) => (out[36 + i] = c.charCodeAt(0)));
    v.setUint32(40, samples.length, true);
    out.set(samples, 44);
    return out;
  };
  const source = wav(Array.from({ length: 100 }, (_, i) => i));

  it("copies her samples byte for byte, in order, and nothing else", () => {
    const cut = cutWav(source, [{ start_ms: 10, end_ms: 20 }, { start_ms: 50, end_ms: 55 }])!;
    expect([...cut.subarray(44)]).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 50, 51, 52, 53, 54]);
    expect(new DataView(cut.buffer).getUint32(40, true)).toBe(15);
    expect([...source.subarray(44, 50)]).toEqual([0, 1, 2, 3, 4, 5]); // the source is untouched
  });

  it("refuses to reorder or overlap her words, or to read past the recording", () => {
    expect(() => cutWav(source, [{ start_ms: 50, end_ms: 60 }, { start_ms: 10, end_ms: 20 }])).toThrow(/never reordered/);
    expect(() => cutWav(source, [{ start_ms: 90, end_ms: 200 }])).toThrow(/outside the recording/);
  });

  it("returns null rather than guess when the source is not PCM WAV", () => {
    expect(cutWav(new Uint8Array(64), [{ start_ms: 0, end_ms: 10 }])).toBeNull();
  });
});
