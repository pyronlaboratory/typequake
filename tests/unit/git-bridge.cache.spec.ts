import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { GitBridge } from "../../src/core/git-bridge.js";

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tq-cache-test-"));
  return dir;
}

function git(dir: string, args: string) {
  execSync(`git ${args}`, { cwd: dir, stdio: "pipe" });
}

function write(dir: string, relPath: string, content: string) {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
}

describe("GitBridge – Cache Bypass", () => {
  let rootDir: string;
  let pkgPath: string;
  let baseSha: string;

  beforeEach(() => {
    rootDir = makeTmpDir();
    git(rootDir, "init");
    git(rootDir, "config user.email test@example.com");
    git(rootDir, "config user.name Test");

    write(rootDir, "package.json", JSON.stringify({ name: "root", workspaces: ["packages/**"] }));
    pkgPath = path.join(rootDir, "packages/a");
    write(rootDir, "packages/a/package.json", JSON.stringify({ name: "a", version: "1.0.0", main: "index.ts" }));
    write(rootDir, "packages/a/index.ts", "export const a = 1;");

    git(rootDir, "add -A");
    git(rootDir, "commit -m base");
    baseSha = execSync("git rev-parse HEAD", { cwd: rootDir, encoding: "utf-8" }).trim();
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("bypasses disk cache when options.cache is false", () => {
    const bridge = new GitBridge(rootDir);
    
    // 1. First run - populates cache
    bridge.diffPackage(baseSha, pkgPath, { cache: true });
    const cacheDir = path.join(rootDir, ".typequake", "cache");
    expect(fs.existsSync(cacheDir)).toBe(true);
    const firstCacheFiles = fs.readdirSync(cacheDir);
    expect(firstCacheFiles.length).toBeGreaterThan(0);

    // 2. Clear cache directory to be sure
    fs.rmSync(cacheDir, { recursive: true, force: true });
    expect(fs.existsSync(cacheDir)).toBe(false);

    // 3. Run with cache: false
    // It should re-extract without creating new cache files
    bridge.diffPackage(baseSha, pkgPath, { cache: false });

    // 4. Verify no cache was created
    expect(fs.existsSync(cacheDir)).toBe(false);
  });

  it("ignores existing cache files when options.cache is false", () => {
    const bridge = new GitBridge(rootDir);
    
    // 1. Populate cache
    bridge.diffPackage(baseSha, pkgPath, { cache: true });
    const cacheDir = path.join(rootDir, ".typequake", "cache");
    expect(fs.readdirSync(cacheDir).length).toBeGreaterThan(0);

    // 2. Corrupt the cache file on disk
    const cacheFile = fs.readdirSync(cacheDir)[0]!;
    const cacheFilePath = path.join(cacheDir, cacheFile);
    fs.writeFileSync(cacheFilePath, "invalid { json", "utf-8");

    // 3. Run with cache: false
    // It should bypass reading the corrupted cache and succeed by re-extracting
    expect(() => bridge.diffPackage(baseSha, pkgPath, { cache: false })).not.toThrow();
  });
});
