import type { PackageNode, WorkspaceConfig } from "../types";
import { parsePackageJson, resolveGlob } from "../utils/file";

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
