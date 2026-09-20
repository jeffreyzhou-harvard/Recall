import { FACE_MODEL, type FaceDetection } from "@/lib/people/types";
type FaceApi = typeof import("@vladmandic/face-api/dist/face-api.esm.js");
let loading: Promise<FaceApi> | null = null;
async function loadDetector() {
  if (!loading) loading = (async () => {
    const api = await import("@vladmandic/face-api/dist/face-api.esm.js");
    try { if (!await api.tf.setBackend("webgl")) throw new Error("WebGL unavailable"); await api.tf.ready(); }
    catch { await api.tf.setBackend("cpu"); await api.tf.ready(); }
    await Promise.all([
      api.nets.ssdMobilenetv1.loadFromUri("/models/face-api"),
      api.nets.faceLandmark68Net.loadFromUri("/models/face-api"),
      api.nets.faceRecognitionNet.loadFromUri("/models/face-api"),
    ]);
    return api;
  })().catch(error => { loading = null; throw error; });
  return loading;
}
export { FACE_MODEL };
export async function prepareFaceDetection() { await loadDetector(); }
export async function detectPhotoFaces(url: string, signal: AbortSignal): Promise<FaceDetection[]> {
  signal.throwIfAborted();
  const api = await loadDetector();
  signal.throwIfAborted();
  const response = await fetch(url, { signal, credentials: "same-origin" });
  if (!response.ok) throw new Error("This photo could not be opened. Refresh your collection and retry.");
  const objectUrl = URL.createObjectURL(await response.blob());
  const image = new Image();
  try {
    image.src = objectUrl; await image.decode(); signal.throwIfAborted();
    const detections = await api.detectAllFaces(image, new api.SsdMobilenetv1Options({ minConfidence: 0.55, maxResults: 30 })).withFaceLandmarks().withFaceDescriptors();
    signal.throwIfAborted();
    return detections.map(result => {
      const box = result.detection.box;
      const x = Math.max(0, box.x / image.naturalWidth), y = Math.max(0, box.y / image.naturalHeight);
      return { box: { x, y, width: Math.min(1 - x, box.width / image.naturalWidth), height: Math.min(1 - y, box.height / image.naturalHeight) }, descriptor: Array.from(result.descriptor), score: result.detection.score };
    });
  } finally { image.src = ""; URL.revokeObjectURL(objectUrl); }
}
