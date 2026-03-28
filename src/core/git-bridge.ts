import path from "path";
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

export class GitBridge {
  private readonly scanner: WorkspaceScanner;

  constructor(private readonly rootDir: string) {
    this.scanner = new WorkspaceScanner(rootDir);
  }

  /**
   * Returns the deduplicated list of workspace package **names** that contain
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
}
