import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { GitBridge } from "../../src/core/git-bridge.js";

const FIXTURE_ROOT = path.join(
  os.tmpdir(),
  "fixtures/git-bridge-diff-package-fixture",
);

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

  write(
    "package.json",
    JSON.stringify({ name: "root", workspaces: ["packages/**"] }),
  );

  // packages/stable — exists on both sides, will be modified
  write(
    "packages/stable/package.json",
    JSON.stringify({
      name: "@fixture/stable",
      version: "1.0.0",
      main: "index.ts",
    }),
  );
  write(
    "packages/stable/index.ts",
    "export interface Config { timeout: number; }",
  );

  // packages/deleted — exists only at base
  write(
    "packages/deleted/package.json",
    JSON.stringify({
      name: "@fixture/deleted",
      version: "1.0.0",
      main: "index.ts",
    }),
  );
  write(
    "packages/deleted/index.ts",
    "export interface OldApi { run(): void; }",
  );

  git("add -A");
  git("commit -m base");

  baseSha = execSync("git rev-parse HEAD", {
    cwd: FIXTURE_ROOT,
    encoding: "utf-8",
  }).trim();

  // Simulate current state:
  // 1. Modify stable (breaking — remove required prop)
  write(
    "packages/stable/index.ts",
    "export interface Config { timeout: number; retries: number; }",
  );

  // 2. Delete the "deleted" package from disk (simulates removal)
  fs.rmSync(path.join(FIXTURE_ROOT, "packages/deleted"), {
    recursive: true,
    force: true,
  });

  // 3. Add a brand-new package
  write(
    "packages/added/package.json",
    JSON.stringify({
      name: "@fixture/added",
      version: "1.0.0",
      main: "index.ts",
    }),
  );
  write(
    "packages/added/index.ts",
    "export function hello(): string { return 'hi'; }",
  );

  git("add -A");
  git("commit -m current");
});

afterAll(() => {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

describe("GitBridge.diffPackage — changed", () => {
  it("returns status 'changed' with before and after", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    const result = bridge.diffPackage(
      baseSha,
      path.join(FIXTURE_ROOT, "packages/stable"),
    );

    expect(result.status).toBe("changed");
    expect(result.before).not.toBeNull();
    expect(result.after).not.toBeNull();
    expect(result.packageName).toBe("@fixture/stable");
  });

  it("emits mutations for structural changes", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    const result = bridge.diffPackage(
      baseSha,
      path.join(FIXTURE_ROOT, "packages/stable"),
    );

    expect(result.mutations.length).toBeGreaterThan(0);
    const mutation = result.mutations.find((m) => m.symbolName === "Config");
    expect(mutation).toBeDefined();
  });
});

describe("GitBridge.diffPackage — added", () => {
  it("returns status 'added' with no before", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    const result = bridge.diffPackage(
      baseSha,
      path.join(FIXTURE_ROOT, "packages/added"),
    );

    expect(result.status).toBe("added");
    expect(result.before).toBeNull();
    expect(result.after).not.toBeNull();
    expect(result.packageName).toBe("@fixture/added");
  });

  it("emits ADDITIVE mutations for every exported symbol", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    const result = bridge.diffPackage(
      baseSha,
      path.join(FIXTURE_ROOT, "packages/added"),
    );

    expect(result.mutations.length).toBeGreaterThan(0);
    expect(result.mutations.every((m) => m.mutationClass === "ADDITIVE")).toBe(
      true,
    );
    expect(result.mutations.every((m) => m.before === null)).toBe(true);
  });

  it("does not throw — no runtime errors", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    expect(() =>
      bridge.diffPackage(baseSha, path.join(FIXTURE_ROOT, "packages/added")),
    ).not.toThrow();
  });
});

describe("GitBridge.diffPackage — deleted", () => {
  it("returns status 'deleted' with no after", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    const result = bridge.diffPackage(
      baseSha,
      path.join(FIXTURE_ROOT, "packages/deleted"),
    );

    expect(result.status).toBe("deleted");
    expect(result.before).not.toBeNull();
    expect(result.after).toBeNull();
    expect(result.packageName).toBe("@fixture/deleted");
  });

  it("emits REMOVED mutations for every exported symbol", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    const result = bridge.diffPackage(
      baseSha,
      path.join(FIXTURE_ROOT, "packages/deleted"),
    );

    expect(result.mutations.length).toBeGreaterThan(0);
    expect(result.mutations.every((m) => m.mutationClass === "REMOVED")).toBe(
      true,
    );
    expect(result.mutations.every((m) => m.after === null)).toBe(true);
  });

  it("does not throw — no runtime errors", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    expect(() =>
      bridge.diffPackage(baseSha, path.join(FIXTURE_ROOT, "packages/deleted")),
    ).not.toThrow();
  });

  it("uses package name from base snapshot when package is gone from disk", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    const result = bridge.diffPackage(
      baseSha,
      path.join(FIXTURE_ROOT, "packages/deleted"),
    );
    expect(result.packageName).toBe("@fixture/deleted");
  });
});
