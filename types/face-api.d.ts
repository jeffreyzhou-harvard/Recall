declare module "@vladmandic/face-api/dist/face-api.esm.js" {
  export * from "@vladmandic/face-api";
  // The browser bundle includes TFJS; its package declarations reference optional Node dependencies.
  export const tf: { setBackend(name: "webgl" | "cpu"): Promise<boolean>; ready(): Promise<void> };
}
