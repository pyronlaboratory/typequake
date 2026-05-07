import type { DependencyGraph } from "../types";

export function getTransitiveDependents(
  packageName: string,
  graph: DependencyGraph,
): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  const queue: string[] = [];

  visited.add(packageName);
  const direct = graph.get(packageName) ?? [];

  for (const dep of direct) {
    queue.push(dep);
    visited.add(dep);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;

    result.push(current);

    const next = graph.get(current) ?? [];

    for (const dep of next) {
      if (!visited.has(dep)) {
        visited.add(dep);
        queue.push(dep);
      }
    }
  }

  return result.sort();
}
