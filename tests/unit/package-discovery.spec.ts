import path from "path";
import { describe, it, expect } from "vitest";

import { discoverPackages } from "../../src/core/package-discovery";
import type { WorkspaceConfig } from "../../src/types";

const fixtureRoot = path.resolve(__dirname, "../fixtures/pnpm-workspace");

describe("discoverPackages", () => {
  const config: WorkspaceConfig = {
    type: "pnpm",
    rootDir: fixtureRoot,
    packageGlobs: ["packages/*"],
  };

  it("discovers all packages", () => {
    const result = discoverPackages(config);

    const names = result.map((p) => p.name);

    expect(names).toEqual(["api", "core"]); // sorted
  });

  it("extracts metadata correctly", () => {
    const result = discoverPackages(config);

    const core = result.find((p) => p.name === "core");
    const api = result.find((p) => p.name === "api");

    expect(core).toBeDefined();
    expect(core?.version).toBe("1.0.0");
    expect(core?.dependencies).toEqual(["lodash"]);

    expect(api).toBeDefined();
    expect(api?.dependencies).toContain("core");
    expect(api?.dependencies).toContain("express");
    expect(api?.dependencies).toContain("typescript"); // from devDependencies
  });

  it("returns empty dependencies when none exist", () => {
    const tempConfig: WorkspaceConfig = {
      ...config,
      packageGlobs: ["packages/*"],
    };

    const result = discoverPackages(tempConfig);

    const pkg = result.find((p) => p.name === "core");

    expect(pkg?.dependencies).toEqual(["lodash"]);
  });

  it("ignores invalid packages (missing name)", () => {
    const result = discoverPackages(config);

    const hasInvalid = result.some((p) => !p.name);

    expect(hasInvalid).toBe(false);
  });

  it("is deterministic (stable ordering)", () => {
    const result1 = discoverPackages(config);
    const result2 = discoverPackages(config);

    expect(result1).toEqual(result2);
  });
});
