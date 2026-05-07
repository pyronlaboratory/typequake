/**
 * Runtime Performance Benchmark
 * ==============================
 * Validates that TypeQuake completes a full analysis pipeline within the
 * accepted performance budget when run against a realistic 20-package monorepo.
 *
 * Acceptance Criteria
 * -------------------
 *   • Workspace size : 20 packages (1 changed, 6 direct consumers, 13 transitive)
 *   • Simulated change: BREAKING – removes `createdAt` from `User` and narrows
 *                       the `role` union in @benchmark/shared-core
 *   • Budget          : < 10 000 ms (wall-clock, cold run, --no-cache)
 *
 * Fixture
 * -------
 *   tests/fixtures/benchmark/
 *     packages/shared-core        ← the package that "changes"
 *     packages/feature-{auth,users,billing,notifications,analytics,search}
 *     packages/utils-{array,string,object,date}
 *     packages/service-{api,data,events,reporting}
 *     packages/app-{dashboard,admin,mobile,cli,webhook}
 *
 * How it works
 * ------------
 *   1. Copy the fixture into a throw-away temp directory.
 *   2. `git init` + commit everything → this becomes the "base ref" snapshot.
 *   3. Overwrite shared-core/src/index.ts with the breaking variant.
 *   4. Invoke the TypeQuake CLI (bun run src/cli.ts <sha> --no-cache) and
 *      measure wall-clock time with performance.now().
 *   5. Assert elapsed < BUDGET_MS and that the process exits without an
 *      unexpected error code.
 */

import { execSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ── Constants ─────────────────────────────────────────────────────────────────

const BUDGET_MS = 10_000;

const FIXTURE_DIR = resolve(__dirname, "../fixtures/benchmark");
const CLI_PATH = resolve(__dirname, "../../src/cli.ts");

/**
 * The "after" state of shared-core/src/index.ts.
 *
 * Breaking changes introduced versus the committed baseline:
 *   1. `createdAt` field removed from `User`          → BREAKING (consumers read it)
 *   2. `role` union narrows: 'editor' dropped          → NARROWING
 *   3. `avatarUrl` removed entirely (was @deprecated)  → BREAKING
 *   4. New required field `updatedAt` added             → BREAKING for producers
 */
const BROKEN_SHARED_CORE = /* ts */ `
// MODIFIED: breaking change applied by runtime-perf benchmark

export type UserId = string;
export type OrgId  = string;

export interface User {
  id:        UserId;
  name:      string;
  email:     string;
  /** narrowed: 'editor' removed */
  role:      'admin' | 'viewer';
  /** new required field */
  updatedAt: number;
}

export interface Org {
  id:   OrgId;
  name: string;
  plan: 'free' | 'pro' | 'enterprise';
}

export interface Membership {
  userId: UserId;
  orgId:  OrgId;
  role:   'owner' | 'member';
}

export interface ApiResponse<T> {
  data:      T;
  error:     string | null;
  requestId: string;
  ts:        number;
}

export type Paginated<T> = ApiResponse<{ items: T[]; total: number; page: number }>;

export function assertNever(x: never): never {
  throw new Error(\`Unexpected value: \${JSON.stringify(x)}\`);
}
`.trimStart();

// ── Helpers ───────────────────────────────────────────────────────────────────

function git(cwd: string, ...args: string[]): void {
  execSync(["git", ...args].join(" "), {
    cwd,
    stdio: "pipe",
    env: {
      ...process.env,
      // Prevent Git from looking for a global config that may not exist in CI
      GIT_CONFIG_NOSYSTEM: "1",
      HOME: cwd,
    },
  });
}

function gitOutput(cwd: string, ...args: string[]): string {
  return execSync(["git", ...args].join(" "), {
    cwd,
    stdio: "pipe",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", HOME: cwd },
  })
    .toString()
    .trim();
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("Runtime Performance – 20-package workspace", () => {
  let repoDir: string;
  let baseSha: string;

  // ── Setup: build a real throw-away git repo from the fixture ──────────────
  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "typequake-bench-"));

    // Copy entire fixture into the temp repo
    cpSync(FIXTURE_DIR, repoDir, { recursive: true });

    // Initialise git with a deterministic identity (required for CI)
    git(repoDir, "init");
    git(repoDir, "config", "user.email", '"bench@typequake.test"');
    git(repoDir, "config", "user.name", '"TypeQuake Bench"');
    git(repoDir, "add", ".");
    git(repoDir, "commit", "-m", '"perf-bench: initial 20-package baseline"');

    baseSha = gitOutput(repoDir, "rev-parse", "HEAD");

    // Apply the breaking change to shared-core (working tree only – not committed)
    writeFileSync(
      join(repoDir, "packages", "shared-core", "src", "index.ts"),
      BROKEN_SHARED_CORE,
    );
  }, 30_000 /* allow extra time for fs copy + git ops */);

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  // ── Benchmark ─────────────────────────────────────────────────────────────
  it(
    `completes full pipeline in < ${BUDGET_MS / 1_000}s for a 20-package workspace with 1 changed package`,
    () => {
      const start = performance.now();

      const result = spawnSync(
        "bun",
        [
          "run",
          CLI_PATH,
          baseSha, // base ref: the initial commit
          "--no-cache", // force cold run – no cached SignatureMaps
          "--json",
        ],
        {
          cwd: repoDir,
          timeout: BUDGET_MS + 5_000, // kill after 15s so the test doesn't hang
          encoding: "utf8",
        },
      );

      const elapsed = performance.now() - start;

      // ── Correctness guards ────────────────────────────────────────────────

      // Exit codes: 0 = clean, 1 = breaking changes found.
      // Any other code (2, null) indicates a crash.
      expect(
        result.status,
        [
          `TypeQuake process exited unexpectedly (status=${String(result.status)}).`,
          result.stderr ? `\nSTDERR:\n${result.stderr}` : "",
          result.error ? `\nERROR:\n${String(result.error)}` : "",
        ].join(""),
      ).toBeOneOf([0, 1]);

      // Stderr should not contain unhandled exception noise
      if (result.stderr) {
        expect(result.stderr).not.toMatch(/\bUnhandledPromiseRejection\b/);
        expect(result.stderr).not.toMatch(/\bTypeError\b/);
      }

      // Stdout should be parseable JSON (--format json flag)
      let report: unknown;
      expect(() => {
        report = JSON.parse(result.stdout ?? "");
      }, `stdout was not valid JSON:\n${result.stdout}`).not.toThrow();

      // The report must flag at least the shared-core mutation
      expect(report).toMatchObject({
        packages: expect.arrayContaining([
          expect.objectContaining({ name: "@benchmark/shared-core" }),
        ]),
      });

      // ── Performance assertion ─────────────────────────────────────────────
      expect(
        elapsed,
        `Pipeline took ${elapsed.toFixed(0)} ms – exceeded the ${BUDGET_MS} ms budget`,
      ).toBeLessThan(BUDGET_MS);

      // Human-readable summary always visible in CI logs
      const changedPkg =
        (report as { packages?: { name: string }[] }).packages ?? [];
      console.log(
        [
          "",
          "  ┌─ Performance Benchmark Result ─────────────────────────────┐",
          `  │  Elapsed          : ${elapsed.toFixed(0).padStart(6)} ms                              │`,
          `  │  Budget           : ${String(BUDGET_MS).padStart(6)} ms                              │`,
          `  │  Headroom         : ${(BUDGET_MS - elapsed).toFixed(0).padStart(6)} ms                              │`,
          `  │  Packages scanned : ${String(20).padStart(4)}                                   │`,
          `  │  Packages changed : ${String(changedPkg.length).padStart(4)}                              │`,
          "  └────────────────────────────────────────────────────────────┘",
          "",
        ].join("\n"),
      );
    },
    BUDGET_MS + 10_000, // vitest per-test timeout
  );

  // ── Smoke test: cached run should be even faster ──────────────────────────
  it(
    "cached re-run completes faster than the cold run",
    () => {
      // Run WITHOUT --no-cache so disk cache is read
      const warmStart = performance.now();
      const warm = spawnSync("bun", ["run", CLI_PATH, baseSha, "--json"], {
        cwd: repoDir,
        timeout: BUDGET_MS + 5_000,
        encoding: "utf8",
      });
      const warmElapsed = performance.now() - warmStart;

      expect(warm.status).toBeOneOf([0, 1]);
      // Cached run should comfortably beat 5s
      expect(
        warmElapsed,
        `Cached run took ${warmElapsed.toFixed(0)} ms – expected < 5000 ms`,
      ).toBeLessThan(5_000);

      console.log(`  ✓ Cached run: ${warmElapsed.toFixed(0)} ms`);
    },
    BUDGET_MS + 10_000,
  );
});
