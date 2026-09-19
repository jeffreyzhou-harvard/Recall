/** The "Ask about Susan" box. Whatever is typed, the reply is the fixed redirect line (AGENTS.md rule 10). LIVE ONLY. */
import { getLiveRecall } from "@/server/recall-live";
import { bodyOf, guard } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const refused = guard(request);
  if (refused) return refused;
  const body = await bodyOf(request);
  if (!body || typeof body.question !== "string" || typeof body.member !== "string") return Response.json({ error: "expected { question, member }" }, { status: 400 });
  const { line, graph_content } = await (await getLiveRecall()).service.askAboutHer(body.question.slice(0, 2000), body.member);
  return Response.json({ line, graph_content });
}
