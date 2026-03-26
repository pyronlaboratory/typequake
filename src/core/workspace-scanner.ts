import fs from "fs";
import path from "path";
import yaml from "yaml";

import { hasFile, readPackageJson } from "../utils/file";
import type {
  DependencyGraph,
  PackageJson,
  PackageNode,
  WorkspaceAnalysis,
  WorkspaceConfig,
} from "../types";
import { discoverPackages } from "./package-discovery";
import { buildDependencyGraph } from "./dependency-graph";
import { getTransitiveDependents as computeTransitiveDependents } from "./transitive-dependents";

export class WorkspaceScanner {
  private cachedResult: WorkspaceAnalysis | null = null;

  constructor(private rootDir: string) {}

  /**
   * Orchestrates workspace detection, package discovery, and graph
   * construction. Results are cached in-memory so repeated calls within a
   * single CLI execution are free.
   */
  analyzeWorkspace(): {
    config: WorkspaceConfig;
    packages: PackageNode[];
    graph: DependencyGraph;
  } {
    if (this.cachedResult) return this.cachedResult;

    const config = this.detectWorkspaceConfig();
    const packages = discoverPackages(config);
    const graph = buildDependencyGraph(packages);

    this.cachedResult = { config, packages, graph };
    return this.cachedResult;
  }

  /**
   * Returns all transitive dependents of `packageName` using the cached
   * dependency graph. Calls scan() automatically if not yet invoked.
   *
   * Throws if the package name is not present in the workspace.
   */
  getTransitiveDependents(packageName: string): string[] {
    const { graph, packages } = this.analyzeWorkspace();

    const exists = packages.some((p) => p.name === packageName);
    if (!exists) {
      throw new Error(
        `Package "${packageName}" was not found in the workspace. ` +
          `Known packages: ${packages.map((p) => p.name).join(", ")}`,
      );
    }

    return computeTransitiveDependents(packageName, graph);
  }

  /**
   * Detects the workspace configuration by checking for known files in the root directory.
   * Supports pnpm, bun, yarn, and generic package.json workspaces.
   */
  detectWorkspaceConfig(): WorkspaceConfig {
    if (hasFile(this.rootDir, "pnpm-workspace.yaml")) {
      return this.detectPnpm();
    }

    if (
      hasFile(this.rootDir, "bun.lockb") ||
      hasFile(this.rootDir, "bun.lock")
    ) {
      return this.detectBun();
    }

    if (hasFile(this.rootDir, "yarn.lock")) {
      return this.detectYarn();
    }

    return this.detectGenericWorkspace();
  }

  private extractWorkspaces(pkg: PackageJson): string[] {
    const ws = pkg.workspaces;

    if (!ws) {
      throw new Error(
        "Invalid workspace configuration: missing 'workspaces' field in package.json",
      );
    }

    const result = Array.isArray(ws)
      ? ws
      : Array.isArray(ws.packages)
        ? ws.packages
        : null;

    if (!result || result.length === 0) {
      throw new Error(
        "Invalid workspace configuration: 'workspaces' must be a non-empty array or { packages: string[] }",
      );
    }

    return result;
  }

  private detectPnpm(): WorkspaceConfig {
    const filepath = path.join(this.rootDir, "pnpm-workspace.yaml");
    const content = fs.readFileSync(filepath, "utf-8");

    let parsed: any;
    try {
      parsed = yaml.parse(content);
    } catch {
      throw new Error("Invalid pnpm-workspace.yaml: failed to parse YAML");
    }

    if (!parsed?.packages || !Array.isArray(parsed.packages)) {
      throw new Error(
        "Invalid pnpm-workspace.yaml: 'packages' field is missing or not an array.",
      );
    }

    return {
      type: "pnpm",
      packageGlobs: parsed.packages,
      rootDir: this.rootDir,
    };
  }

  private detectBun(): WorkspaceConfig {
    const pkg = readPackageJson(this.rootDir);
    const workspaces = this.extractWorkspaces(pkg);

    return {
      type: "bun",
      packageGlobs: workspaces,
      rootDir: this.rootDir,
    };
  }

  private detectYarn(): WorkspaceConfig {
    const pkg = readPackageJson(this.rootDir);
    const workspaces = this.extractWorkspaces(pkg);

    return {
      type: "yarn",
      packageGlobs: workspaces,
      rootDir: this.rootDir,
    };
  }

  private detectGenericWorkspace(): WorkspaceConfig {
    const pkg = readPackageJson(this.rootDir);
    const workspaces = this.extractWorkspaces(pkg);

    return {
      type: "package-json",
      packageGlobs: workspaces,
      rootDir: this.rootDir,
    };
  }
}
