/** Explicit live-provider check; fictional sources only, no household or graph writes. */
import { answerFamilySources } from "../server/circle/graph-query";
import { MuseSpark } from "../lib/providers/muse/spark";
import type { FamilyQuerySource } from "../lib/knowledge/family-query";

const key = process.env.MUSE_API_KEY?.trim();
if (!key) {
  console.log("SKIPPED: MUSE_API_KEY is not configured.");
  process.exitCode = 1;
} else {
  const sources: FamilyQuerySource[] = [{ id: "fictional-cape-may", kind: "story", title: "Cape May summer",
    text: "We built a sandcastle beside the pier in Cape May.", attribution: "Maya · fictional test story", date: null, momentId: null }];
  try {
    const result = await answerFamilySources("What story mentions Cape May, and what could we talk about together?", sources, new MuseSpark(key));
    if (!result.answer.length || !result.sources.length || !result.ideas.length) throw new Error("Missing answer, sources or ideas");
    console.log(`PASS: live Muse returned ${result.answer.length} cited answer paragraph(s), ${result.sources.length} source(s), and ${result.ideas.length} conversation idea(s).`);
  } catch {
    console.error("FAIL: the live Muse family query did not return a valid cited answer and conversation ideas. No household data was used.");
    process.exitCode = 1;
  }
}
