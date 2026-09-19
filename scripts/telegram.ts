/**
 * Telegram bot operations. Reads .env.local if present.
 *
 *   npm run telegram -- whoami              check the token; print the bot's username
 *   npm run telegram -- setup               register /ask and /help with Telegram
 *   npm run telegram -- discover            print chat and user ids of incoming commands, replying to nobody
 *                                           (use this to fill in RELAY_TELEGRAM_BINDINGS)
 *   npm run telegram -- poll                run the bot by long polling: no public URL needed
 *   npm run telegram -- webhook <base-url>  point Telegram at <base-url>/api/telegram/webhook
 *   npm run telegram -- webhook:off         remove the webhook (required before `poll`)
 *
 * Leave the bot's group privacy mode ON in BotFather. With it on, Telegram only
 * delivers commands addressed to the bot and the one message a command replies
 * to, so the rest of the family's chat never reaches Relay at all.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { TelegramClient } from "@/lib/bridge/telegram/api";
import { ASK_COMMAND } from "@/lib/bridge/telegram/updates";
import { configFromEnv, createLiveRelay } from "@/server/relay-live";
import { ROOT } from "./lib/asset-tools";

for (const file of [".env.local", ".env"]) {
  if (existsSync(join(ROOT, file))) process.loadEnvFile(join(ROOT, file));
}

const [command = "help", arg] = process.argv.slice(2);
const token = process.env.TELEGRAM_BOT_TOKEN;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function client(): TelegramClient {
  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN is not set. Create a bot with @BotFather, then put the token in .env.local (see .env.example).");
    process.exit(1);
  }
  return new TelegramClient(token);
}

async function poll(discoverOnly: boolean): Promise<void> {
  const tg = client();
  const relay = discoverOnly ? null : await createLiveRelay(configFromEnv(process.env, ROOT));
  const me = await tg.getMe();
  console.log(discoverOnly ? `discovering ids for @${me.username} - send /${ASK_COMMAND} or /help in the chat you want to bind; nothing will be replied to` : `@${me.username} is polling (RELAY_CALL=${relay!.callMode}). Ctrl-C to stop.`);

  let offset: number | undefined;
  for (;;) {
    try {
      for (const update of await tg.getUpdates(offset, 25)) {
        offset = update.update_id + 1;
        const m = update.message;
        if (discoverOnly) {
          if (m) console.log(`chat ${m.chat.id} (${m.chat.type}${m.chat.title ? `, "${m.chat.title}"` : ""})  user ${m.from?.id} (${m.from?.first_name ?? "?"})`);
          continue;
        }
        const handled = await relay!.handle(update);
        const detail = handled.update.kind === "ignored" ? handled.update.reason : handled.update.kind === "forwarded" ? (handled.update.outcome.accepted ? `accepted ${handled.update.outcome.ask_id}` : `refused: ${handled.update.outcome.code}`) : "";
        console.log(`update ${update.update_id}: ${handled.update.kind}${detail ? ` (${detail})` : ""}${handled.recording ? ` -> ${handled.recording.final_state}` : ""}`);
        for (const failure of handled.recording?.delivery_failures ?? []) console.warn(`  not delivered: ${failure}`);
      }
    } catch (e) {
      console.error(`poll error: ${(e as Error).message}`);
      await sleep(3000);
    }
  }
}

switch (command) {
  case "whoami": {
    const me = await client().getMe();
    console.log(`@${me.username} (id ${me.id})`);
    break;
  }
  case "setup":
    await client().setMyCommands([
      { command: ASK_COMMAND, description: "Reply to your own question with this to ask with Relay" },
      { command: "help", description: "How to ask" },
    ]);
    console.log(`registered /${ASK_COMMAND} and /help. Keep group privacy mode ON in @BotFather.`);
    break;
  case "discover":
    await poll(true);
    break;
  case "poll":
    await poll(false);
    break;
  case "webhook": {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!arg || !/^https:\/\//.test(arg)) throw new Error("usage: npm run telegram -- webhook https://your-host  (Telegram requires https)");
    if (!secret || !/^[\w-]{16,256}$/.test(secret)) throw new Error("set TELEGRAM_WEBHOOK_SECRET to 16-256 characters of A-Z a-z 0-9 _ -");
    const url = `${arg.replace(/\/$/, "")}/api/telegram/webhook`;
    await client().setWebhook(url, secret);
    console.log(`webhook set: ${url}`);
    break;
  }
  case "webhook:off":
    await client().deleteWebhook();
    console.log("webhook removed");
    break;
  default:
    console.log("commands: whoami | setup | discover | poll | webhook <https-base-url> | webhook:off");
}
