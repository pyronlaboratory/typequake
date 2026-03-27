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

    expect(names).toEqual([
      "@fixture/api",
      "@fixture/core",
      "@fixture/standalone",
      "@fixture/utils",
    ]); // sorted
  });

  it("extracts metadata correctly", () => {
    const result = discoverPackages(config);

    const core = result.find((p) => p.name === "@fixture/core");
    const api = result.find((p) => p.name === "@fixture/api");

    expect(core).toBeDefined();
    expect(core?.version).toBe("1.0.0");
    expect(core?.dependencies).toEqual([]);

    expect(api).toBeDefined();
    expect(api?.dependencies).toContain("@fixture/core");
    expect(api?.dependencies).toContain("@fixture/utils");
  });

  it("returns empty dependencies when none exist", () => {
    const result = discoverPackages(config);

    const pkg = result.find((p) => p.name === "@fixture/standalone");

    expect(pkg?.dependencies).toEqual([]);
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
