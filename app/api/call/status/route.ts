/** Public capability only. No household identity, graph data, or call initiation is exposed. */
export const dynamic = "force-dynamic";
export async function GET(): Promise<Response> {
  return Response.json({ status: "unavailable", message: "There is no call to answer right now." }, { headers: { "Cache-Control": "no-store" } });
}
