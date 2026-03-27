import fs from "fs";
import path from "path";
import type { SignatureMap, TypeSignature } from "../types/index.js";

/**
 * Normalise a package name so it is safe to embed in a filename.
 *   "@scope/pkg"  →  "scope__pkg"
 *   "my-pkg"      →  "my-pkg"
 */
function safePkgName(pkgName: string): string {
  return pkgName.replace(/^@/, "").replace(/\//g, "__");
}

function cachePath(rootDir: string, pkgName: string, gitSha: string): string {
  return path.join(
    rootDir,
    ".typequake",
    "cache",
    `${safePkgName(pkgName)}.${gitSha}.json`,
  );
}

/**
 * Attempt to load a previously-cached SignatureMap from disk.
 * Returns `null` on any failure (missing file, corrupt JSON, schema mismatch).
 */
export function readCache(
  rootDir: string,
  pkgName: string,
  gitSha: string,
): SignatureMap | null {
  const p = cachePath(rootDir, pkgName, gitSha);
  if (!fs.existsSync(p)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<
      string,
      TypeSignature
    >;
    if (typeof raw !== "object" || raw === null) return null;

    const map: SignatureMap = new Map();
    for (const [key, value] of Object.entries(raw)) {
      map.set(key, value);
    }
    return map;
  } catch {
    return null;
  }
}

/**
 * Persist a SignatureMap to disk under `.typequake/cache/`.
 * Creates the directory if it does not exist.
 */
export function writeCache(
  rootDir: string,
  pkgName: string,
  gitSha: string,
  signatures: SignatureMap,
): void {
  const p = cachePath(rootDir, pkgName, gitSha);
  fs.mkdirSync(path.dirname(p), { recursive: true });

  const obj: Record<string, TypeSignature> = {};
  for (const [key, value] of signatures.entries()) {
    obj[key] = value;
  }

  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf-8");
}

/**
 * Remove a single cache entry (useful for testing).
 */
export function deleteCache(
  rootDir: string,
  pkgName: string,
  gitSha: string,
): void {
  const p = cachePath(rootDir, pkgName, gitSha);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
