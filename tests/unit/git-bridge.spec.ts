import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { GitBridge } from "../../src/core/git-bridge.js";

const FIXTURE_ROOT = path.join(os.tmpdir(), "fixtures/git-bridge");
// const FIXTURE_ROOT = path.resolve(import.meta.dirname, "fixtures/git-bridge");

function git(args: string) {
  execSync(`git ${args}`, { cwd: FIXTURE_ROOT, stdio: "pipe" });
}

function write(relPath: string, content: string) {
  const abs = path.join(FIXTURE_ROOT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
}

beforeAll(() => {
  // Clean slate
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true });

  git("init");
  git("config user.email test@example.com");
  git("config user.name Test");

  // Root workspace — use packages/** to pick up nested packages
  write(
    "package.json",
    JSON.stringify({
      name: "root",
      workspaces: ["packages/**"],
    }),
  );

  // packages/alpha
  write(
    "packages/alpha/package.json",
    JSON.stringify({ name: "@fixture/alpha", version: "1.0.0" }),
  );
  write("packages/alpha/index.ts", "export const a = 1;");

  // pre-commit extra.ts so git tracks it (needed for deduplicate test)
  write("packages/alpha/extra.ts", "export const x = 0;");

  // packages/beta
  write(
    "packages/beta/package.json",
    JSON.stringify({ name: "@fixture/beta", version: "1.0.0" }),
  );
  write("packages/beta/index.ts", "export const b = 2;");

  // packages/nested/gamma  (nested package structure)
  write(
    "packages/nested/gamma/package.json",
    JSON.stringify({ name: "@fixture/gamma", version: "1.0.0" }),
  );
  write("packages/nested/gamma/index.ts", "export const c = 3;");

  // Initial commit  → this will be our "base"
  // root-level file (for the "ignored" test)
  write("README.md", "# fixture");

  git("add -A");
  git("commit -m init");
});

afterAll(() => {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

function withWorkingTreeChanges(
  changes: Array<{ rel: string; content: string }>,
  fn: () => void,
) {
  // snapshot originals
  const originals = changes.map(({ rel }) => {
    const abs = path.join(FIXTURE_ROOT, rel);
    // return {
    //   rel,
    //   original: fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : null,
    // };
    return { rel, original: fs.readFileSync(abs, "utf-8") };
  });

  try {
    for (const { rel, content } of changes) {
      write(rel, content);
    }
    fn();
  } finally {
    for (const { rel, original } of originals) {
      //   const abs = path.join(FIXTURE_ROOT, rel);
      //   if (original === null) {
      //     fs.rmSync(abs, { force: true });
      //   } else {
      //     fs.writeFileSync(abs, original, "utf-8");
      //   }
      write(rel, original);
    }
  }
}

describe("GitBridge.getChangedPackages", () => {
  it("returns empty array when nothing changed", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    // No working-tree changes → diff against HEAD is empty
    expect(bridge.getChangedPackages("HEAD")).toEqual([]);
  });

  it("detects a single changed package", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    withWorkingTreeChanges(
      [{ rel: "packages/alpha/index.ts", content: "export const a = 99;" }],
      () => {
        expect(bridge.getChangedPackages("HEAD")).toEqual(["@fixture/alpha"]);
      },
    );
  });

  it("detects multiple changed packages from mixed file changes", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    withWorkingTreeChanges(
      [
        { rel: "packages/alpha/index.ts", content: "export const a = 100;" },
        { rel: "packages/beta/index.ts", content: "export const b = 200;" },
      ],
      () => {
        expect(bridge.getChangedPackages("HEAD")).toEqual([
          "@fixture/alpha",
          "@fixture/beta",
        ]);
      },
    );
  });

  it("handles nested package structures — picks most-specific package", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    withWorkingTreeChanges(
      [
        {
          rel: "packages/nested/gamma/index.ts",
          content: "export const c = 99;",
        },
      ],
      () => {
        expect(bridge.getChangedPackages("HEAD")).toEqual(["@fixture/gamma"]);
      },
    );
  });

  it("deduplicates — multiple files in same package produce one entry", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    // write("packages/alpha/extra.ts", "// temp");

    withWorkingTreeChanges(
      [
        { rel: "packages/alpha/index.ts", content: "export const a = 42;" },
        { rel: "packages/alpha/extra.ts", content: "export const x = 1;" },
      ],
      () => {
        const result = bridge.getChangedPackages("HEAD");
        expect(result).toEqual(["@fixture/alpha"]);
      },
    );

    // clean up the extra file we added outside the helper
    // fs.rmSync(path.join(FIXTURE_ROOT, "packages/alpha/extra.ts"), {
    //   force: true,
    // });
  });

  it("ignores root-level files that belong to no package", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    withWorkingTreeChanges([{ rel: "README.md", content: "# changed" }], () => {
      expect(bridge.getChangedPackages("HEAD")).toEqual([]);
    });
  });

  it("returns sorted, deduplicated package names", () => {
    const bridge = new GitBridge(FIXTURE_ROOT);
    withWorkingTreeChanges(
      [
        { rel: "packages/beta/index.ts", content: "export const b = 9;" },
        { rel: "packages/alpha/index.ts", content: "export const a = 9;" },
        {
          rel: "packages/nested/gamma/index.ts",
          content: "export const c = 9;",
        },
      ],
      () => {
        const result = bridge.getChangedPackages("HEAD");
        expect(result).toEqual([
          "@fixture/alpha",
          "@fixture/beta",
          "@fixture/gamma",
        ]);
      },
    );
  });
});
