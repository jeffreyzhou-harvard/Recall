/** The only source fields sent to Muse or rendered by family graph questions. */
export type FamilyQuerySource = {
  id: string;
  kind: "moment" | "story" | "relationship";
  title: string;
  text: string;
  attribution: string;
  date: string | null;
  momentId: string | null;
};
export type FamilyQueryCitation = { sourceId: string; quote: string };
export type FamilyQueryResult = {
  mode: "muse" | "search";
  answer: { text: string; citations: FamilyQueryCitation[] }[];
  ideas: { question: string; sourceIds: string[] }[];
  sources: FamilyQuerySource[];
  limited: boolean;
};
