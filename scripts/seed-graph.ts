/**
 * Build an on-disk LadybugDB graph: the family seed, plus the judged ask taken
 * in through real intake.
 *
 *   npm run graph:seed        ->  .data/recall.lbug
 *
 * The judged path never reads this database: it runs on the in-memory store.
 * This is persistence for the optional live side demo and for poking at the
 * graph with Cypher. It is rebuilt from /fixtures every time, so .data/ is
 * disposable and git-ignored.
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildFixtureRig } from "@/fixtures/harness";
import { LadybugGraphStore } from "@/lib/graph/ladybug-store";
import { NODE_LAYER } from "@/lib/graph/types";
import { ROOT } from "./lib/asset-tools";

const dir = join(ROOT, ".data");
const path = join(dir, "recall.lbug");
mkdirSync(dir, { recursive: true });
rmSync(path, { recursive: true, force: true });
rmSync(`${path}.wal`, { force: true });

const store = await LadybugGraphStore.open(path);
await buildFixtureRig({ graph: store }); // throws with the full problem list if the seed is invalid

const snapshot = await store.snapshot();
await store.close();

const byLayer = new Map<number, number>();
for (const node of snapshot.nodes) byLayer.set(NODE_LAYER[node.type], (byLayer.get(NODE_LAYER[node.type]) ?? 0) + 1);

console.log(`seeded ${path.slice(ROOT.length + 1)} (LadybugDB ${store.engineVersion})`);
console.log(`  ${snapshot.nodes.length} nodes, ${snapshot.edges.length} edges`);
for (const layer of [...byLayer.keys()].sort()) console.log(`  layer ${layer}: ${byLayer.get(layer)} node(s)`);
