import type { ImpactReport, PackageDiffResult } from "../types/index";
import { GitBridge } from "../core/git-bridge.js";
import { generateReport } from "../core/impact-report.js";

export interface AnalyzeResult {
  baseRef: string;
  diffs: PackageDiffResult[];
  reports: ImpactReport[];
}

/**
 * Full analysis pipeline:
 *  1. Detect which workspace packages changed since `baseRef`
 *  2. Extract before/after type signatures and diff each changed package
 *  3. Traverse transitive dependents
 *  4. Resolve import sites
 *  5. Generate impact reports
 *
 * Returns a stable `AnalyzeResult` suitable for both human and JSON renderers.
 */
export async function analyze(
  baseRef: string,
  rootDir: string = process.cwd(),
): Promise<AnalyzeResult> {
  const bridge = new GitBridge(rootDir);

  const changedPackageNames = bridge.getChangedPackages(baseRef);

  if (changedPackageNames.length === 0) {
    return { baseRef, diffs: [], reports: [] };
  }

  const { packages, graph } = bridge["scanner"].analyzeWorkspace();

  const workspaceGraph = { graph, packages };

  const diffs: PackageDiffResult[] = [];

  for (const pkgName of changedPackageNames) {
    const pkgNode = packages.find((p) => p.name === pkgName);
    if (!pkgNode) continue;

    const result = bridge.diffPackage(baseRef, pkgNode.path);
    diffs.push(result);
  }

  const reportArrays = await Promise.all(
    diffs.map((diff) =>
      generateReport(diff.packageName, diff.mutations, workspaceGraph),
    ),
  );

  const reports = reportArrays.flat().sort((a, b) => {
    const SEVERITY_ORDER: Record<string, number> = {
      BREAKING: 0,
      REMOVED: 1,
      NARROWING: 2,
      WIDENING: 3,
      ADDITIVE: 4,
    };
    const sd =
      (SEVERITY_ORDER[a.mutationClass] ?? 99) -
      (SEVERITY_ORDER[b.mutationClass] ?? 99);
    return sd !== 0 ? sd : a.consumerPackage.localeCompare(b.consumerPackage);
  });

  return { baseRef, diffs, reports };
}
