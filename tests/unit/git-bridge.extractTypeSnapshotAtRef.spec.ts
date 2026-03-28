import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { GitBridge } from "../../src/core/git-bridge.js";
import { TypeSurfaceExtractor } from "../../src/core/type-surface.js";

const FIXTURE_ROOT = path.join(
  os.tmpdir(),
  "fixtures/git-bridge-snapshot-fixture",
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

let initialSha: string;

beforeAll(() => {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true });

  git("init");
  git("config user.email test@example.com");
  git("config user.name Test");

  write(
    "package.json",
    JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
  );

  // packages/alpha — explicit main entry, with tsconfig
  write(
    "packages/alpha/package.json",
    JSON.stringify({
      name: "@fixture/alpha",
      version: "1.0.0",
      main: "index.ts",
    }),
  );
  write(
    "packages/alpha/tsconfig.json",
    JSON.stringify({
      compilerOptions: { strict: true, skipLibCheck: true, noEmit: true },
    }),
  );
  write(
    "packages/alpha/index.ts",
    [
      "export interface User { id: number; name: string; }",
      "export type UserId = number;",
      "export function greet(user: User): string { return user.name; }",
    ].join("\n"),
  );

  // packages/beta — no tsconfig, entry via `types` field
  write(
    "packages/beta/package.json",
    JSON.stringify({
      name: "@fixture/beta",
      version: "1.0.0",
      types: "index.ts",
    }),
  );
  write(
    "packages/beta/index.ts",
    "export const VERSION = '1.0.0';\nexport type Status = 'ok' | 'error';",
  );

  git("add -A");
  git("commit -m init");

  initialSha = execSync("git rev-parse HEAD", {
    cwd: FIXTURE_ROOT,
    encoding: "utf-8",
  }).trim();

  // Second commit — breaking change to alpha
  write(
    "packages/alpha/index.ts",
    [
      "export interface User { id: number; name: string; email: string; }",
      "export type UserId = number;",
      "export function greet(user: User): string { return user.name; }",
    ].join("\n"),
  );

  git("add -A");
  git("commit -m add-email-to-user");
});

afterAll(() => {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

describe("GitBridge.extractTypeSnapshotAtRef", () => {
  it("returns a SignatureMap with exported symbols", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    const pkgPath = path.join(FIXTURE_ROOT, "packages/alpha");

    const signatures = bridge.extractTypeSnapshotAtRef("HEAD", pkgPath);

    expect(signatures.size).toBeGreaterThan(0);
    expect(signatures.has("User")).toBe(true);
    expect(signatures.has("UserId")).toBe(true);
    expect(signatures.has("greet")).toBe(true);
  });

  it("output matches TypeSurfaceExtractor run on actual checkout at HEAD", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    const pkgPath = path.join(FIXTURE_ROOT, "packages/alpha");

    const fromSnapshot = bridge.extractTypeSnapshotAtRef("HEAD", pkgPath);

    // Run extractor directly on the working tree (which is at HEAD)
    const extractor = new TypeSurfaceExtractor(FIXTURE_ROOT);
    const fromDisk = extractor.extract(pkgPath);

    expect([...fromSnapshot.keys()]).toEqual([...fromDisk.keys()]);

    for (const [name, sig] of fromDisk) {
      const snapSig = fromSnapshot.get(name)!;
      expect(snapSig.variant).toBe(sig.variant);
      expect(snapSig.typeString).toBe(sig.typeString);
    }
  });

  it("reflects the state at an older SHA — User has no email", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    const pkgPath = path.join(FIXTURE_ROOT, "packages/alpha");

    const signatures = bridge.extractTypeSnapshotAtRef(initialSha, pkgPath);
    const user = signatures.get("User");

    expect(user).toBeDefined();
    expect(user!.properties?.map((p) => p.name)).not.toContain("email");
  });

  it("reflects the state at HEAD — User has email", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    const pkgPath = path.join(FIXTURE_ROOT, "packages/alpha");

    const signatures = bridge.extractTypeSnapshotAtRef("HEAD", pkgPath);
    const user = signatures.get("User");

    expect(user).toBeDefined();
    expect(user!.properties?.map((p) => p.name)).toContain("email");
  });

  it("works for a package with no tsconfig (synthesized config)", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    const pkgPath = path.join(FIXTURE_ROOT, "packages/beta");

    const signatures = bridge.extractTypeSnapshotAtRef("HEAD", pkgPath);

    expect(signatures.has("VERSION")).toBe(true);
    expect(signatures.has("Status")).toBe(true);
  });

  it("works with a branch name ref", () => {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: FIXTURE_ROOT,
      encoding: "utf-8",
    }).trim();

    const bridge = new GitBridge(FIXTURE_ROOT);
    const pkgPath = path.join(FIXTURE_ROOT, "packages/alpha");
    const signatures = bridge.extractTypeSnapshotAtRef(branch, pkgPath);

    expect(signatures.has("User")).toBe(true);
  });

  it("cleans up temp dir after extraction", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    const pkgPath = path.join(FIXTURE_ROOT, "packages/alpha");

    // Intercept extractPackageAtRef to capture the temp dir path
    const original = bridge.extractPackageAtRef.bind(bridge);
    let capturedDir: string | null = null;

    bridge.extractPackageAtRef = (ref, path) => {
      const result = original(ref, path);
      capturedDir = result.dir;
      return result;
    };

    bridge.extractTypeSnapshotAtRef("HEAD", pkgPath);

    expect(capturedDir).not.toBeNull();
    expect(fs.existsSync(capturedDir!)).toBe(false);
  });

  it("throws for a non-existent package at ref", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    const pkgPath = path.join(FIXTURE_ROOT, "packages/nonexistent");

    expect(() => bridge.extractTypeSnapshotAtRef("HEAD", pkgPath)).toThrow(
      /No files found/,
    );
  });
});
