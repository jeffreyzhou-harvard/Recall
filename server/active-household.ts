import { dataDirectory } from "./data-directory";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export function activeHousehold(root = process.cwd()): string | undefined {
  if (process.env.RECALL_HOUSEHOLD) return process.env.RECALL_HOUSEHOLD;
  const file = join(dataDirectory(root), "active-household.json");
  if (!existsSync(file)) return undefined;
  const value: unknown = JSON.parse(readFileSync(file, "utf8"));
  return typeof value === "string" && value ? value : undefined;
}
export function selectHousehold(id: string, root = process.cwd()): void {
  if (process.env.RECALL_HOUSEHOLD && process.env.RECALL_HOUSEHOLD !== id) throw new Error("This server is configured for another household.");
  const folder = dataDirectory(root);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const file = join(folder, "active-household.json");
  writeFileSync(file + ".tmp", JSON.stringify(id), { mode: 0o600 });
  renameSync(file + ".tmp", file);
}
