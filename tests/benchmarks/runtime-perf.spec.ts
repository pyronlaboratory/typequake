import { execSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BUDGET_MS = 10_000;

const FIXTURE_DIR = resolve(__dirname, "../fixtures/benchmark");
const CLI_PATH = resolve(__dirname, "../../src/cli.ts");

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

describe("Runtime Performance", () => {
  let repoDir: string;
  let baseSha: string;

  // Setup: build a real throw-away git repo from the fixture
  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "typequake-bench-"));

    // Copy entire fixture into the temp repo
    cpSync(FIXTURE_DIR, repoDir, { recursive: true });

    // Initialise git with a deterministic identity (required for CI)
    git(repoDir, "init");
    git(repoDir, "config", "user.email", '"bulma@capsule.corp"');
    git(repoDir, "config", "user.name", '"Bulma"');
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

  // Benchmarking
  it(
    `completes full pipeline in < ${BUDGET_MS / 1_000}s`,
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

      // Correctness guards
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

      // Performance assertion
      expect(
        elapsed,
        `Pipeline took ${elapsed.toFixed(0)} ms – exceeded the ${BUDGET_MS} ms budget`,
      ).toBeLessThan(BUDGET_MS);

      const parsed = report as {
        reports?: Array<{ consumerPackage?: string }>;
      };

      const changedPackages = [
        ...new Set(
          (parsed.reports ?? []).map((r) => r.consumerPackage).filter(Boolean),
        ),
      ];

      const rows: Array<[string, string]> = [
        ["Elapsed", `${elapsed.toFixed(0)} ms`],
        ["Budget", `${BUDGET_MS} ms`],
        ["Headroom", `${(BUDGET_MS - elapsed).toFixed(0)} ms`],
        ["Packages scanned", "20"],
        ["Packages changed", String(changedPackages.length)],
      ];

      const innerWidth = 58;

      console.log("");
      console.log(`  ┌─ Performance Benchmark Result ${"─".repeat(27)}┐`);

      for (const [label, value] of rows) {
        const content = `  ${label.padEnd(18)} : ${value.padStart(8)}  `;
        console.log(`  │${content.padEnd(innerWidth)}│`);
      }

      console.log(`  └${"─".repeat(innerWidth)}┘`);

      if (changedPackages.length > 0) {
        console.log(`  Changed packages     : ${changedPackages.join(", ")}`);
      }

      console.log("");

      // // Human-readable summary always visible in CI logs
      // const changedPkg =
      //   (report as { packages?: { name: string }[] }).packages ?? [];

      // const changedCount = changedPkg.length;
      // const changedList =
      //   changedCount > 0 ? changedPkg.map((p) => p.name).join(", ") : "none";

      // console.log(
      //   [
      //     "",
      //     "  ┌─ Performance Benchmark Result ─────────────────────────────┐",
      //     `  │  Elapsed          : ${elapsed.toFixed(0).padStart(6)} ms                              │`,
      //     `  │  Budget           : ${String(BUDGET_MS).padStart(6)} ms                              │`,
      //     `  │  Headroom         : ${(BUDGET_MS - elapsed).toFixed(0).padStart(6)} ms                              │`,
      //     `  │  Packages scanned : ${String(20).padStart(4)}                                   │`,
      //     `  │  Packages changed : ${String(changedCount).padStart(4)}                              │`,
      //     "  └────────────────────────────────────────────────────────────┘",
      //     "",
      //   ].join("\n"),
      // );
    },
    BUDGET_MS + 10_000, // vitest per-test timeout
  );

  // Smoke test: cached run should be even faster
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
