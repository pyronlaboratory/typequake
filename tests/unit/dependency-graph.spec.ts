import { describe, it, expect } from "vitest";
import { buildDependencyGraph } from "../../src/core/dependency-graph";
import type { PackageNode } from "../../src/types";

function createPkg(name: string, dependencies: string[] = []): PackageNode {
  return {
    name,
    version: "1.0.0",
    path: `/packages/${name}`,
    dependencies,
  };
}

describe("buildDependencyGraph", () => {
  it("builds a simple reverse dependency graph", () => {
    const packages: PackageNode[] = [createPkg("A", ["B"]), createPkg("B")];

    const graph = buildDependencyGraph(packages);

    expect(graph.get("A")).toEqual([]);
    expect(graph.get("B")).toEqual(["A"]);
  });

  it("handles multiple dependents", () => {
    const packages: PackageNode[] = [
      createPkg("A", ["C"]),
      createPkg("B", ["C"]),
      createPkg("C"),
    ];

    const graph = buildDependencyGraph(packages);

    expect(graph.get("C")).toEqual(["A", "B"]);
  });

  it("ignores external dependencies", () => {
    const packages: PackageNode[] = [createPkg("A", ["react", "lodash"])];

    const graph = buildDependencyGraph(packages);

    expect(graph.get("A")).toEqual([]);
  });

  it("ignores unknown internal references gracefully", () => {
    const packages: PackageNode[] = [
      createPkg("A", ["B"]), // B does not exist
    ];

    const graph = buildDependencyGraph(packages);

    expect(graph.get("A")).toEqual([]);
    expect(graph.has("B")).toBe(false);
  });

  it("handles circular dependencies", () => {
    const packages: PackageNode[] = [
      createPkg("A", ["B"]),
      createPkg("B", ["A"]),
    ];

    const graph = buildDependencyGraph(packages);

    expect(graph.get("A")).toEqual(["B"]);
    expect(graph.get("B")).toEqual(["A"]);
  });

  it("handles self-dependency safely (should ignore or not duplicate)", () => {
    const packages: PackageNode[] = [createPkg("A", ["A"])];

    const graph = buildDependencyGraph(packages);

    const result = graph.get("A") ?? [];
    expect(result.length).toBeLessThanOrEqual(1);
  });

  it("returns empty dependents for packages with no incoming edges", () => {
    const packages: PackageNode[] = [
      createPkg("A"),
      createPkg("B"),
      createPkg("C"),
    ];

    const graph = buildDependencyGraph(packages);

    expect(graph.get("A")).toEqual([]);
    expect(graph.get("B")).toEqual([]);
    expect(graph.get("C")).toEqual([]);
  });

  it("ensures deterministic ordering (sorted dependents)", () => {
    const packages: PackageNode[] = [
      createPkg("C", ["A"]),
      createPkg("B", ["A"]),
      createPkg("A"),
    ];

    const graph = buildDependencyGraph(packages);

    expect(graph.get("A")).toEqual(["B", "C"]);
  });

  it("includes all packages in the graph", () => {
    const packages: PackageNode[] = [
      createPkg("A", ["B"]),
      createPkg("B"),
      createPkg("C"),
    ];

    const graph = buildDependencyGraph(packages);

    expect(graph.size).toBe(3);
    expect(graph.has("A")).toBe(true);
    expect(graph.has("B")).toBe(true);
    expect(graph.has("C")).toBe(true);
  });

  it("does not duplicate dependents", () => {
    const packages: PackageNode[] = [
      createPkg("A", ["B", "B"]),
      createPkg("B"),
    ];

    const graph = buildDependencyGraph(packages);

    const dependents = graph.get("B") ?? [];
    const unique = new Set(dependents);

    expect(dependents.length).toBe(unique.size);
  });
});
