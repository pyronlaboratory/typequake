import fs from "fs";
import path from "path";
import yaml from "yaml";

import { hasFile, readPackageJson } from "../utils/file";
import type { PackageJson, WorkspaceConfig } from "../types";

export class WorkspaceScanner {
  constructor(private rootDir: string) {}

  detect(): WorkspaceConfig {
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
