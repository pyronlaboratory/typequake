import type {
  AnalyzeOptions,
  ImpactReport,
  PackageDiffResult,
} from "../types/index";
import { GitBridge } from "../core/git-bridge";
import { generateReport } from "../core/impact-report";
import { isCiMode, runCiCheck } from "../policies/enforcement";

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
export async function runPipeline(
  baseRef: string,
  rootDir: string = process.cwd(),
): Promise<AnalyzeResult> {
  const bridge = new GitBridge(rootDir);

  const changedPackageNames = bridge.getChangedPackages(baseRef);
  // Debug
  // console.log("changed packages:", changedPackageNames);

  if (changedPackageNames.length === 0) {
    return { baseRef, diffs: [], reports: [] };
  }

  const { packages, graph } = bridge["scanner"].analyzeWorkspace();
  // Debug
  // console.log(
  //   "total packages found:",
  //   packages.map((p) => p.name),
  // );
  // console.log("graph:", Object.fromEntries(graph));

  const workspaceGraph = { graph, packages };

  const diffs: PackageDiffResult[] = [];

  for (const pkgName of changedPackageNames) {
    const pkgNode = packages.find((p) => p.name === pkgName);
    if (!pkgNode) continue;

    const result = bridge.diffPackage(baseRef, pkgNode.path);
    // Debug
    // console.log(result.packageName, result.status, result.mutations.length);
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

/**
 * CLI command handler — called by cli.ts with the parsed options.
 * Runs the pipeline then dispatches to the appropriate renderer.
 */
export async function analyze(
  baseRef: string,
  options: AnalyzeOptions,
): Promise<void> {
  let result: AnalyzeResult;

  try {
    result = await runPipeline(baseRef);
  } catch (err: any) {
    process.stderr.write(
      `typequake: analysis failed — ${err.message ?? err}\n`,
    );
    process.exit(1);
  }

  if (isCiMode(options.ci ?? false)) {
    if (options.json) {
      const { renderJson } = await import("../renderer/json");
      renderJson(result);
    }

    // console.log(
    //   "CI mode active, breaking:",
    //   result!.reports.filter((r) => r.mutationClass === "BREAKING").length,
    // );
    runCiCheck(result!);
  }

  const { renderTerminal } = await import("../renderer/terminal");
  await renderTerminal(result!);
}
