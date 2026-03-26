import { describe, it, expect } from "vitest";
import { getTransitiveDependents } from "../../src/core/transitive-dependents";
import type { DependencyGraph } from "../../src/types";

function createGraph(entries: Record<string, string[]>): DependencyGraph {
  return new Map(Object.entries(entries));
}

describe("getTransitiveDependents", () => {
  it("returns direct dependents", () => {
    const graph = createGraph({
      A: [],
      B: ["A"],
    });

    expect(getTransitiveDependents("B", graph)).toEqual(["A"]);
  });

  it("handles linear chains", () => {
    const graph = createGraph({
      A: [],
      B: ["A"],
      C: ["B"],
    });

    expect(getTransitiveDependents("C", graph)).toEqual(["A", "B"]);
  });

  it("handles diamond dependencies", () => {
    const graph = createGraph({
      A: [],
      B: ["A"],
      C: ["A"],
      D: ["B", "C"],
    });

    expect(getTransitiveDependents("D", graph)).toEqual(["A", "B", "C"]);
  });

  it("handles cycles without infinite loops", () => {
    const graph = createGraph({
      A: ["B"],
      B: ["A"],
    });

    expect(getTransitiveDependents("A", graph)).toEqual(["B"]);
  });

  it("handles deeper cycles", () => {
    const graph = createGraph({
      A: ["B"],
      B: ["C"],
      C: ["A"],
    });

    expect(getTransitiveDependents("A", graph)).toEqual(["B", "C"]);
  });

  it("returns empty array if no dependents", () => {
    const graph = createGraph({
      A: [],
    });

    expect(getTransitiveDependents("A", graph)).toEqual([]);
  });

  it("ignores unknown package", () => {
    const graph = createGraph({
      A: ["B"],
    });

    expect(getTransitiveDependents("Z", graph)).toEqual([]);
  });

  it("ensures deterministic output (sorted)", () => {
    const graph = createGraph({
      A: [],
      B: ["A"],
      C: ["A"],
      D: ["C", "B"],
    });

    expect(getTransitiveDependents("D", graph)).toEqual(["A", "B", "C"]);
  });

  it("does not include the root package", () => {
    const graph = createGraph({
      A: ["B"],
      B: ["A"],
    });

    const result = getTransitiveDependents("A", graph);

    expect(result).not.toContain("A");
  });
});
