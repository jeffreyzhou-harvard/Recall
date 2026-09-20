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
};
export type FamilyLibrary = { photos: Photo[]; moments: Moment[]; stories: Story[] };
export type ArchiveView = FamilyLibrary;
