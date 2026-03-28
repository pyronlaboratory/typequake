import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { GitBridge } from "../../src/core/git-bridge.js";

const FIXTURE_ROOT = path.join(os.tmpdir(), "fixtures/git-bridge-extract-ref");

function git(args: string) {
  execSync(`git ${args}`, { cwd: FIXTURE_ROOT, stdio: "pipe" });
}

function write(relPath: string, content: string) {
  const abs = path.join(FIXTURE_ROOT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
}

let initialSha: string;
let amendedSha: string;

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

  // packages/alpha — has a tsconfig
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
    JSON.stringify({ compilerOptions: { strict: true } }),
  );
  write("packages/alpha/index.ts", "export const a = 1;");
  write("packages/alpha/utils.ts", "export const util = () => {};");

  // packages/beta — no tsconfig (should be synthesized)
  write(
    "packages/beta/package.json",
    JSON.stringify({
      name: "@fixture/beta",
      version: "1.0.0",
      main: "index.ts",
    }),
  );
  write("packages/beta/index.ts", "export const b = 2;");

  git("add -A");
  git("commit -m init");

  initialSha = execSync("git rev-parse HEAD", {
    cwd: FIXTURE_ROOT,
    encoding: "utf-8",
  }).trim();

  // Second commit — modify alpha so we can diff between SHAs
  write("packages/alpha/index.ts", "export const a = 99;");
  git("add -A");
  git("commit -m update-alpha");

  amendedSha = execSync("git rev-parse HEAD", {
    cwd: FIXTURE_ROOT,
    encoding: "utf-8",
  }).trim();
});

afterAll(() => {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

describe("GitBridge.extractPackageAtRef", () => {
  it("mirrors all tracked files into temp dir", () => {
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

  it("file contents match the ref — HEAD has updated value", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    const pkgPath = path.join(FIXTURE_ROOT, "packages/alpha");
    const { dir, cleanup } = bridge.extractPackageAtRef("HEAD", pkgPath);

    try {
      const content = fs.readFileSync(path.join(dir, "index.ts"), "utf-8");
      expect(content).toContain("export const a = 99;");
    } finally {
      cleanup();
    }
  });

  it("file contents match the ref — initial SHA has original value", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    const pkgPath = path.join(FIXTURE_ROOT, "packages/alpha");
    const { dir, cleanup } = bridge.extractPackageAtRef(initialSha, pkgPath);

    try {
      const content = fs.readFileSync(path.join(dir, "index.ts"), "utf-8");
      expect(content).toContain("export const a = 1;");
    } finally {
      cleanup();
    }
  });

  it("works with a branch name ref", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    const pkgPath = path.join(FIXTURE_ROOT, "packages/alpha");
    // The default branch (main or master) points to HEAD
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: FIXTURE_ROOT,
      encoding: "utf-8",
    }).trim();

    const { dir, cleanup } = bridge.extractPackageAtRef(branch, pkgPath);

    try {
      expect(fs.existsSync(path.join(dir, "index.ts"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("synthesizes tsconfig.json when package has none at ref", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    const pkgPath = path.join(FIXTURE_ROOT, "packages/beta");
    const { dir, cleanup } = bridge.extractPackageAtRef("HEAD", pkgPath);

    try {
      const tsconfigPath = path.join(dir, "tsconfig.json");
      expect(fs.existsSync(tsconfigPath)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8"));
      expect(parsed).toHaveProperty("compilerOptions");
    } finally {
      cleanup();
    }
  });

  it("preserves real tsconfig.json when present", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    const pkgPath = path.join(FIXTURE_ROOT, "packages/alpha");
    const { dir, cleanup } = bridge.extractPackageAtRef("HEAD", pkgPath);

    try {
      const parsed = JSON.parse(
        fs.readFileSync(path.join(dir, "tsconfig.json"), "utf-8"),
      );
      // The real tsconfig has strict: true directly (not synthesized)
      expect(parsed.compilerOptions.strict).toBe(true);
      // Synthesized tsconfig would also have skipLibCheck — real one doesn't
      expect(parsed.compilerOptions.skipLibCheck).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("cleans up temp dir after cleanup()", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    const pkgPath = path.join(FIXTURE_ROOT, "packages/alpha");
    const { dir, cleanup } = bridge.extractPackageAtRef("HEAD", pkgPath);

    expect(fs.existsSync(dir)).toBe(true);
    cleanup();
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("throws for a package path that does not exist at ref", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    const pkgPath = path.join(FIXTURE_ROOT, "packages/nonexistent");

    expect(() => bridge.extractPackageAtRef("HEAD", pkgPath)).toThrow(
      /No files found/,
    );
  });
});
