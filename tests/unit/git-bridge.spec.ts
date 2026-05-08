import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
} from "vitest";
import { GitBridge } from "../../src/core/git-bridge.js";
import { TypeSurfaceExtractor } from "../../src/core/extract-types";

function git(cwd: string, args: string) {
  fs.mkdirSync(cwd, { recursive: true });
  execSync(`git ${args}`, { cwd, stdio: "pipe" });
}

function write(dir: string, relPath: string, content: string) {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
}

function withWorkingTreeChanges(
  rootDir: string,
  changes: Array<{ rel: string; content: string }>,
  fn: () => void,
) {
  const originals = changes.map(({ rel }) => {
    const abs = path.join(rootDir, rel);
    return { rel, original: fs.readFileSync(abs, "utf-8") };
  });
  try {
    for (const { rel, content } of changes) write(rootDir, rel, content);
    fn();
  } finally {
    for (const { rel, original } of originals) write(rootDir, rel, original);
  }
}

describe("GitBridge API", () => {
  describe("changed package detection", () => {
    const FIXTURE_ROOT = path.join(os.tmpdir(), "fixtures/git-bridge");

    beforeAll(() => {
      fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
      fs.mkdirSync(FIXTURE_ROOT, { recursive: true });

      git(FIXTURE_ROOT, "init");
      git(FIXTURE_ROOT, "config user.email test@example.com");
      git(FIXTURE_ROOT, "config user.name Test");

      write(
        FIXTURE_ROOT,
        "package.json",
        JSON.stringify({ name: "root", workspaces: ["packages/**"] }),
      );
      write(
        FIXTURE_ROOT,
        "packages/alpha/package.json",
        JSON.stringify({ name: "@fixture/alpha", version: "1.0.0" }),
      );
      write(FIXTURE_ROOT, "packages/alpha/index.ts", "export const a = 1;");
      write(FIXTURE_ROOT, "packages/alpha/extra.ts", "export const x = 0;");
      write(
        FIXTURE_ROOT,
        "packages/beta/package.json",
        JSON.stringify({ name: "@fixture/beta", version: "1.0.0" }),
      );
      write(FIXTURE_ROOT, "packages/beta/index.ts", "export const b = 2;");
      write(
        FIXTURE_ROOT,
        "packages/nested/gamma/package.json",
        JSON.stringify({ name: "@fixture/gamma", version: "1.0.0" }),
      );
      write(
        FIXTURE_ROOT,
        "packages/nested/gamma/index.ts",
        "export const c = 3;",
      );
      write(FIXTURE_ROOT, "README.md", "# fixture");

      git(FIXTURE_ROOT, "add -A");
      git(FIXTURE_ROOT, "commit -m init");
    });

    afterAll(() => {
      fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
    });

    it("returns empty array when nothing changed", () => {
      const bridge = new GitBridge(FIXTURE_ROOT);
      expect(bridge.getChangedPackages("HEAD")).toEqual([]);
    });

    it("detects a single changed package", () => {
      const bridge = new GitBridge(FIXTURE_ROOT);
      withWorkingTreeChanges(
        FIXTURE_ROOT,
        [{ rel: "packages/alpha/index.ts", content: "export const a = 99;" }],
        () =>
          expect(bridge.getChangedPackages("HEAD")).toEqual(["@fixture/alpha"]),
      );
    });

    it("detects multiple changed packages", () => {
      const bridge = new GitBridge(FIXTURE_ROOT);
      withWorkingTreeChanges(
        FIXTURE_ROOT,
        [
          { rel: "packages/alpha/index.ts", content: "export const a = 100;" },
          { rel: "packages/beta/index.ts", content: "export const b = 200;" },
        ],
        () =>
          expect(bridge.getChangedPackages("HEAD")).toEqual([
            "@fixture/alpha",
            "@fixture/beta",
          ]),
      );
    });

    it("detects changes in nested workspace packages", () => {
      const bridge = new GitBridge(FIXTURE_ROOT);
      withWorkingTreeChanges(
        FIXTURE_ROOT,
        [
          {
            rel: "packages/nested/gamma/index.ts",
            content: "export const c = 99;",
          },
        ],
        () =>
          expect(bridge.getChangedPackages("HEAD")).toEqual(["@fixture/gamma"]),
      );
    });

    it("deduplicates multiple changed files in the same package", () => {
      const bridge = new GitBridge(FIXTURE_ROOT);
      withWorkingTreeChanges(
        FIXTURE_ROOT,
        [
          { rel: "packages/alpha/index.ts", content: "export const a = 42;" },
          { rel: "packages/alpha/extra.ts", content: "export const x = 1;" },
        ],
        () =>
          expect(bridge.getChangedPackages("HEAD")).toEqual(["@fixture/alpha"]),
      );
    });

    it("ignores root-level files outside workspace packages", () => {
      const bridge = new GitBridge(FIXTURE_ROOT);
      withWorkingTreeChanges(
        FIXTURE_ROOT,
        [{ rel: "README.md", content: "# changed" }],
        () => expect(bridge.getChangedPackages("HEAD")).toEqual([]),
      );
    });

    it("returns package names in sorted order", () => {
      const bridge = new GitBridge(FIXTURE_ROOT);
      withWorkingTreeChanges(
        FIXTURE_ROOT,
        [
          { rel: "packages/beta/index.ts", content: "export const b = 9;" },
          { rel: "packages/alpha/index.ts", content: "export const a = 9;" },
          {
            rel: "packages/nested/gamma/index.ts",
            content: "export const c = 9;",
          },
        ],
        () =>
          expect(bridge.getChangedPackages("HEAD")).toEqual([
            "@fixture/alpha",
            "@fixture/beta",
            "@fixture/gamma",
          ]),
      );
    });
  });

  describe("package extraction at ref", () => {
    const FIXTURE_ROOT = path.join(
      os.tmpdir(),
      "fixtures/git-bridge-extract-ref",
    );
    let initialSha: string;

    beforeAll(() => {
      fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
      fs.mkdirSync(FIXTURE_ROOT, { recursive: true });

      git(FIXTURE_ROOT, "init");
      git(FIXTURE_ROOT, "config user.email test@example.com");
      git(FIXTURE_ROOT, "config user.name Test");

      write(
        FIXTURE_ROOT,
        "package.json",
        JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
      );
      write(
        FIXTURE_ROOT,
        "packages/alpha/package.json",
        JSON.stringify({
          name: "@fixture/alpha",
          version: "1.0.0",
          main: "index.ts",
        }),
      );
      write(
        FIXTURE_ROOT,
        "packages/alpha/tsconfig.json",
        JSON.stringify({ compilerOptions: { strict: true } }),
      );
      write(FIXTURE_ROOT, "packages/alpha/index.ts", "export const a = 1;");
      write(
        FIXTURE_ROOT,
        "packages/alpha/utils.ts",
        "export const util = () => {};",
      );
      write(
        FIXTURE_ROOT,
        "packages/beta/package.json",
        JSON.stringify({
          name: "@fixture/beta",
          version: "1.0.0",
          main: "index.ts",
        }),
      );
      write(FIXTURE_ROOT, "packages/beta/index.ts", "export const b = 2;");

      git(FIXTURE_ROOT, "add -A");
      git(FIXTURE_ROOT, "commit -m init");
      initialSha = execSync("git rev-parse HEAD", {
        cwd: FIXTURE_ROOT,
        encoding: "utf-8",
      }).trim();

      write(FIXTURE_ROOT, "packages/alpha/index.ts", "export const a = 99;");
      git(FIXTURE_ROOT, "add -A");
      git(FIXTURE_ROOT, "commit -m update-alpha");
    });

    afterAll(() => {
      fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
    });

    it("mirrors all tracked files into a temp directory", () => {
      const bridge = new GitBridge(FIXTURE_ROOT);
      const pkgPath = path.join(FIXTURE_ROOT, "packages/alpha");
      const { dir, cleanup } = bridge.extractPackageAtRef("HEAD", pkgPath);
      try {
        expect(fs.existsSync(path.join(dir, "package.json"))).toBe(true);
        expect(fs.existsSync(path.join(dir, "index.ts"))).toBe(true);
        expect(fs.existsSync(path.join(dir, "utils.ts"))).toBe(true);
        expect(fs.existsSync(path.join(dir, "tsconfig.json"))).toBe(true);
      } finally {
        cleanup();
      }
    });

    it("extracts file contents from HEAD", () => {
      const bridge = new GitBridge(FIXTURE_ROOT);
      const { dir, cleanup } = bridge.extractPackageAtRef(
        "HEAD",
        path.join(FIXTURE_ROOT, "packages/alpha"),
      );
      try {
        expect(fs.readFileSync(path.join(dir, "index.ts"), "utf-8")).toContain(
          "export const a = 99;",
        );
      } finally {
        cleanup();
      }
    });

    it("extracts file contents from an older SHA", () => {
      const bridge = new GitBridge(FIXTURE_ROOT);
      const { dir, cleanup } = bridge.extractPackageAtRef(
        initialSha,
        path.join(FIXTURE_ROOT, "packages/alpha"),
      );
      try {
        expect(fs.readFileSync(path.join(dir, "index.ts"), "utf-8")).toContain(
          "export const a = 1;",
        );
      } finally {
        cleanup();
      }
    });

    it("supports branch name refs", () => {
      const bridge = new GitBridge(FIXTURE_ROOT);
      const branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: FIXTURE_ROOT,
        encoding: "utf-8",
      }).trim();
      const { dir, cleanup } = bridge.extractPackageAtRef(
        branch,
        path.join(FIXTURE_ROOT, "packages/alpha"),
      );
      try {
        expect(fs.existsSync(path.join(dir, "index.ts"))).toBe(true);
      } finally {
        cleanup();
      }
    });

    it("synthesizes tsconfig.json when missing", () => {
      const bridge = new GitBridge(FIXTURE_ROOT);
      const { dir, cleanup } = bridge.extractPackageAtRef(
        "HEAD",
        path.join(FIXTURE_ROOT, "packages/beta"),
      );
      try {
        const tsconfigPath = path.join(dir, "tsconfig.json");
        expect(fs.existsSync(tsconfigPath)).toBe(true);
        expect(
          JSON.parse(fs.readFileSync(tsconfigPath, "utf-8")),
        ).toHaveProperty("compilerOptions");
      } finally {
        cleanup();
      }
    });

    it("preserves an existing tsconfig.json", () => {
      const bridge = new GitBridge(FIXTURE_ROOT);
      const { dir, cleanup } = bridge.extractPackageAtRef(
        "HEAD",
        path.join(FIXTURE_ROOT, "packages/alpha"),
      );
      try {
        const parsed = JSON.parse(
          fs.readFileSync(path.join(dir, "tsconfig.json"), "utf-8"),
        );
        expect(parsed.compilerOptions.strict).toBe(true);
        expect(parsed.compilerOptions.skipLibCheck).toBeUndefined();
      } finally {
        cleanup();
      }
    });

    it("removes the temp directory during cleanup", () => {
      const bridge = new GitBridge(FIXTURE_ROOT);
      const { dir, cleanup } = bridge.extractPackageAtRef(
        "HEAD",
        path.join(FIXTURE_ROOT, "packages/alpha"),
      );
      expect(fs.existsSync(dir)).toBe(true);
      cleanup();
      expect(fs.existsSync(dir)).toBe(false);
    });

    it("throws when the package does not exist at the ref", () => {
      const bridge = new GitBridge(FIXTURE_ROOT);
      expect(() =>
        bridge.extractPackageAtRef(
          "HEAD",
          path.join(FIXTURE_ROOT, "packages/nonexistent"),
        ),
      ).toThrow(/No files found/);
    });
  });

  describe("type snapshot extraction", () => {
    const FIXTURE_ROOT = path.join(
      os.tmpdir(),
      "fixtures/git-bridge-snapshot-fixture",
    );
    let initialSha: string;

    beforeAll(() => {
      fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
      fs.mkdirSync(FIXTURE_ROOT, { recursive: true });

      git(FIXTURE_ROOT, "init");
      git(FIXTURE_ROOT, "config user.email test@example.com");
      git(FIXTURE_ROOT, "config user.name Test");

      write(
        FIXTURE_ROOT,
        "package.json",
        JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
      );
      write(
        FIXTURE_ROOT,
        "packages/alpha/package.json",
        JSON.stringify({
          name: "@fixture/alpha",
          version: "1.0.0",
          main: "index.ts",
        }),
      );
      write(
        FIXTURE_ROOT,
        "packages/alpha/tsconfig.json",
        JSON.stringify({
          compilerOptions: { strict: true, skipLibCheck: true, noEmit: true },
        }),
      );
      write(
        FIXTURE_ROOT,
        "packages/alpha/index.ts",
        [
          "export interface User { id: number; name: string; }",
          "export type UserId = number;",
          "export function greet(user: User): string { return user.name; }",
        ].join("\n"),
      );
      write(
        FIXTURE_ROOT,
        "packages/beta/package.json",
        JSON.stringify({
          name: "@fixture/beta",
          version: "1.0.0",
          types: "index.ts",
        }),
      );
      write(
        FIXTURE_ROOT,
        "packages/beta/index.ts",
        "export const VERSION = '1.0.0';\nexport type Status = 'ok' | 'error';",
      );

      git(FIXTURE_ROOT, "add -A");
      git(FIXTURE_ROOT, "commit -m init");
      initialSha = execSync("git rev-parse HEAD", {
        cwd: FIXTURE_ROOT,
        encoding: "utf-8",
      }).trim();

      write(
        FIXTURE_ROOT,
        "packages/alpha/index.ts",
        [
          "export interface User { id: number; name: string; email: string; }",
          "export type UserId = number;",
          "export function greet(user: User): string { return user.name; }",
        ].join("\n"),
      );
      git(FIXTURE_ROOT, "add -A");
      git(FIXTURE_ROOT, "commit -m add-email-to-user");
    });

    afterAll(() => {
      fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
    });

    it("returns exported type signatures", () => {
      const bridge = new GitBridge(FIXTURE_ROOT);
      const signatures = bridge.extractTypeSnapshotAtRef(
        "HEAD",
        path.join(FIXTURE_ROOT, "packages/alpha"),
      );
      expect(signatures.size).toBeGreaterThan(0);
      expect(signatures.has("User")).toBe(true);
      expect(signatures.has("UserId")).toBe(true);
      expect(signatures.has("greet")).toBe(true);
    });

    it("matches TypeSurfaceExtractor output at HEAD", () => {
      const bridge = new GitBridge(FIXTURE_ROOT);
      const pkgPath = path.join(FIXTURE_ROOT, "packages/alpha");
      const fromSnapshot = bridge.extractTypeSnapshotAtRef("HEAD", pkgPath);
      const fromDisk = new TypeSurfaceExtractor(FIXTURE_ROOT).extract(pkgPath);

      expect([...fromSnapshot.keys()]).toEqual([...fromDisk.keys()]);
      for (const [name, sig] of fromDisk) {
        const snapSig = fromSnapshot.get(name)!;
        expect(snapSig.variant).toBe(sig.variant);
        expect(snapSig.typeString).toBe(sig.typeString);
      }
    });

    it("reflects older ref state correctly", () => {
      const bridge = new GitBridge(FIXTURE_ROOT);
      const signatures = bridge.extractTypeSnapshotAtRef(
        initialSha,
        path.join(FIXTURE_ROOT, "packages/alpha"),
      );
      expect(
        signatures.get("User")!.properties?.map((p) => p.name),
      ).not.toContain("email");
    });

    it("reflects HEAD state correctly", () => {
      const bridge = new GitBridge(FIXTURE_ROOT);
      const signatures = bridge.extractTypeSnapshotAtRef(
        "HEAD",
        path.join(FIXTURE_ROOT, "packages/alpha"),
      );
      expect(signatures.get("User")!.properties?.map((p) => p.name)).toContain(
        "email",
      );
    });

    it("works when tsconfig.json is missing", () => {
      const bridge = new GitBridge(FIXTURE_ROOT);
      const signatures = bridge.extractTypeSnapshotAtRef(
        "HEAD",
        path.join(FIXTURE_ROOT, "packages/beta"),
      );
      expect(signatures.has("VERSION")).toBe(true);
      expect(signatures.has("Status")).toBe(true);
    });

    it("supports branch name refs", () => {
      const branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: FIXTURE_ROOT,
        encoding: "utf-8",
      }).trim();
      const bridge = new GitBridge(FIXTURE_ROOT);
      expect(
        bridge
          .extractTypeSnapshotAtRef(
            branch,
            path.join(FIXTURE_ROOT, "packages/alpha"),
          )
          .has("User"),
      ).toBe(true);
    });

    it("cleans up temporary extraction directories", () => {
      const bridge = new GitBridge(FIXTURE_ROOT);
      const pkgPath = path.join(FIXTURE_ROOT, "packages/alpha");
      const original = bridge.extractPackageAtRef.bind(bridge);
      let capturedDir: string | null = null;
      bridge.extractPackageAtRef = (ref, p) => {
        const result = original(ref, p);
        capturedDir = result.dir;
        return result;
      };
      bridge.extractTypeSnapshotAtRef("HEAD", pkgPath);
      expect(capturedDir).not.toBeNull();
      expect(fs.existsSync(capturedDir!)).toBe(false);
    });

    it("throws for a non-existent package", () => {
      const bridge = new GitBridge(FIXTURE_ROOT);
      expect(() =>
        bridge.extractTypeSnapshotAtRef(
          "HEAD",
          path.join(FIXTURE_ROOT, "packages/nonexistent"),
        ),
      ).toThrow(/No files found/);
    });
  });

  describe("diff packages", () => {
    const FIXTURE_ROOT = path.join(
      os.tmpdir(),
      "fixtures/git-bridge-diff-package-fixture",
    );
    let baseSha: string;

    beforeAll(() => {
      fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
      fs.mkdirSync(FIXTURE_ROOT, { recursive: true });

      git(FIXTURE_ROOT, "init");
      git(FIXTURE_ROOT, "config user.email test@example.com");
      git(FIXTURE_ROOT, "config user.name Test");

      write(
        FIXTURE_ROOT,
        "package.json",
        JSON.stringify({ name: "root", workspaces: ["packages/**"] }),
      );
      write(
        FIXTURE_ROOT,
        "packages/stable/package.json",
        JSON.stringify({
          name: "@fixture/stable",
          version: "1.0.0",
          main: "index.ts",
        }),
      );
      write(
        FIXTURE_ROOT,
        "packages/stable/index.ts",
        "export interface Config { timeout: number; }",
      );
      write(
        FIXTURE_ROOT,
        "packages/deleted/package.json",
        JSON.stringify({
          name: "@fixture/deleted",
          version: "1.0.0",
          main: "index.ts",
        }),
      );
      write(
        FIXTURE_ROOT,
        "packages/deleted/index.ts",
        "export interface OldApi { run(): void; }",
      );

      git(FIXTURE_ROOT, "add -A");
      git(FIXTURE_ROOT, "commit -m base");
      baseSha = execSync("git rev-parse HEAD", {
        cwd: FIXTURE_ROOT,
        encoding: "utf-8",
      }).trim();

      write(
        FIXTURE_ROOT,
        "packages/stable/index.ts",
        "export interface Config { timeout: number; retries: number; }",
      );
      fs.rmSync(path.join(FIXTURE_ROOT, "packages/deleted"), {
        recursive: true,
        force: true,
      });
      write(
        FIXTURE_ROOT,
        "packages/added/package.json",
        JSON.stringify({
          name: "@fixture/added",
          version: "1.0.0",
          main: "index.ts",
        }),
      );
      write(
        FIXTURE_ROOT,
        "packages/added/index.ts",
        "export function hello(): string { return 'hi'; }",
      );

      git(FIXTURE_ROOT, "add -A");
      git(FIXTURE_ROOT, "commit -m current");
    });

    afterAll(() => {
      fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
    });

    describe("changed packages", () => {
      it("returns changed status with before and after snapshots", () => {
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

      it("emits mutations for structural type changes", () => {
        const bridge = new GitBridge(FIXTURE_ROOT);
        const result = bridge.diffPackage(
          baseSha,
          path.join(FIXTURE_ROOT, "packages/stable"),
        );
        expect(result.mutations.length).toBeGreaterThan(0);
        expect(
          result.mutations.find((m) => m.symbolName === "Config"),
        ).toBeDefined();
      });
    });

    describe("added packages", () => {
      it("returns added status with no before snapshot", () => {
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
        expect(
          result.mutations.every((m) => m.mutationClass === "ADDITIVE"),
        ).toBe(true);
        expect(result.mutations.every((m) => m.before === null)).toBe(true);
      });

      it("does not throw for newly added packages", () => {
        const bridge = new GitBridge(FIXTURE_ROOT);
        expect(() =>
          bridge.diffPackage(
            baseSha,
            path.join(FIXTURE_ROOT, "packages/added"),
          ),
        ).not.toThrow();
      });
    });

    describe("deleted packages", () => {
      it("returns deleted status with no after snapshot", () => {
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
        expect(
          result.mutations.every((m) => m.mutationClass === "REMOVED"),
        ).toBe(true);
        expect(result.mutations.every((m) => m.after === null)).toBe(true);
      });

      it("does not throw for deleted packages", () => {
        const bridge = new GitBridge(FIXTURE_ROOT);
        expect(() =>
          bridge.diffPackage(
            baseSha,
            path.join(FIXTURE_ROOT, "packages/deleted"),
          ),
        ).not.toThrow();
      });

      it("resolves package name from the base ref when package is deleted", () => {
        const bridge = new GitBridge(FIXTURE_ROOT);
        const result = bridge.diffPackage(
          baseSha,
          path.join(FIXTURE_ROOT, "packages/deleted"),
        );
        expect(result.packageName).toBe("@fixture/deleted");
      });
    });
  });

  describe("cache control", () => {
    let rootDir: string;
    let pkgPath: string;
    let baseSha: string;

    beforeEach(() => {
      rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "tq-cache-test-"));
      git(rootDir, "init");
      git(rootDir, "config user.email test@example.com");
      git(rootDir, "config user.name Test");

      write(
        rootDir,
        "package.json",
        JSON.stringify({ name: "root", workspaces: ["packages/**"] }),
      );
      pkgPath = path.join(rootDir, "packages/a");
      write(
        rootDir,
        "packages/a/package.json",
        JSON.stringify({ name: "a", version: "1.0.0", main: "index.ts" }),
      );
      write(rootDir, "packages/a/index.ts", "export const a = 1;");

      git(rootDir, "add -A");
      git(rootDir, "commit -m base");
      baseSha = execSync("git rev-parse HEAD", {
        cwd: rootDir,
        encoding: "utf-8",
      }).trim();
    });

    afterEach(() => {
      fs.rmSync(rootDir, { recursive: true, force: true });
    });

    it("bypasses cache creation when cache is disabled", () => {
      const bridge = new GitBridge(rootDir);
      bridge.diffPackage(baseSha, pkgPath, { cache: true });
      const cacheDir = path.join(rootDir, ".typequake", "cache");
      expect(fs.existsSync(cacheDir)).toBe(true);
      expect(fs.readdirSync(cacheDir).length).toBeGreaterThan(0);

      fs.rmSync(cacheDir, { recursive: true, force: true });
      bridge.diffPackage(baseSha, pkgPath, { cache: false });
      expect(fs.existsSync(cacheDir)).toBe(false);
    });

    it("ignores corrupted cache files when cache is disabled", () => {
      const bridge = new GitBridge(rootDir);
      bridge.diffPackage(baseSha, pkgPath, { cache: true });
      const cacheDir = path.join(rootDir, ".typequake", "cache");
      const cacheFile = fs.readdirSync(cacheDir)[0]!;
      fs.writeFileSync(
        path.join(cacheDir, cacheFile),
        "invalid { json",
        "utf-8",
      );

      expect(() =>
        bridge.diffPackage(baseSha, pkgPath, { cache: false }),
      ).not.toThrow();
    });
  });
});
