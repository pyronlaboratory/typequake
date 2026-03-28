import path from "path";
import os from "os";
import fs from "fs";
import { execSync } from "child_process";
import type { PackageNode } from "../types/index.js";
import { WorkspaceScanner } from "./workspace-scanner.js";

function runGit(args: string, cwd: string): string {
  try {
    return execSync(`git ${args}`, { cwd, encoding: "utf-8" });
  } catch (err: any) {
    throw new Error(`git ${args.split(" ")[0]} failed: ${err.message ?? err}`);
  }
}

/**
 * Normalise a raw path from `git diff --name-only` to a consistent
 * forward-slash, relative form regardless of OS.
 */
function normalisePath(p: string): string {
  return p.trim().replace(/\\/g, "/");
}

/**
 * Given a normalised relative file path and the list of known workspace
 * packages (each with an absolute `path`), return the package whose directory
 * is the longest prefix of the file — i.e. the most-specific match.
 *
 * Returns `null` for files that belong to no package (e.g. root-level files).
 */
function matchPackage(
  relativePath: string,
  rootDir: string,
  packages: PackageNode[],
): PackageNode | null {
  let best: PackageNode | null = null;
  let bestLen = -1;

  for (const pkg of packages) {
    // Convert absolute package path → forward-slash relative path from root.
    const pkgRel = path.relative(rootDir, pkg.path).replace(/\\/g, "/");

    // A file belongs to this package if its path starts with pkgRel + "/".
    if (relativePath === pkgRel || relativePath.startsWith(pkgRel + "/")) {
      if (pkgRel.length > bestLen) {
        best = pkg;
        bestLen = pkgRel.length;
      }
    }
  }

  return best;
}

/**
 * Attempt to read a file's content at a given git ref via `git show`.
 * Returns `null` if the file did not exist at that ref.
 */
function gitShow(ref: string, repoRelPath: string, cwd: string): string | null {
  try {
    return execSync(`git show ${ref}:${repoRelPath}`, {
      cwd,
      encoding: "utf-8",
    });
  } catch {
    return null;
  }
}

/**
 * List all files tracked under a given path prefix at a ref.
 * Uses `git ls-tree -r --name-only` which works for HEAD, branches, and SHAs.
 */
function gitLsTree(ref: string, prefix: string, cwd: string): string[] {
  try {
    const out = execSync(`git ls-tree -r --name-only ${ref} -- ${prefix}`, {
      cwd,
      encoding: "utf-8",
    });
    return out.split("\n").map(normalisePath).filter(Boolean);
  } catch {
    return [];
  }
}

const SYNTHESIZED_TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      moduleResolution: "node",
      esModuleInterop: true,
    },
  },
  null,
  2,
);

export class GitBridge {
  private readonly scanner: WorkspaceScanner;

  constructor(private readonly rootDir: string) {
    this.scanner = new WorkspaceScanner(rootDir);
  }

  /**
   * Returns the deduplicated list of workspace package names that contain
   * at least one file changed between `baseRef` and the current working tree.
   *
   * Uses `git diff --name-only <baseRef>` so untracked / unstaged changes are
   * included via the working-tree diff.
   */
  getChangedPackages(baseRef: string): string[] {
    const raw = runGit(`diff --name-only ${baseRef}`, this.rootDir);

    const changedFiles = raw.split("\n").map(normalisePath).filter(Boolean);

    if (changedFiles.length === 0) return [];

    const { packages } = this.scanner.analyzeWorkspace();

    const affected = new Set<string>();

    for (const file of changedFiles) {
      const pkg = matchPackage(file, this.rootDir, packages);
      if (pkg) affected.add(pkg.name);
    }

    return Array.from(affected).sort();
  }

  /**
   * Reconstruct a package's full file system state at `ref` into a temp
   * directory. The caller receives the temp dir path and a `cleanup` function
   * that removes it. All files tracked under the package path at `ref` are
   * mirrored; a `tsconfig.json` is synthesized if one is absent.
   *
   * @returns `{ dir, cleanup }` — call `cleanup()` when done.
   */
  extractPackageAtRef(
    ref: string,
    pkgPath: string,
  ): { dir: string; cleanup: () => void } {
    // pkgPath relative to repo root (forward slashes)
    const pkgRel = path.relative(this.rootDir, pkgPath).replace(/\\/g, "/");

    const trackedFiles = gitLsTree(ref, pkgRel, this.rootDir);

    if (trackedFiles.length === 0) {
      throw new Error(
        `No files found for path "${pkgRel}" at ref "${ref}". ` +
          `The package may not exist at this ref.`,
      );
    }

    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "typequake-snapshot-"),
    );

    const cleanup = () => fs.rmSync(tmpDir, { recursive: true, force: true });

    try {
      for (const repoRelFile of trackedFiles) {
        const content = gitShow(ref, repoRelFile, this.rootDir);
        if (content === null) continue;

        // Strip the package prefix to get the path inside the temp dir.
        const relativeToPackage = repoRelFile.slice(pkgRel.length + 1);
        const dest = path.join(tmpDir, relativeToPackage);

        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, content, "utf-8");
      }

      // Synthesize tsconfig.json if the package didn't have one at this ref.
      const tsconfigDest = path.join(tmpDir, "tsconfig.json");
      if (!fs.existsSync(tsconfigDest)) {
        fs.writeFileSync(tsconfigDest, SYNTHESIZED_TSCONFIG, "utf-8");
      }
    } catch (err) {
      cleanup();
      throw err;
    }

    return { dir: tmpDir, cleanup };
  }
}
