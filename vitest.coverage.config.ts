import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000, // slow under instrumentation
    coverage: {
      provider: "v8",
      // ...other coverage options
    },
  },
});
