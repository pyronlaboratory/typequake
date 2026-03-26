import fs from "fs";
import path from "path";

import type { PackageJson, PackageNode } from "../types";

export function isDirectory(path: string): boolean {
  try {
    return fs.statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function hasFile(rootDir: string, file: string): boolean {
  return fs.existsSync(path.join(rootDir, file));
}

export function parsePackageJson(packagePath: string): PackageNode | null {
  const pkgJsonPath = path.join(packagePath, "package.json");
  if (!fs.existsSync(pkgJsonPath)) return null;

  let json: PackageJson;
  try {
    json = readJson(pkgJsonPath);
  } catch {
    return null;
  }

  if (!json.name) return null;

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

export function readPackageJson(rootDir: string): PackageJson {
  const pkgPath = path.join(rootDir, "package.json");

  if (!fs.existsSync(pkgPath)) {
    throw new Error("No package.json found at repository root");
  }

  return readJson(pkgPath);
}

export function readJson(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

export function resolveGlob(rootDir: string, glob: string): string[] {
  // supports:
  // - packages/*
  // - packages/** (optional shallow recursion)

  const parts = glob.split("/");
  const baseDir = path.join(rootDir, parts[0]!);

  if (!isDirectory(baseDir)) return [];

  const results: string[] = [];

  const entries = fs.readdirSync(baseDir);

  for (const entry of entries) {
    const fullPath = path.join(baseDir, entry);

    if (!isDirectory(fullPath)) continue;

    results.push(fullPath);

    // optional: support "**"
    if (glob.includes("**")) {
      const subEntries = fs.readdirSync(fullPath);
      for (const sub of subEntries) {
        const subPath = path.join(fullPath, sub);
        if (isDirectory(subPath)) {
          results.push(subPath);
        }
      }
    }
  }

  return results;
}
