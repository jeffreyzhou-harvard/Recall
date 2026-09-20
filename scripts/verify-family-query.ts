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
    const graphSources: FamilyQuerySource[] = [
      { id: "fictional-maya", kind: "person", title: "Maya", text: "Person in the family graph: Maya.", attribution: "Fictional test graph", date: null, momentId: null },
      { id: "fictional-family-tie", kind: "relationship", title: "Susan & Maya", text: "Maya is Susan’s daughter.", attribution: "Fictional test graph", date: null, momentId: null },
      { id: "fictional-garden-link", kind: "relationship", title: "Maya & Garden afternoon", text: "The family graph connects Maya to the photo group Garden afternoon. This does not establish attendance.", attribution: "Fictional test graph", date: null, momentId: null },
    ];
    const graphResult = await answerFamilySources("How is Maya related to Susan, and which photo group is Maya connected to? There are no recorded stories yet.", graphSources, new MuseSpark(key));
    if (!graphResult.answer.length || !graphResult.sources.some(source => source.id === "fictional-family-tie")
      || !graphResult.sources.some(source => source.id === "fictional-garden-link")) throw new Error("Missing base graph answer or supporting connections");
    console.log(`PASS: live Muse answered a graph-only question with ${graphResult.sources.length} cited source(s) and no recorded stories.`);
  } catch {
    console.error("FAIL: the live Muse family query did not return a valid cited answer and conversation ideas. No household data was used.");
    process.exitCode = 1;
  }
}
