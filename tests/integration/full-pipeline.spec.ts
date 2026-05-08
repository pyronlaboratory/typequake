import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { GitBridge } from "../../src/core/git-bridge";
import { generateReport } from "../../src/core/generate-report";
import { WorkspaceScanner } from "../../src/core/workspace-scanner";
import { TypeSurfaceExtractor } from "../../src/core/extract-types";

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
  git("config user.email bulma@capsule.corp");
  git("config user.name Bulma");

  write(
    "package.json",
    JSON.stringify({ name: "root", workspaces: ["packages/**"] }),
  );

  // Baseline package used to simulate a breaking API evolution.
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

  // Downstream consumer used for impact analysis validation.
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

  // Package removed in the next revision to simulate deletion handling.
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

  // Introduce a required field to trigger a breaking interface mutation.
  write(
    "packages/core/index.ts",
    "export interface Config { timeout: number; retries: number; }\nexport type Env = 'prod' | 'dev';",
  );

  // Remove an existing package to simulate deleted workspace state.
  fs.rmSync(path.join(FIXTURE_ROOT, "packages/legacy"), {
    recursive: true,
    force: true,
  });

  // Introduce a newly added workspace package.
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

function bridge() {
  return new GitBridge(FIXTURE_ROOT);
}

describe("Full Pipeline Integration", () => {
  describe("changed package detection", () => {
    it("detects all affected packages between base and HEAD", () => {
      const changed = bridge().getChangedPackages(baseSha);

      // Only packages with filesystem or git-level changes should be returned.
      expect(changed).toContain("@fixture/core");
      expect(changed).not.toContain("@fixture/app");
    });
  });

  describe("package diffing", () => {
    describe("when a package was modified", () => {
      it("classifies the package as changed", () => {
        const result = bridge().diffPackage(
          baseSha,
          path.join(FIXTURE_ROOT, "packages/core"),
        );
        expect(result.status).toBe("changed");
        expect(result.packageName).toBe("@fixture/core");
      });

      it("detects breaking API mutations", () => {
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
    });

    describe("when a package was added", () => {
      it("classifies the package as added", () => {
        const result = bridge().diffPackage(
          baseSha,
          path.join(FIXTURE_ROOT, "packages/new"),
        );
        expect(result.status).toBe("added");
        expect(result.before).toBeNull();
        expect(
          result.mutations.every((m) => m.mutationClass === "ADDITIVE"),
        ).toBe(true);
      });
    });

    describe("when a package was deleted", () => {
      it("classifies the package as deleted", () => {
        const result = bridge().diffPackage(
          baseSha,
          path.join(FIXTURE_ROOT, "packages/legacy"),
        );
        expect(result.status).toBe("deleted");
        expect(result.after).toBeNull();
        expect(result.packageName).toBe("@fixture/legacy");
      });

      it("marks exported symbols as removed", () => {
        const result = bridge().diffPackage(
          baseSha,
          path.join(FIXTURE_ROOT, "packages/legacy"),
        );
        expect(
          result.mutations.every((m) => m.mutationClass === "REMOVED"),
        ).toBe(true);
        expect(
          result.mutations.find((m) => m.symbolName === "OldConfig"),
        ).toBeDefined();
      });
    });
  });

  describe("impact analysis", () => {
    it("generates reports for downstream dependents", async () => {
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

      // Downstream dependents should be analyzable even
      // when no concrete import sites are detected.
      expect(Array.isArray(reports)).toBe(true);
    });

    it("handles added packages without throwing", async () => {
      const result = bridge().diffPackage(
        baseSha,
        path.join(FIXTURE_ROOT, "packages/new"),
      );

      const scanner = new WorkspaceScanner(FIXTURE_ROOT);
      const { packages, graph } = scanner.analyzeWorkspace();

      const reports = await generateReport("@fixture/new", result.mutations, {
        packages,
        graph,
      });
      expect(Array.isArray(reports)).toBe(true);
    });

    it("handles deleted packages without throwing", async () => {
      const result = bridge().diffPackage(
        baseSha,
        path.join(FIXTURE_ROOT, "packages/legacy"),
      );

      // The deleted package no longer exists in the current workspace graph.
      const scanner = new WorkspaceScanner(FIXTURE_ROOT);
      const { packages, graph } = scanner.analyzeWorkspace();

      const reports = await generateReport(
        "@fixture/legacy",
        result.mutations,
        {
          packages,
          graph,
        },
      );
      expect(Array.isArray(reports)).toBe(true);
    });
  });

  describe("historical snapshot extraction", () => {
    it("matches live type extraction at HEAD", () => {
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

    it("reconstructs historical type shapes from older refs", () => {
      const b = bridge();
      const pkgPath = path.join(FIXTURE_ROOT, "packages/core");

      const snapshot = b.extractTypeSnapshotAtRef(baseSha, pkgPath);
      const config = snapshot.get("Config");

      expect(config).toBeDefined();
      expect(config!.properties?.map((p) => p.name)).toEqual(["timeout"]);
      expect(config!.properties?.map((p) => p.name)).not.toContain("retries");
    });
  });
});
