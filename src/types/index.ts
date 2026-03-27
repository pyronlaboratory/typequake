import * as ts from "typescript";

export type AnalyzeOptions = {
  json?: boolean;
  ci?: boolean;
  cache?: boolean; // from --no-cache
  verbose?: boolean;
};

// ── Workspace / Graph ─────────────────────────────────────────────────────────

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

// ── Type Surface ──────────────────────────────────────────────────────────────

export type SignatureMap = Map<string, TypeSignature>;

export interface PropertySignature {
  name: string;
  typeString: string;
  optional: boolean;
}

export interface TypeSignature {
  name: string;
  variant: "interface" | "type" | "function" | "class" | "variable" | "enum";
  /**
   * Full type string produced by ts.TypeChecker.typeToString().
   * Used as the primary diffable surface for non-structural comparison.
   */
  typeString: string;
  /**
   * ts.TypeFlags bitmask. Stored as a plain number so the record is
   * JSON-serialisable without importing the TypeScript package at runtime.
   */
  flags: ts.TypeFlags;
  properties?: PropertySignature[];
  callSignatures?: string[];
  isExported: boolean;
}
