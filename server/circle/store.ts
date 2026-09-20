import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import { dataDirectory } from "../data-directory";
import type { Moment, Photo, Story } from "@/lib/archive/types";
import type { FaceIndex } from "@/lib/people/types";
export type CirclePhoto = Photo & {
  hash: string;
  latitude: number | null;
  longitude: number | null;
  namedPeople: string[];
  owner: string;
};
export type CircleMoment = Moment & {
  question: string;
  titleSource: "ai" | "metadata" | "family";
  peopleCount: number;
  analysis: "complete" | "unavailable";
  participantIds: string[];
  evidence: string[];
};
export type CircleState = {
  faceIndex?: FaceIndex;
  photos: CirclePhoto[];
  moments: CircleMoment[];
  stories: (Story & { owner: string; requestId: string; sharedFromCall?: string })[];
  imports: {
    id: string;
    at: string;
    added: number;
    duplicates: number;
    moments: number;
    owner?: string;
    rejected?: { name: string; reason: string }[];
    momentIds?: string[];
    warning?: string | null;
  }[];
  demo: boolean;
  demoCall?: { topics: Record<string, string>; sharedContributions: string[] };
  drafts?: {
    id: string;
    owner: string;
    mime: string;
    text: string;
    createdAt: string;
  }[];
};
export const emptyCircle = (): CircleState => ({
  photos: [],
  moments: [],
  stories: [],
  imports: [],
  demo: false,
});
export const circleRoot = () =>
  path.join(dataDirectory(process.cwd()), "circle");
export function withCircleDb<T>(work: (db: DatabaseSync) => T): T {
  const file =
    process.env.RECALL_CIRCLE_DB || path.join(circleRoot(), "circle.db");
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  try {
    chmodSync(file, 0o600);
    db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS circles (household TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS logins (email TEXT PRIMARY KEY, member TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS links (hash TEXT PRIMARY KEY, household TEXT NOT NULL, member TEXT, invitation TEXT, name TEXT NOT NULL, phone TEXT, role TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER, destination TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS contacts (member TEXT PRIMARY KEY, household TEXT NOT NULL, phone TEXT, reminders INTEGER NOT NULL DEFAULT 0, next_at INTEGER, last_moment TEXT, error TEXT, paused INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, start INTEGER NOT NULL);`);
    const columns = db.prepare("PRAGMA table_info(links)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "account_verifier"))
      db.exec("ALTER TABLE links ADD COLUMN account_verifier TEXT");
    return work(db);
  } finally {
    db.close();
  }
}
export function readCircle(household: string): CircleState {
  return withCircleDb((db) => {
    const row = db
      .prepare("SELECT state FROM circles WHERE household=?")
      .get(household) as { state: string } | undefined;
    return row ? JSON.parse(row.state) : emptyCircle();
  });
}
export function updateCircle<T>(
  household: string,
  work: (state: CircleState) => T,
): T {
  return withCircleDb((db) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db
        .prepare("SELECT state FROM circles WHERE household=?")
        .get(household) as { state: string } | undefined;
      const state: CircleState = row ? JSON.parse(row.state) : emptyCircle();
      const result = work(state);
      db.prepare(
        "INSERT INTO circles VALUES (?,?) ON CONFLICT(household) DO UPDATE SET state=excluded.state",
      ).run(household, JSON.stringify(state));
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });
}
export class CircleError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function limit(key: string, max = 8, windowMs = 15 * 60_000) {
  withCircleDb((db) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db
        .prepare("SELECT count,start FROM attempts WHERE key=?")
        .get(key) as { count: number; start: number } | undefined;
      const fresh = !row || Date.now() - row.start > windowMs;
      if (!fresh && row.count >= max)
        throw new CircleError(
          "Please wait a few minutes before trying again.",
          429,
        );
      db.prepare(
        "INSERT INTO attempts VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,start=excluded.start",
      ).run(key, fresh ? 1 : row.count + 1, fresh ? Date.now() : row.start);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });
}
