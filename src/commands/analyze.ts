import type {
  AnalyzeOptions,
  ImpactReport,
  PackageDiffResult,
} from "../types/index";
import { GitBridge } from "../core/git-bridge";
import { generateReport } from "../core/generate-report";
import { isCiMode, runCiCheck } from "../policies/enforcement";
import { tracker } from "../utils/performance";

export interface AnalyzeResult {
  baseRef: string;
  diffs: PackageDiffResult[];
  reports: ImpactReport[];
}

/**
 * Executes the end-to-end TypeQuake analysis workflow:
 *
 *  1. Detect changed workspace packages relative to `baseRef`
 *  2. Reconstruct historical type surfaces and compute API diffs
 *  3. Traverse dependent packages through the workspace graph
 *  4. Resolve impacted import and usage sites
 *  5. Produce normalized impact reports for rendering and CI enforcement
 *
 * Returns a deterministic `AnalyzeResult` consumed by terminal, JSON,
 * and CI output layers.
 */
export async function runPipeline(
  baseRef: string,
  rootDir: string = process.cwd(),
  options: AnalyzeOptions = {},
): Promise<AnalyzeResult> {
  const log = options.verbose
    ? (msg: string) => process.stderr.write(`[typequake] ${msg}\n`)
    : (_msg: string) => {};

  const bridge = new GitBridge(rootDir);

  log(`comparing working tree against base ref: ${baseRef}`);
  const changedPackageNames = bridge.getChangedPackages(baseRef);

  if (changedPackageNames.length === 0) {
    log("no changed packages detected");
    return { baseRef, diffs: [], reports: [] };
  }

  log(
    `changed package${changedPackageNames.length !== 1 ? "s" : ""} (${changedPackageNames.length}): ${changedPackageNames.join(", ")}`,
  );
  const { packages, graph } = bridge["scanner"].analyzeWorkspace();

  const workspaceGraph = { graph, packages };

  const diffs: PackageDiffResult[] = [];

  for (const pkgName of changedPackageNames) {
    const pkgNode = packages.find((p) => p.name === pkgName);
    if (!pkgNode) continue;

    log(`diffing ${pkgName}`);
    const result = bridge.diffPackage(baseRef, pkgNode.path, options);
    diffs.push(result);
    log(
      `  → status: ${result.status}, mutations: ${result.mutations.length}${result.mutations.length > 0 ? ` (${[...new Set(result.mutations.map((m) => m.mutationClass))].join(", ")})` : ""}`,
    );
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

  log(
    `impact reports: ${reports.length} across ${new Set(reports.map((r) => r.consumerPackage)).size} consumer package(s)`,
  );
  return { baseRef, diffs, reports };
}

/**
 * CLI entrypoint used by `cli.ts`.
 *
 * Runs the analysis pipeline, renders the selected output format,
 * then optionally applies CI enforcement rules.
 */
export async function analyze(
  baseRef: string,
  options: AnalyzeOptions,
): Promise<void> {
  let result: AnalyzeResult;

  if (options.timing) {
    tracker.start();
  }

  try {
    result = await runPipeline(baseRef, process.cwd(), options);
  } catch (err: any) {
    process.stderr.write(
      `typequake: analysis failed — ${err.message ?? err}\n`,
    );
    process.exit(1);
  } finally {
    if (options.timing) {
      tracker.stop();
    }
  }

  if (options.timing) {
    tracker.log();
  }

  if (options.json) {
    const { renderJson } = await import("../renderer/json");
    renderJson(result);
  } else {
    const { renderTerminal } = await import("../renderer/terminal");
    await renderTerminal(result);
  }

  if (isCiMode(options.ci ?? false)) {
    runCiCheck(result);
  }
}
