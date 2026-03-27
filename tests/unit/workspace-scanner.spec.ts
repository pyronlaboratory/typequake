import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceScanner } from "../../src/core/workspace-scanner";

/**
 * Builds a temporary directory tree from a plain descriptor object.
 * Keys are relative paths; values are file contents (string) or null for dirs.
 */
function buildFixture(files: Record<string, string | null>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "typequake-test-"));

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (content !== null) {
      fs.writeFileSync(abs, content, "utf-8");
    }
  }

  return root;
}

function pkgJson(
  name: string,
  deps: Record<string, string> = {},
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify(
    { name, version: "1.0.0", dependencies: deps, ...extra },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// Shared fixture layout (used across workspace-type variants)
//
//   packages/
//     core/         – no internal deps
//     utils/        – depends on core
//     api/          – depends on core + utils
//     standalone/   – no internal deps, no dependents
// ---------------------------------------------------------------------------

function sharedPackageFiles(): Record<string, string | null> {
  return {
    "packages/core/package.json": pkgJson("@acme/core"),
    "packages/utils/package.json": pkgJson("@acme/utils", {
      "@acme/core": "workspace:*",
    }),
    "packages/api/package.json": pkgJson("@acme/api", {
      "@acme/core": "workspace:*",
      "@acme/utils": "workspace:*",
    }),
    "packages/standalone/package.json": pkgJson("@acme/standalone"),
  };
}

// ---------------------------------------------------------------------------
// describe: pnpm workspace
// ---------------------------------------------------------------------------

describe("WorkspaceScanner — pnpm workspace", () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = buildFixture({
      "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
      "package.json": JSON.stringify({ name: "root", private: true }, null, 2),
      ...sharedPackageFiles(),
    });
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("analyzeWorkspace() returns correct workspace type", () => {
    const result = new WorkspaceScanner(rootDir).analyzeWorkspace();
    expect(result.config.type).toBe("pnpm");
  });

  it("analyzeWorkspace() discovers all four packages", () => {
    const { packages } = new WorkspaceScanner(rootDir).analyzeWorkspace();
    expect(packages.map((p) => p.name).sort()).toEqual([
      "@acme/api",
      "@acme/core",
      "@acme/standalone",
      "@acme/utils",
    ]);
  });

  it("analyzeWorkspace() builds correct dependent graph for @acme/core", () => {
    const { graph } = new WorkspaceScanner(rootDir).analyzeWorkspace();
    // core is depended on by api and utils
    expect(graph.get("@acme/core")).toEqual(["@acme/api", "@acme/utils"]);
  });

  it("analyzeWorkspace() result is cached — same object reference on second call", () => {
    const scanner = new WorkspaceScanner(rootDir);
    const first = scanner.analyzeWorkspace();
    const second = scanner.analyzeWorkspace();
    expect(first).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// describe: yarn workspace
// ---------------------------------------------------------------------------

describe("WorkspaceScanner — yarn workspace", () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = buildFixture({
      "yarn.lock": "",
      "package.json": JSON.stringify(
        { name: "root", private: true, workspaces: ["packages/*"] },
        null,
        2,
      ),
      ...sharedPackageFiles(),
    });
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("analyzeWorkspace() returns correct workspace type", () => {
    const { config } = new WorkspaceScanner(rootDir).analyzeWorkspace();
    expect(config.type).toBe("yarn");
  });

  it("analyzeWorkspace() discovers all packages", () => {
    const { packages } = new WorkspaceScanner(rootDir).analyzeWorkspace();
    expect(packages).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// describe: bun workspace (bun.lock variant)
// ---------------------------------------------------------------------------

describe("WorkspaceScanner — bun workspace", () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = buildFixture({
      "bun.lock": "",
      "package.json": JSON.stringify(
        { name: "root", private: true, workspaces: ["packages/*"] },
        null,
        2,
      ),
      ...sharedPackageFiles(),
    });
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("analyzeWorkspace() returns correct workspace type", () => {
    const { config } = new WorkspaceScanner(rootDir).analyzeWorkspace();
    expect(config.type).toBe("bun");
  });
});

// ---------------------------------------------------------------------------
// describe: getTransitiveDependents
// ---------------------------------------------------------------------------

describe("WorkspaceScanner — getTransitiveDependents()", () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = buildFixture({
      "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
      "package.json": JSON.stringify({ name: "root", private: true }, null, 2),
      ...sharedPackageFiles(),
    });
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("returns direct + transitive dependents of @acme/core", () => {
    const scanner = new WorkspaceScanner(rootDir);
    // core → utils → api (api also directly depends on core)
    expect(scanner.getTransitiveDependents("@acme/core")).toEqual([
      "@acme/api",
      "@acme/utils",
    ]);
  });

  it("returns only direct dependent of @acme/utils", () => {
    const scanner = new WorkspaceScanner(rootDir);
    expect(scanner.getTransitiveDependents("@acme/utils")).toEqual([
      "@acme/api",
    ]);
  });

  it("returns empty array for a package with no dependents", () => {
    const scanner = new WorkspaceScanner(rootDir);
    expect(scanner.getTransitiveDependents("@acme/api")).toEqual([]);
    expect(scanner.getTransitiveDependents("@acme/standalone")).toEqual([]);
  });

  it("does not recompute the graph between calls", () => {
    const scanner = new WorkspaceScanner(rootDir);
    scanner.getTransitiveDependents("@acme/core");

    // Poison the cache slot — if analyzeWorkspace() runs again it would rebuild.
    // We verify by checking the cache reference is still the same after a second call.
    const cached = scanner.analyzeWorkspace();
    scanner.getTransitiveDependents("@acme/utils");
    expect(scanner.analyzeWorkspace()).toBe(cached);
  });

  it("throws a descriptive error for an unknown package", () => {
    const scanner = new WorkspaceScanner(rootDir);
    expect(() =>
      scanner.getTransitiveDependents("@acme/does-not-exist"),
    ).toThrow(/@acme\/does-not-exist/);
  });

  it("handles circular dependencies without infinite loop", () => {
    const rootDir = buildFixture({
      "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
      "package.json": JSON.stringify({ name: "root", private: true }, null, 2),
      // a → b → c → a
      "packages/a/package.json": pkgJson("@acme/a", {
        "@acme/c": "workspace:*",
      }),
      "packages/b/package.json": pkgJson("@acme/b", {
        "@acme/a": "workspace:*",
      }),
      "packages/c/package.json": pkgJson("@acme/c", {
        "@acme/b": "workspace:*",
      }),
    });
    const scanner = new WorkspaceScanner(rootDir);
    expect(() => scanner.getTransitiveDependents("@acme/a")).not.toThrow();
    expect(scanner.getTransitiveDependents("@acme/a")).toEqual([
      "@acme/b",
      "@acme/c",
    ]);
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// describe: error handling
// ---------------------------------------------------------------------------

describe("WorkspaceScanner — error handling", () => {
  it("throws when no workspace config is found at root", () => {
    const rootDir = buildFixture({
      // package.json exists but has no 'workspaces' field
      "package.json": JSON.stringify({ name: "root", private: true }, null, 2),
    });

    try {
      expect(() => new WorkspaceScanner(rootDir).analyzeWorkspace()).toThrow(
        /workspaces/i,
      );
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("throws on malformed pnpm-workspace.yaml", () => {
    const rootDir = buildFixture({
      "pnpm-workspace.yaml": ": bad: yaml: [[[",
      "package.json": JSON.stringify({ name: "root", private: true }, null, 2),
    });

    try {
      expect(() => new WorkspaceScanner(rootDir).analyzeWorkspace()).toThrow(
        /pnpm-workspace\.yaml/i,
      );
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("throws when pnpm-workspace.yaml is missing 'packages' key", () => {
    const rootDir = buildFixture({
      "pnpm-workspace.yaml": "catalog:\n  - packages/*\n",
      "package.json": JSON.stringify({ name: "root", private: true }, null, 2),
    });

    try {
      expect(() => new WorkspaceScanner(rootDir).analyzeWorkspace()).toThrow(
        /packages.*field/i,
      );
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

describe("WorkspaceScanner — invalid packages are skipped", () => {
  it("ignores a package directory with no package.json", () => {
    const rootDir = buildFixture({
      "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
      "package.json": JSON.stringify({ name: "root", private: true }, null, 2),
      "packages/core/package.json": pkgJson("@acme/core"),
      "packages/no-manifest/.gitkeep": "", // directory exists, no package.json
    });
    const { packages } = new WorkspaceScanner(rootDir).analyzeWorkspace();
    expect(packages.map((p) => p.name)).toEqual(["@acme/core"]);
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("ignores a package with malformed package.json", () => {
    const rootDir = buildFixture({
      "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
      "package.json": JSON.stringify({ name: "root", private: true }, null, 2),
      "packages/core/package.json": pkgJson("@acme/core"),
      "packages/broken/package.json": "{ not valid json >>>",
    });
    const { packages } = new WorkspaceScanner(rootDir).analyzeWorkspace();
    expect(packages.map((p) => p.name)).toEqual(["@acme/core"]);
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("ignores a package with no name field", () => {
    const rootDir = buildFixture({
      "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
      "package.json": JSON.stringify({ name: "root", private: true }, null, 2),
      "packages/core/package.json": pkgJson("@acme/core"),
      "packages/unnamed/package.json": JSON.stringify({ version: "1.0.0" }),
    });
    const { packages } = new WorkspaceScanner(rootDir).analyzeWorkspace();
    expect(packages.map((p) => p.name)).toEqual(["@acme/core"]);
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// describe: on-disk fixtures (committed to tests/fixtures/)
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.resolve(__dirname, "../fixtures/workspaces");

describe("WorkspaceScanner — on-disk fixtures", () => {
  it("pnpm-workspace: detects type and discovers all packages", () => {
    const rootDir = path.join(FIXTURES_DIR, "pnpm-workspace");
    const { config, packages } = new WorkspaceScanner(
      rootDir,
    ).analyzeWorkspace();

    expect(config.type).toBe("pnpm");
    expect(packages.map((p) => p.name).sort()).toEqual([
      "@fixture/api",
      "@fixture/core",
      "@fixture/standalone",
      "@fixture/utils",
    ]);
  });

  it("pnpm-workspace: builds correct dependency graph", () => {
    const rootDir = path.join(FIXTURES_DIR, "pnpm-workspace");
    const { graph } = new WorkspaceScanner(rootDir).analyzeWorkspace();

    expect(graph.get("@fixture/core")).toEqual([
      "@fixture/api",
      "@fixture/utils",
    ]);
    expect(graph.get("@fixture/utils")).toEqual(["@fixture/api"]);
    expect(graph.get("@fixture/api")).toEqual([]);
    expect(graph.get("@fixture/standalone")).toEqual([]);
  });

  it("pnpm-workspace: getTransitiveDependents() traverses correctly", () => {
    const scanner = new WorkspaceScanner(
      path.join(FIXTURES_DIR, "pnpm-workspace"),
    );

    expect(scanner.getTransitiveDependents("@fixture/core")).toEqual([
      "@fixture/api",
      "@fixture/utils",
    ]);
    expect(scanner.getTransitiveDependents("@fixture/utils")).toEqual([
      "@fixture/api",
    ]);
    expect(scanner.getTransitiveDependents("@fixture/standalone")).toEqual([]);
  });

  it("yarn-workspace: detects type and discovers all packages", () => {
    const rootDir = path.join(FIXTURES_DIR, "yarn-workspace");
    const { config, packages } = new WorkspaceScanner(
      rootDir,
    ).analyzeWorkspace();

    expect(config.type).toBe("yarn");
    expect(packages.map((p) => p.name).sort()).toEqual([
      "@fixture/api",
      "@fixture/core",
      "@fixture/standalone",
      "@fixture/utils",
    ]);
  });

  it("yarn-workspace: builds correct dependency graph", () => {
    const rootDir = path.join(FIXTURES_DIR, "yarn-workspace");
    const { graph } = new WorkspaceScanner(rootDir).analyzeWorkspace();

    expect(graph.get("@fixture/core")).toEqual([
      "@fixture/api",
      "@fixture/utils",
    ]);
    expect(graph.get("@fixture/utils")).toEqual(["@fixture/api"]);
  });

  it("bun-workspace: detects type and discovers all packages", () => {
    const rootDir = path.join(FIXTURES_DIR, "bun-workspace");
    const { config, packages } = new WorkspaceScanner(
      rootDir,
    ).analyzeWorkspace();

    expect(config.type).toBe("bun");
    expect(packages.map((p) => p.name).sort()).toEqual([
      "@fixture/api",
      "@fixture/core",
      "@fixture/standalone",
      "@fixture/utils",
    ]);
  });

  it("bun-workspace: builds correct dependency graph", () => {
    const rootDir = path.join(FIXTURES_DIR, "bun-workspace");
    const { graph } = new WorkspaceScanner(rootDir).analyzeWorkspace();

    expect(graph.get("@fixture/core")).toEqual([
      "@fixture/api",
      "@fixture/utils",
    ]);
    expect(graph.get("@fixture/utils")).toEqual(["@fixture/api"]);
  });
});
