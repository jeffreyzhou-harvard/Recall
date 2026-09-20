/** Suggestions for the shared photo collection, never patient-call graph identities. */
export const FACE_MODEL = "face-api-1.7.15-ssd-landmark68-recognition-v1";
export type FaceBox = { x: number; y: number; width: number; height: number };
export type FaceDetection = { box: FaceBox; descriptor: number[]; score: number };
export type IndexedFace = FaceDetection & { id: string; photoId: string; groupId: string };
export type FaceGroup = { id: string; name: string; labeledBy?: string; labeledAt?: string };
export type FaceIndex = { model: string; generation: string; revision: number; scannedPhotoIds: string[]; faces: IndexedFace[]; groups: FaceGroup[] };
export type FacePreview = Pick<IndexedFace, "id" | "photoId" | "box">;
export type PeopleGroup = FaceGroup & { faces: FacePreview[]; photoIds: string[] };
export type PeopleView = { generation: string; revision: number; scannedPhotoIds: string[]; groups: PeopleGroup[] };
export const emptyFaceIndex = (): FaceIndex => ({ model: FACE_MODEL, generation: "initial", revision: 0, scannedPhotoIds: [], faces: [], groups: [] });
