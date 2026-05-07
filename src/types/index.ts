import * as ts from "typescript";

// ── CLI Options ─────────────────────────────────────────────────────────────

export type AnalyzeOptions = {
  json?: boolean;
  ci?: boolean;
  cache?: boolean; // disabled via --no-cache
  verbose?: boolean;
  timing?: boolean;
};

// ── Workspace Model ─────────────────────────────────────────────────────────

export type DependencyGraph = Map<string, string[]>;

export type WorkspaceType = "pnpm" | "bun" | "yarn" | "package-json";

export interface WorkspaceAnalysis {
  config: WorkspaceConfig;
  packages: PackageNode[];
  graph: DependencyGraph;
}

export interface WorkspaceConfig {
  type: WorkspaceType;
  packageGlobs: string[];
  rootDir: string;
}

export interface WorkspaceGraph {
  graph: DependencyGraph;
  packages: PackageNode[];
}

// ── Package Metadata ────────────────────────────────────────────────────────

export interface PackageJson {
  name?: string;
  version?: string;
  main?: string;
  types?: string;
  typings?: string;
  exports?: Record<string, unknown>;
  workspaces?: string[] | { packages?: string[] };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface PackageNode {
  name: string;
  version: string;
  path: string;
  dependencies: string[];
}

// ── Type Surface Representation ─────────────────────────────────────────────

export type SignatureMap = Map<string, TypeSignature>;

export interface PropertySignature {
  name: string;
  typeString: string;
  optional: boolean;
}

export interface TypeSignature {
  name: string;
  variant: "interface" | "type" | "function" | "class" | "variable" | "enum" | "namespace";

  /**
   * Canonical type string produced by ts.TypeChecker.typeToString().
   * Serves as the primary diffable surface for non-structural comparison.
   */
  typeString: string;

  /**
   * Raw ts.TypeFlags bitmask.
   * Stored as a number to keep records JSON-serialisable without requiring
   * the TypeScript runtime at load time.
   */
  flags: ts.TypeFlags;

  properties?: PropertySignature[];
  callSignatures?: string[];
  isExported: boolean;
}

// ── Mutation Classification ─────────────────────────────────────────────────

export type TypeMutationClass =
  | "BREAKING"
  | "NARROWING"
  | "WIDENING"
  | "ADDITIVE"
  | "REMOVED";

export interface MutationRecord {
  symbolName: string;
  mutationClass: TypeMutationClass;
  before: TypeSignature | null;
  after: TypeSignature | null;
  detail: string;
}

// ── Import Usage Resolution ─────────────────────────────────────────────────

export interface ImportSite {
  consumerPackage: string;
  filePath: string;
  line: number;
  column: number;
  symbolName: string;
  localAlias: string | null;
  usageCount: number;
  isTypeOnly: boolean;
}

// ── Impact Reporting ────────────────────────────────────────────────────────

export interface ImpactReport {
  mutationClass: TypeMutationClass;
  symbol: string;
  consumerPackage: string;
  sites: ImportSite[];
  detail: string;
}

// ── Git Diff Integration ────────────────────────────────────────────────────

export type PackageDiffStatus = "changed" | "added" | "deleted" | "ignored";

export interface PackageDiffResult {
  packageName: string;
  status: PackageDiffStatus;

  /** Populated for "changed" and "deleted". null for "added". */
  before: SignatureMap | null;

  /** Populated for "changed" and "added". null for "deleted". */
  after: SignatureMap | null;

  mutations: MutationRecord[];
}

// ── Performance Metrics ─────────────────────────────────────────────────────

export type MetricName = "extraction" | "diff" | "traversal" | "total";
