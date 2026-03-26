import fs from "fs";
import path from "path";

import type { PackageJson } from "../types";

export function hasFile(rootDir: string, file: string): boolean {
  return fs.existsSync(path.join(rootDir, file));
}

export function readPackageJson(rootDir: string): PackageJson {
  const pkgPath = path.join(rootDir, "package.json");

  if (!fs.existsSync(pkgPath)) {
    throw new Error("No package.json found at repository root");
  }

  return JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
}
