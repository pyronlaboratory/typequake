import type { AnalyzeResult } from "../commands/analyze";
import type { ImpactReport } from "../types/index";

// ── GitHub Actions annotation format ─────────────────────────────────────────
// https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands

function isGithubActions(): boolean {
  return process.env["GITHUB_ACTIONS"] === "true";
}

function ghaError(report: ImpactReport): void {
  // Emit one ::error annotation per site so GHA links back to the exact file/line.
  if (report.sites.length === 0) {
    process.stderr.write(
      `::error title=typequake [${report.mutationClass}]::${report.detail} — consumed by ${report.consumerPackage}\n`,
    );
    return;
  }

  for (const site of report.sites) {
    process.stderr.write(
      `::error file=${site.filePath},line=${site.line},col=${site.column},title=typequake [${report.mutationClass}]::${report.detail}\n`,
    );
  }
}

function ghaWarning(report: ImpactReport): void {
  if (report.sites.length === 0) {
    process.stderr.write(
      `::warning title=typequake [${report.mutationClass}]::${report.detail} — consumed by ${report.consumerPackage}\n`,
    );
    return;
  }

  for (const site of report.sites) {
    process.stderr.write(
      `::warning file=${site.filePath},line=${site.line},col=${site.column},title=typequake [${report.mutationClass}]::${report.detail}\n`,
    );
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns true if CI mode should be active.
 * Triggered by --ci flag OR when the CI env var is set (GitHub Actions, etc).
 */
export function isCiMode(flagValue: boolean): boolean {
  return flagValue || process.env["CI"] === "true";
}

/**
 * Evaluate the result in CI mode:
 *  - Emits GHA annotations when running inside GitHub Actions.
 *  - Exits 1 if any BREAKING mutations are present.
 *  - Exits 0 otherwise (non-breaking mutations are warnings, not failures).
 *
 * Always calls process.exit() — invoke as the last step in the pipeline.
 */
export function runCiCheck(result: AnalyzeResult): never {
  const breaking = result.reports.filter((r) => r.mutationClass === "BREAKING");
  const nonBreaking = result.reports.filter(
    (r) => r.mutationClass !== "BREAKING",
  );
  const gha = isGithubActions();

  if (gha) {
    // Non-breaking mutations → warnings
    for (const report of nonBreaking) {
      ghaWarning(report);
    }
    // Breaking mutations → errors
    for (const report of breaking) {
      ghaError(report);
    }
  }

  if (breaking.length > 0) {
    process.stderr.write(
      `\ntypequake: ${breaking.length} BREAKING change${breaking.length !== 1 ? "s" : ""} detected — exiting with code 1.\n`,
    );
    process.exit(1);
  }

  process.exit(0);
}
