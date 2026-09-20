import { isAbsolute, join } from "node:path";
/** Point this at a persistent, private volume when deployed. */
export function dataDirectory(root: string): string {
  const configured = process.env.RECALL_DATA_DIR;
  return configured ? isAbsolute(configured) ? configured : join(root, configured) : join(root, ".data");
}
