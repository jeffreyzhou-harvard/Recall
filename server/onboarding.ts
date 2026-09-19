/**
 * The onboarding database, held for the life of the server. LIVE ONLY: nothing on the judged path opens a
 * database file (AGENTS.md section 9).
 *
 * It is one SQLite file - Node's own `node:sqlite`, so there is no new dependency and no service to run -
 * under the git-ignored `.data/`. RECALL_ONBOARDING_DB moves it.
 *
 * An invitation's token is made here, not in /lib, because it has to be random: /lib only ever sees its hash.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { SystemClock } from "@/lib/clock";
import { Onboarding } from "@/lib/onboarding/onboarding";
import { SqliteOnboardingStore } from "@/lib/onboarding/sqlite-store";

export const DEFAULT_ONBOARDING_DB = join(".data", "onboarding.db");

export function openOnboarding(root: string, file: string = DEFAULT_ONBOARDING_DB): Onboarding {
  const path = isAbsolute(file) ? file : join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  return new Onboarding(SqliteOnboardingStore.open(path), new SystemClock());
}

const cache = globalThis as unknown as { __recallOnboarding?: Onboarding };
export function getOnboarding(): Onboarding {
  cache.__recallOnboarding ??= openOnboarding(process.cwd(), process.env.RECALL_ONBOARDING_DB || DEFAULT_ONBOARDING_DB);
  return cache.__recallOnboarding;
}

export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/** Shown once, to whoever sent the invitation. Only the hash is kept. */
export function newInvitationToken(): { token: string; token_hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, token_hash: hashToken(token) };
}
