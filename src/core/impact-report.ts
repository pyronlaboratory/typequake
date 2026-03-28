import type {
  ImpactReport,
  ImportSite,
  MutationRecord,
  TypeMutationClass,
  WorkspaceGraph,
} from "../types/index";
import { resolveImportSites } from "./import-resolver.js";
import { getTransitiveDependents } from "./transitive-dependents.js";

const SEVERITY_ORDER: Record<TypeMutationClass, number> = {
  BREAKING: 0,
  REMOVED: 1,
  NARROWING: 2,
  WIDENING: 3,
  ADDITIVE: 4,
};

export async function generateReport(
  modifiedPackage: string,
  mutations: MutationRecord[],
  workspaceGraph: WorkspaceGraph,
): Promise<ImpactReport[]> {
  if (mutations.length === 0) return [];

  const consumers = getTransitiveDependents(
    modifiedPackage,
    workspaceGraph.graph,
  );

  if (consumers.length === 0) return [];

  const changedSymbols = mutations.map((m) => m.symbolName);

  // Build a lookup: symbolName → MutationRecord
  const mutationBySymbol = new Map<string, MutationRecord>(
    mutations.map((m) => [m.symbolName, m]),
  );

  // Resolve import sites for all consumers in parallel
  const consumerResults = await Promise.all(
    consumers.map(async (consumerName) => {
      const consumerNode = workspaceGraph.packages.find(
        (p) => p.name === consumerName,
      );
      if (!consumerNode) return [];

      const sites = resolveImportSites(
        consumerNode.path,
        modifiedPackage,
        changedSymbols,
      );

      return sites;
    }),
  );

  // Group sites by (consumerPackage, symbolName)
  const grouped = new Map<string, ImportSite[]>();

  for (const sites of consumerResults) {
    for (const site of sites) {
      const key = `${site.consumerPackage}\0${site.symbolName}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.push(site);
      } else {
        grouped.set(key, [site]);
      }
    }
  }

  // Emit one ImpactReport per (consumerPackage, symbol) pair with ≥1 site
  const reports: ImpactReport[] = [];

  for (const [key, sites] of grouped) {
    const [consumerPackage, symbolName] = key.split("\0") as [string, string];
    const mutation = mutationBySymbol.get(symbolName);
    if (!mutation) continue;

    reports.push({
      mutationClass: mutation.mutationClass,
      symbol: symbolName,
      consumerPackage,
      sites,
      detail: mutation.detail,
    });
  }

  // Sort by severity, then alphabetically by consumerPackage within same severity
  reports.sort((a, b) => {
    const severityDiff =
      SEVERITY_ORDER[a.mutationClass] - SEVERITY_ORDER[b.mutationClass];
    if (severityDiff !== 0) return severityDiff;
    return a.consumerPackage.localeCompare(b.consumerPackage);
  });

  return reports;
}
