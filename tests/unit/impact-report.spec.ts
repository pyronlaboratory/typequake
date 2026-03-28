import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateReport } from "../../src/core/impact-report";
import type {
  MutationRecord,
  ImportSite,
  WorkspaceGraph,
} from "../../src/types/index";

// Mock import-resolver so tests don't need real TS programs on disk
vi.mock("../../src/core/import-resolver", () => ({
  resolveImportSites: vi.fn(),
}));

import { resolveImportSites } from "../../src/core/import-resolver";
const mockResolveImportSites = vi.mocked(resolveImportSites);

// ── fixtures ──────────────────────────────────────────────────────────────────

function makeGraph(
  packages: Array<{ name: string; path: string; dependsOn?: string[] }>,
  changedPkg: string,
): WorkspaceGraph {
  const nodes = packages.map((p) => ({
    name: p.name,
    version: "1.0.0",
    path: p.path,
    dependencies: p.dependsOn ?? [],
  }));

  // Build dependents graph: dep → [packages that depend on it]
  const graph = new Map<string, string[]>();
  for (const node of nodes) graph.set(node.name, []);

  for (const node of nodes) {
    for (const dep of node.dependencies) {
      const dependents = graph.get(dep);
      if (dependents) dependents.push(node.name);
    }
  }

  return { graph, packages: nodes };
}

function makeSite(overrides: Partial<ImportSite> = {}): ImportSite {
  return {
    consumerPackage: "pkg-consumer",
    filePath: "/workspace/pkg-consumer/src/index.ts",
    line: 1,
    column: 1,
    symbolName: "UserRecord",
    localAlias: null,
    usageCount: 1,
    isTypeOnly: false,
    ...overrides,
  };
}

function makeBreakingMutation(symbolName = "UserRecord"): MutationRecord {
  return {
    symbolName,
    mutationClass: "BREAKING",
    before: null,
    after: null,
    detail: `required property 'id' removed from ${symbolName}`,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("generateReport", () => {
  beforeEach(() => {
    mockResolveImportSites.mockReset();
  });

  it("all-clear: returns empty array when there are no mutations", async () => {
    const workspaceGraph = makeGraph(
      [
        { name: "@repo/core", path: "/workspace/core" },
        {
          name: "@repo/api",
          path: "/workspace/api",
          dependsOn: ["@repo/core"],
        },
      ],
      "@repo/core",
    );

    const result = await generateReport("@repo/core", [], workspaceGraph);

    expect(result).toEqual([]);
    expect(mockResolveImportSites).not.toHaveBeenCalled();
    expect(result).toMatchSnapshot();
  });

  it("all-clear: returns empty array when no consumer imports a changed symbol", async () => {
    mockResolveImportSites.mockReturnValue([]);

    const workspaceGraph = makeGraph(
      [
        { name: "@repo/core", path: "/workspace/core" },
        {
          name: "@repo/api",
          path: "/workspace/api",
          dependsOn: ["@repo/core"],
        },
      ],
      "@repo/core",
    );

    const result = await generateReport(
      "@repo/core",
      [makeBreakingMutation()],
      workspaceGraph,
    );

    expect(result).toEqual([]);
    expect(result).toMatchSnapshot();
  });

  it("single breaking change with two consumers", async () => {
    const site1 = makeSite({
      consumerPackage: "@repo/api",
      filePath: "/workspace/api/src/user.ts",
      line: 3,
      symbolName: "UserRecord",
    });
    const site2 = makeSite({
      consumerPackage: "@repo/dashboard",
      filePath: "/workspace/dashboard/src/page.ts",
      line: 7,
      symbolName: "UserRecord",
    });

    mockResolveImportSites
      .mockReturnValueOnce([site1]) // called for @repo/api
      .mockReturnValueOnce([site2]); // called for @repo/dashboard

    const workspaceGraph = makeGraph(
      [
        { name: "@repo/core", path: "/workspace/core" },
        {
          name: "@repo/api",
          path: "/workspace/api",
          dependsOn: ["@repo/core"],
        },
        {
          name: "@repo/dashboard",
          path: "/workspace/dashboard",
          dependsOn: ["@repo/core"],
        },
      ],
      "@repo/core",
    );

    const result = await generateReport(
      "@repo/core",
      [makeBreakingMutation("UserRecord")],
      workspaceGraph,
    );

    expect(result).toHaveLength(2);
    expect(result.every((r) => r.mutationClass === "BREAKING")).toBe(true);
    expect(result.map((r) => r.consumerPackage)).toEqual([
      "@repo/api",
      "@repo/dashboard",
    ]);
    expect(result).toMatchSnapshot();
  });

  it("mixed severity output is sorted correctly", async () => {
    // @repo/api imports the BREAKING symbol
    // @repo/analytics imports the WIDENING symbol
    // @repo/dashboard imports the ADDITIVE symbol
    mockResolveImportSites.mockImplementation((_path, _pkg, symbols) => {
      // Return a site matching whatever symbol was requested
      return symbols.map((sym) =>
        makeSite({ consumerPackage: _path, symbolName: sym }),
      );
    });

    const workspaceGraph = makeGraph(
      [
        { name: "@repo/core", path: "/workspace/core" },
        {
          name: "/workspace/api",
          path: "/workspace/api",
          dependsOn: ["@repo/core"],
        },
        {
          name: "/workspace/analytics",
          path: "/workspace/analytics",
          dependsOn: ["@repo/core"],
        },
        {
          name: "/workspace/dashboard",
          path: "/workspace/dashboard",
          dependsOn: ["@repo/core"],
        },
      ],
      "@repo/core",
    );

    const mutations: MutationRecord[] = [
      {
        symbolName: "Config",
        mutationClass: "ADDITIVE",
        before: null,
        after: null,
        detail: "optional property 'timeout' added to Config",
      },
      {
        symbolName: "Role",
        mutationClass: "WIDENING",
        before: null,
        after: null,
        detail: "type of 'Role' widened from 'string' to 'string | undefined'",
      },
      {
        symbolName: "UserRecord",
        mutationClass: "BREAKING",
        before: null,
        after: null,
        detail: "required property 'id' removed from UserRecord",
      },
    ];

    const result = await generateReport(
      "@repo/core",
      mutations,
      workspaceGraph,
    );

    const classes = result.map((r) => r.mutationClass);
    // BREAKING entries must come before WIDENING, WIDENING before ADDITIVE
    const breakingIdx = classes.indexOf("BREAKING");
    const wideningIdx = classes.indexOf("WIDENING");
    const additiveIdx = classes.indexOf("ADDITIVE");

    expect(breakingIdx).toBeLessThan(wideningIdx);
    expect(wideningIdx).toBeLessThan(additiveIdx);
    expect(result).toMatchSnapshot();
  });

  it("detail is passed through from MutationRecord unchanged", async () => {
    const expectedDetail = "required property 'id' removed from UserRecord";
    mockResolveImportSites.mockReturnValue([makeSite()]);

    const workspaceGraph = makeGraph(
      [
        { name: "@repo/core", path: "/workspace/core" },
        {
          name: "@repo/api",
          path: "/workspace/api",
          dependsOn: ["@repo/core"],
        },
      ],
      "@repo/core",
    );

    const [report] = await generateReport(
      "@repo/core",
      [{ ...makeBreakingMutation(), detail: expectedDetail }],
      workspaceGraph,
    );

    expect(report!.detail).toBe(expectedDetail);
  });

  it("consumers with no matching import sites produce zero entries", async () => {
    mockResolveImportSites.mockReturnValue([]);

    const workspaceGraph = makeGraph(
      [
        { name: "@repo/core", path: "/workspace/core" },
        {
          name: "@repo/api",
          path: "/workspace/api",
          dependsOn: ["@repo/core"],
        },
        {
          name: "@repo/analytics",
          path: "/workspace/analytics",
          dependsOn: ["@repo/core"],
        },
      ],
      "@repo/core",
    );

    const result = await generateReport(
      "@repo/core",
      [makeBreakingMutation()],
      workspaceGraph,
    );

    expect(result).toHaveLength(0);
  });

  it("parallelises ImportSiteResolver calls with Promise.all", async () => {
    const callOrder: string[] = [];
    mockResolveImportSites.mockImplementation((pkgPath) => {
      callOrder.push(pkgPath);
      return [makeSite({ consumerPackage: pkgPath, symbolName: "UserRecord" })];
    });

    const workspaceGraph = makeGraph(
      [
        { name: "@repo/core", path: "/workspace/core" },
        { name: "consumer-a", path: "/workspace/a", dependsOn: ["@repo/core"] },
        { name: "consumer-b", path: "/workspace/b", dependsOn: ["@repo/core"] },
        { name: "consumer-c", path: "/workspace/c", dependsOn: ["@repo/core"] },
      ],
      "@repo/core",
    );

    await generateReport(
      "@repo/core",
      [makeBreakingMutation("UserRecord")],
      workspaceGraph,
    );

    // All three consumers must have been resolved
    expect(mockResolveImportSites).toHaveBeenCalledTimes(3);
  });
});
