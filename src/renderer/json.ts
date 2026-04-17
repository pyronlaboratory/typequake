import type { AnalyzeResult } from "../commands/analyze";
import type { ImpactReport, ImportSite } from "../types/index";

// ── Stable serialization ──────────────────────────────────────────────────────
// All objects are built with keys in a fixed declared order so the output is
// identical across runs — safe for snapshot tests and `git diff`.

function serializeSite(site: ImportSite) {
  return {
    file: site.filePath,
    line: site.line,
    column: site.column,
    symbol: site.symbolName,
    localAlias: site.localAlias,
    usageCount: site.usageCount,
    isTypeOnly: site.isTypeOnly,
    consumerPackage: site.consumerPackage,
  };
}

function serializeReport(report: ImpactReport) {
  return {
    mutationClass: report.mutationClass,
    symbol: report.symbol,
    consumerPackage: report.consumerPackage,
    detail: report.detail,
    sites: report.sites.map(serializeSite),
  };
}

function serializeResult(result: AnalyzeResult) {
  // Reports are already severity-sorted by the pipeline.
  // Secondary sort by consumerPackage + symbol makes output fully deterministic
  // even if two pipeline runs process packages in a different order.
  const packages = result.diffs.map((d) => ({
    name: d.packageName,
  }));

  const reports = [...result.reports]
    .sort((a, b) => {
      const pkg = a.consumerPackage.localeCompare(b.consumerPackage);
      if (pkg !== 0) return pkg;
      return a.symbol.localeCompare(b.symbol);
    })
    .map(serializeReport);

  return {
    version: 1,
    baseRef: result.baseRef,
    packages,
    reports,
    summary: {
      total: result.reports.length,
      breaking: result.reports.filter((r) => r.mutationClass === "BREAKING")
        .length,
      removed: result.reports.filter((r) => r.mutationClass === "REMOVED")
        .length,
      narrowing: result.reports.filter((r) => r.mutationClass === "NARROWING")
        .length,
      widening: result.reports.filter((r) => r.mutationClass === "WIDENING")
        .length,
      additive: result.reports.filter((r) => r.mutationClass === "ADDITIVE")
        .length,
      packagesAffected: new Set(result.reports.map((r) => r.consumerPackage))
        .size,
    },
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function renderJson(result: AnalyzeResult): void {
  process.stdout.write(JSON.stringify(serializeResult(result), null, 2) + "\n");
}
