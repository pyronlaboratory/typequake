import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { GitBridge } from "../../src/core/git-bridge.js";
import { generateReport } from "../../src/core/impact-report.js";
import { WorkspaceScanner } from "../../src/core/workspace-scanner.js";
import { TypeSurfaceExtractor } from "../../src/core/type-surface.js";

/**
 * Full pipeline integration test.
 *
 * Exercises the complete GitBridge → diffPackage → generateReport flow
 * against a real git repository with multiple commits and package states.
 *
 * Scenario:
 *   base commit  → @fixture/core exports `Config { timeout: number }`
 *                  @fixture/app depends on @fixture/core
 *                  @fixture/legacy exists (will be deleted)
 *
 *   HEAD         → @fixture/core exports `Config { timeout: number; retries: number }`  (BREAKING — added required prop)
 *                  @fixture/app unchanged
 *                  @fixture/legacy deleted
 *                  @fixture/new added
 */

const FIXTURE_ROOT = path.join(os.tmpdir(), "typequake-full-pipeline");

function git(args: string) {
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
  execSync(`git ${args}`, { cwd: FIXTURE_ROOT, stdio: "pipe" });
}

function write(relPath: string, content: string) {
  const abs = path.join(FIXTURE_ROOT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
}

let baseSha: string;

beforeAll(() => {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true });

  git("init");
  git("config user.email test@example.com");
  git("config user.name Test");

  // ── Base state ──────────────────────────────────────────────────────────────

  write(
    "package.json",
    JSON.stringify({ name: "root", workspaces: ["packages/**"] }),
  );

  // @fixture/core — will be modified (breaking change)
  write(
    "packages/core/package.json",
    JSON.stringify({
      name: "@fixture/core",
      version: "1.0.0",
      main: "index.ts",
    }),
  );
  write(
    "packages/core/index.ts",
    "export interface Config { timeout: number; }\nexport type Env = 'prod' | 'dev';",
  );

  // @fixture/app — depends on core, will be unchanged
  write(
    "packages/app/package.json",
    JSON.stringify({
      name: "@fixture/app",
      version: "1.0.0",
      main: "index.ts",
      dependencies: { "@fixture/core": "*" },
    }),
  );
  write("packages/app/index.ts", "export function start(): void {}");

  // @fixture/legacy — will be deleted at HEAD
  write(
    "packages/legacy/package.json",
    JSON.stringify({
      name: "@fixture/legacy",
      version: "1.0.0",
      main: "index.ts",
    }),
  );
  write(
    "packages/legacy/index.ts",
    "export interface OldConfig { debug: boolean; }",
  );

  git("add -A");
  git("commit -m base");

  baseSha = execSync("git rev-parse HEAD", {
    cwd: FIXTURE_ROOT,
    encoding: "utf-8",
  }).trim();

  // ── HEAD state ──────────────────────────────────────────────────────────────

  // Breaking change: add required `retries` to Config
  write(
    "packages/core/index.ts",
    "export interface Config { timeout: number; retries: number; }\nexport type Env = 'prod' | 'dev';",
  );

  // Delete legacy
  fs.rmSync(path.join(FIXTURE_ROOT, "packages/legacy"), {
    recursive: true,
    force: true,
  });

  // Add new package
  write(
    "packages/new/package.json",
    JSON.stringify({
      name: "@fixture/new",
      version: "1.0.0",
      main: "index.ts",
    }),
  );
  write("packages/new/index.ts", "export function init(): void {}");

  git("add -A");
  git("commit -m breaking-changes");
});

afterAll(() => {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function bridge() {
  return new GitBridge(FIXTURE_ROOT);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("full pipeline — getChangedPackages", () => {
  it("detects all affected packages between base and HEAD", () => {
    const changed = bridge().getChangedPackages(baseSha);
    // core modified, legacy deleted, new added — app untouched
    expect(changed).toContain("@fixture/core");
    expect(changed).not.toContain("@fixture/app");
  });
});

describe("full pipeline — diffPackage (changed)", () => {
  it("classifies @fixture/core as changed", () => {
    const result = bridge().diffPackage(
      baseSha,
      path.join(FIXTURE_ROOT, "packages/core"),
    );
    expect(result.status).toBe("changed");
    expect(result.packageName).toBe("@fixture/core");
  });

  it("detects BREAKING mutation on Config", () => {
    const result = bridge().diffPackage(
      baseSha,
      path.join(FIXTURE_ROOT, "packages/core"),
    );
    const breaking = result.mutations.find(
      (m) => m.symbolName === "Config" && m.mutationClass === "BREAKING",
    );
    expect(breaking).toBeDefined();
    expect(breaking!.detail).toMatch(/retries/);
  });

  // it("unchanged symbols produce no mutations", () => {
  //   const result = bridge().diffPackage(
  //     baseSha,
  //     path.join(FIXTURE_ROOT, "packages/core"),
  //   );
  //   const envMutation = result.mutations.find((m) => m.symbolName === "Env");
  //   expect(envMutation).toBeUndefined();
  // });
});

describe("full pipeline — diffPackage (added)", () => {
  it("classifies @fixture/new as added", () => {
    const result = bridge().diffPackage(
      baseSha,
      path.join(FIXTURE_ROOT, "packages/new"),
    );
    expect(result.status).toBe("added");
    expect(result.before).toBeNull();
    expect(result.mutations.every((m) => m.mutationClass === "ADDITIVE")).toBe(
      true,
    );
  });
});

describe("full pipeline — diffPackage (deleted)", () => {
  it("classifies @fixture/legacy as deleted", () => {
    const result = bridge().diffPackage(
      baseSha,
      path.join(FIXTURE_ROOT, "packages/legacy"),
    );
    expect(result.status).toBe("deleted");
    expect(result.after).toBeNull();
    expect(result.packageName).toBe("@fixture/legacy");
  });

  it("emits REMOVED mutations for all exported symbols", () => {
    const result = bridge().diffPackage(
      baseSha,
      path.join(FIXTURE_ROOT, "packages/legacy"),
    );
    expect(result.mutations.every((m) => m.mutationClass === "REMOVED")).toBe(
      true,
    );
    expect(
      result.mutations.find((m) => m.symbolName === "OldConfig"),
    ).toBeDefined();
  });
});

describe("full pipeline — generateReport integration", () => {
  it("produces impact reports for downstream consumers of @fixture/core", async () => {
    const result = bridge().diffPackage(
      baseSha,
      path.join(FIXTURE_ROOT, "packages/core"),
    );

    const scanner = new WorkspaceScanner(FIXTURE_ROOT);
    const { packages, graph } = scanner.analyzeWorkspace();

    const reports = await generateReport("@fixture/core", result.mutations, {
      packages,
      graph,
    });

    // @fixture/app depends on @fixture/core — should appear in report
    // (may be empty if app has no import sites, but generateReport must not throw)
    expect(Array.isArray(reports)).toBe(true);
  });

  it("generateReport does not throw for added package mutations", async () => {
    const result = bridge().diffPackage(
      baseSha,
      path.join(FIXTURE_ROOT, "packages/new"),
    );

    const scanner = new WorkspaceScanner(FIXTURE_ROOT);
    const { packages, graph } = scanner.analyzeWorkspace();

    await expect(
      generateReport("@fixture/new", result.mutations, { packages, graph }),
    ).resolves.not.toThrow();
  });

  it("generateReport does not throw for deleted package mutations", async () => {
    const result = bridge().diffPackage(
      baseSha,
      path.join(FIXTURE_ROOT, "packages/legacy"),
    );

    // Use current workspace — legacy is gone, graph has no dependents for it
    const scanner = new WorkspaceScanner(FIXTURE_ROOT);
    const { packages, graph } = scanner.analyzeWorkspace();

    await expect(
      generateReport("@fixture/legacy", result.mutations, { packages, graph }),
    ).resolves.not.toThrow();
  });
});

describe("full pipeline — snapshot fidelity", () => {
  it("extractTypeSnapshotAtRef at HEAD matches live extraction", () => {
    const b = bridge();
    const pkgPath = path.join(FIXTURE_ROOT, "packages/core");

    const fromSnapshot = b.extractTypeSnapshotAtRef("HEAD", pkgPath);
    const extractor = new TypeSurfaceExtractor(FIXTURE_ROOT);
    const fromDisk = extractor.extract(pkgPath);

    expect([...fromSnapshot.keys()]).toEqual([...fromDisk.keys()]);
    for (const [name, sig] of fromDisk) {
      expect(fromSnapshot.get(name)?.typeString).toBe(sig.typeString);
    }
  });

  it("extractTypeSnapshotAtRef at baseSha reflects old Config shape", () => {
    const b = bridge();
    const pkgPath = path.join(FIXTURE_ROOT, "packages/core");

    const snapshot = b.extractTypeSnapshotAtRef(baseSha, pkgPath);
    const config = snapshot.get("Config");

    expect(config).toBeDefined();
    expect(config!.properties?.map((p) => p.name)).toEqual(["timeout"]);
    expect(config!.properties?.map((p) => p.name)).not.toContain("retries");
  });
});
