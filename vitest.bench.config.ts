import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for the runtime performance benchmark.
 *
 * Run with:
 *   bun run bench          (via package.json script)
 *   vitest run --config vitest.bench.config.ts
 *
 * This is intentionally separated from the main test config so the slow
 * benchmark (cold-run git + full pipeline) never bloats the normal `vitest`
 * feedback loop.
 */
export default defineConfig({
  test: {
    include: ["tests/benchmarks/**/*.spec.ts"],

    // Each test can take up to 30 s; the suite itself is given 60 s.
    testTimeout: 30_000,
    hookTimeout: 30_000,

    // Single-threaded: we are measuring wall-clock time; parallel workers
    // would add CPU contention noise to the measurements.
    pool: "forks",
    maxWorkers: 1,
    isolate: false,

    // Print test names so CI logs clearly show which assertion ran.
    reporters: "verbose",

    // Disable code coverage for benchmarks – it would skew timings.
    coverage: { enabled: false },
  },
});
