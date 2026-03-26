export type WorkspaceType = "pnpm" | "bun" | "yarn" | "package-json";

export interface WorkspaceConfig {
  type: WorkspaceType;
  packageGlobs: string[];
  rootDir: string;
}

export interface WorkspaceAnalysis {
  config: WorkspaceConfig;
  packages: PackageNode[];
  graph: DependencyGraph;
}

export interface PackageJson {
  name?: string;
  version?: string;
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

export type DependencyGraph = Map<string, string[]>;

export type AnalyzeOptions = {
  json?: boolean;
  ci?: boolean;
  cache?: boolean; // from --no-cache
  verbose?: boolean;
};
