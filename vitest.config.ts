import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // LadybugDB is a native addon; keep its tests in one worker so the embedded
    // database is never opened twice.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
