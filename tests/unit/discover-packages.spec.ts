import path from "path";
import { describe, it, expect } from "vitest";
import { discoverPackages } from "../../src/core/discover-packages";
import type { WorkspaceConfig } from "../../src/types";

const fixtureRoot = path.resolve(
  __dirname,
  "../fixtures/workspaces/workspace-pnpm",
);

describe("Discover Packages", () => {
  const config: WorkspaceConfig = {
    type: "pnpm",
    rootDir: fixtureRoot,
    packageGlobs: ["packages/*"],
  };

  it("finds all workspace packages", () => {
    const result = discoverPackages(config);

    const names = result.map((p) => p.name);

    expect(names).toEqual(["@pkg/api", "@pkg/core"]); // sorted
  });

  it("extracts metadata correctly", () => {
    const result = discoverPackages(config);

    const core = result.find((p) => p.name === "@pkg/core");
    const api = result.find((p) => p.name === "@pkg/api");

    expect(core).toBeDefined();
    expect(core?.version).toBe("1.0.0");
    expect(core?.dependencies).toEqual([]);

    expect(api).toBeDefined();
    expect(api?.dependencies).toContain("@pkg/core");
  });

  it("returns packages in deterministic order", () => {
    const result1 = discoverPackages(config);
    const result2 = discoverPackages(config);

    expect(result1).toEqual(result2);
  });
});
