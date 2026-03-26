import type { DependencyGraph, PackageNode } from "../types";

export function buildDependencyGraph(packages: PackageNode[]): DependencyGraph {
  const graph = new Map<string, Set<string>>();

  const packageNames = new Set(packages.map((p) => p.name));

  for (const pkg of packages) {
    graph.set(pkg.name, new Set());
  }

  for (const pkg of packages) {
    for (const dep of pkg.dependencies) {
      if (!packageNames.has(dep)) continue;

      const dependents = graph.get(dep);
      if (!dependents) continue; // safety guard

      dependents.add(pkg.name);
    }
  }

  const result: DependencyGraph = new Map();

  for (const [key, dependentsSet] of graph.entries()) {
    const sorted = Array.from(dependentsSet).sort();
    result.set(key, sorted);
  }

  return result;
}
