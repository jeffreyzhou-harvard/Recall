/** Explicit live Muse check. Only fictional fixture text is sent; no household is opened. */
import assert from "node:assert/strict";
import { MuseGraphExtractor } from "../lib/providers/muse/graph";
import { MuseSpark, requireMuseKey } from "../lib/providers/muse/spark";
const text = "Maya visited Cape May.";
const extractor = new MuseGraphExtractor(new MuseSpark(requireMuseKey(process.env.MUSE_API_KEY)));
const result = await extractor.extract({ claim_id: "claim:provider-check", source_id: "artifact:provider-check", author: "person:maya", text, known: [{ id: "person:maya", type: "Person", name: "Maya" }, { id: "place:cape-may", type: "Place", name: "Cape May" }] });
assert.ok(result.entities.some((e) => e.name === "Maya"));
assert.ok(result.entities.some((e) => e.name === "Cape May"));
for (const entity of result.entities) assert.equal(text.slice(entity.start, entity.end), entity.name);
for (const relation of result.relations) assert.equal(text.slice(relation.start, relation.end), relation.quote);
console.log(`Muse graph extraction verified: ${result.entities.length} literal entity spans; ${result.relations.length} relation proposals. No household data used or stored.`);
