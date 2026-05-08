import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/benchmarks/**/*.spec.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,

    // Single-threaded: we are measuring wall-clock time; parallel workers
    // would add CPU contention noise to the measurements.
    pool: "forks",
    maxWorkers: 1,
    isolate: false,

    // Print test names so CI logs clearly show which assertion ran.
    reporters: "verbose",

    // Disable code coverage for benchmarks.
    coverage: { enabled: false },
  },
});
