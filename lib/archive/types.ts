/** Narrow contributor-owned library DTOs. No patient claims or graph snapshot. */
export type Photo = {
  id: string; name: string; url: string; capturedAt: string | null;
  contributor: string; addedAt: string; demo?: boolean; width?: number; height?: number; caption?: string;
};
export type Moment = {
  id: string; title: string; place: string; photoIds: string[]; coverId: string;
  startAt: string | null; endAt: string | null; latitude: number | null; longitude: number | null;
  people: string[]; description: string; revision: number;
};
export type Story = {
  id: string; eventId: string; author: string; text: string; audioUrl?: string;
  createdAt: string; source: "voice" | "written";
  /** Narrow provenance for this exact shared line, never a private graph snapshot. */
  callEvidence?: {
    edgeType: string;
    properties: Record<string, string | number | boolean | null>;
    source: string;
    author: string;
    recordedAt: string;
    status: string;
    shareConfirmedAt: string;
  };
};
export type FamilyLibrary = { photos: Photo[]; moments: Moment[]; stories: Story[] };
export type ArchiveView = FamilyLibrary;

/** Explicitly sourced people and ties, separate from photo identification or patient claims. */
export type FamilyConnections = {
  source: string;
  people: { name: string; momentIds: string[] }[];
  relationships: { from: string; to: string; label: string; relation?: string }[];
};
