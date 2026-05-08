import fs from "fs";
import path from "path";

import type { PackageNode, PackageJson, WorkspaceConfig } from "../types";

// Helpers
function isDirectory(path: string): boolean {
  try {
    return fs.statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readJson(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function parsePackageJson(packagePath: string): PackageNode | null {
  const pkgJsonPath = path.join(packagePath, "package.json");
  if (!fs.existsSync(pkgJsonPath)) return null;

  let json: PackageJson;
  try {
    json = readJson(pkgJsonPath);
  } catch {
    return null;
  }

  if (!json || !json.name) return null;

  const deps = {
    ...json.dependencies,
    ...json.devDependencies,
  };

  return {
    name: json.name,
    version: json.version ?? "0.0.0",
    path: packagePath,
    dependencies: deps ? Object.keys(deps) : [],
  };
}

export function resolveGlob(rootDir: string, glob: string): string[] {
  const results: string[] = [];

  function walk(currentDir: string, segments: string[]): void {
    if (segments.length === 0) {
      if (isDirectory(currentDir)) {
        results.push(currentDir);
      }
      return;
    }

    const [head, ...tail] = segments;

    // (**) Matches the current directory AND any subdirectory recursively
    if (head === "**") {
      // Match current directory with the rest of the pattern
      walk(currentDir, tail);

      // Match subdirectories recursively
      let entries: string[];
      try {
        entries = fs.readdirSync(currentDir);
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry);
        if (isDirectory(fullPath)) {
          walk(fullPath, segments); // continue matching ** in subdirs
        }
      }
    } else if (head?.includes("*")) {
      // Handle segments with wildcards like '*' or 'react-*'
      let entries: string[];
      try {
        entries = fs.readdirSync(currentDir);
      } catch {
        return;
      }

      // Simple wildcard to regex conversion
      const pattern = new RegExp(
        "^" + head.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$",
      );

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry);
        if (pattern.test(entry) && isDirectory(fullPath)) {
          walk(fullPath, tail);
        }
      }
    } else {
      const fullPath = path.join(currentDir, head!);
      if (fs.existsSync(fullPath)) {
        walk(fullPath, tail);
      }
    }
  }

  // Normalize glob: remove trailing slashes and split
  const segments = glob.replace(/\/+$/, "").split("/");
  walk(rootDir, segments);

  // De-duplicate results
  return Array.from(new Set(results));
}

export function discoverPackages(config: WorkspaceConfig): PackageNode[] {
  const allPaths = new Set<string>();

  for (const glob of config.packageGlobs) {
    const paths = resolveGlob(config.rootDir, glob);
    for (const p of paths) {
      allPaths.add(p);
    }
  }

  const packages: PackageNode[] = [];

  for (const packagePath of allPaths) {
    const parsed = parsePackageJson(packagePath);
    if (parsed) {
      packages.push(parsed);
    }
  }

  // deterministic ordering
  packages.sort((a, b) => a.name.localeCompare(b.name));

  return packages;
}
