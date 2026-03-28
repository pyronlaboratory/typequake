import path from "path";
import os from "os";
import fs from "fs";
import { execSync } from "child_process";
import type {
  MutationRecord,
  PackageDiffResult,
  PackageNode,
  SignatureMap,
} from "../types/index";
import { WorkspaceScanner } from "./workspace-scanner";
import { TypeSurfaceExtractor } from "./type-surface";
import { diff as diffSignatures } from "./semantic-differ.js";

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

  /**
   * Extract the exported type surface of `pkgPath` as it existed at `ref`.
   *
   * Reconstructs the package into a temp directory via `git show`, runs
   * `TypeSurfaceExtractor` against it, then cleans up. The returned
   * `SignatureMap` is identical to what you'd get from checking out `ref`
   * and running the extractor locally.
   *
   * @param ref      Any git ref — HEAD, branch name, or commit SHA.
   * @param pkgPath  Absolute path to the package in the current working tree
   *                 (used to locate files; the name comes from its package.json).
   */
  extractTypeSnapshotAtRef(ref: string, pkgPath: string): SignatureMap {
    const { dir, cleanup } = this.extractPackageAtRef(ref, pkgPath);

    try {
      const extractor = new TypeSurfaceExtractor(dir);
      // Pass no gitSha — caching against the temp dir path is meaningless;
      // callers who want caching should cache the returned SignatureMap themselves.
      return extractor.extract(dir);
    } finally {
      cleanup();
    }
  }

  /**
   * Diff a single workspace package between `baseRef` and the current
   * working tree, handling the three edge cases cleanly:
   *
   *  - "added"   → package exists only in current tree (no before snapshot)
   *  - "deleted" → package exists only at baseRef (no after on disk)
   *  - "changed" → package exists on both sides; runs semantic diff
   *
   * Never throws for edge cases — returns a typed result instead.
   */
  diffPackage(baseRef: string, pkgPath: string): PackageDiffResult {
    const { packages } = this.scanner.analyzeWorkspace();

    const pkgNode = packages.find((p) => p.path === pkgPath);
    const packageName = pkgNode?.name ?? path.basename(pkgPath);

    const existsNow = pkgNode != null;
    const existsAtBase = this.packageExistsAtRef(baseRef, pkgPath);

    // ── Added: only in current tree ──────────────────────────────────────
    if (existsNow && !existsAtBase) {
      const after = this.extractTypeSnapshotAtRef("HEAD", pkgPath);
      // Emit one ADDITIVE record per exported symbol
      const mutations: MutationRecord[] = [...after.values()].map((sig) => ({
        symbolName: sig.name,
        mutationClass: "ADDITIVE",
        before: null,
        after: sig,
        detail: `new export '${sig.name}' added (package added)`,
      }));
      return { packageName, status: "added", before: null, after, mutations };
    }

    // ── Deleted: only at base ref ─────────────────────────────────────────
    if (!existsNow && existsAtBase) {
      const { dir, cleanup } = this.extractPackageAtRef(baseRef, pkgPath);
      try {
        const pkgJsonPath = path.join(dir, "package.json");
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
        const resolvedName = pkgJson.name ?? path.basename(pkgPath);

        const extractor = new TypeSurfaceExtractor(dir);
        const before = extractor.extract(dir);

        const mutations: MutationRecord[] = [...before.values()].map((sig) => ({
          symbolName: sig.name,
          mutationClass: "REMOVED",
          before: sig,
          after: null,
          detail: `export '${sig.name}' removed (package deleted)`,
        }));

        return {
          packageName: resolvedName,
          status: "deleted",
          before,
          after: null,
          mutations,
        };
      } finally {
        cleanup();
      }
    }

    // ── Changed: exists on both sides ────────────────────────────────────
    const before = this.extractTypeSnapshotAtRef(baseRef, pkgPath);
    const extractor = new TypeSurfaceExtractor(this.rootDir);
    const after = extractor.extract(pkgPath);
    const mutations = diffSignatures(before, after);

    return { packageName, status: "changed", before, after, mutations };
  }

  /**
   * Returns true if `pkgPath` has any tracked files at `ref`.
   * Uses `git ls-tree` — no snapshot reconstruction needed.
   */
  private packageExistsAtRef(ref: string, pkgPath: string): boolean {
    const pkgRel = path.relative(this.rootDir, pkgPath).replace(/\\/g, "/");
    const files = gitLsTree(ref, pkgRel, this.rootDir);
    return files.length > 0;
  }
}
