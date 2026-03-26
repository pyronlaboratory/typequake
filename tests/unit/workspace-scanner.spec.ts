import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, afterEach } from "vitest";
import { WorkspaceScanner } from "../../src/core/workspace-scanner";

const tempDirs: string[] = [];

const createTempRepo = (structure: Record<string, string>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tq-"));

  for (const [filePath, content] of Object.entries(structure)) {
    const fullPath = path.join(dir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  return dir;
};

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe("WorkspaceScanner.detect", () => {
  it("detects pnpm workspace", () => {
    const dir = createTempRepo({
      "pnpm-workspace.yaml": `
packages:
  - "packages/*"
`,
    });

    const result = new WorkspaceScanner(dir).detect();

    expect(result.type).toBe("pnpm");
    expect(result.packageGlobs).toEqual(["packages/*"]);
  });

  it("detects bun workspace (bun.lockb)", () => {
    const dir = createTempRepo({
      "bun.lockb": "",
      "package.json": JSON.stringify({ workspaces: ["packages/*"] }, null, 2),
    });

    const result = new WorkspaceScanner(dir).detect();

    expect(result.type).toBe("bun");
    expect(result.packageGlobs).toEqual(["packages/*"]);
  });

  it("detects yarn workspace", () => {
    const dir = createTempRepo({
      "yarn.lock": "",
      "package.json": JSON.stringify(
        { workspaces: { packages: ["apps/*"] } },
        null,
        2,
      ),
    });

    const result = new WorkspaceScanner(dir).detect();

    expect(result.type).toBe("yarn");
    expect(result.packageGlobs).toEqual(["apps/*"]);
  });

  it("detects generic package.json workspace", () => {
    const dir = createTempRepo({
      "package.json": JSON.stringify({ workspaces: ["packages/*"] }, null, 2),
    });

    const result = new WorkspaceScanner(dir).detect();

    expect(result.type).toBe("package-json");
    expect(result.packageGlobs).toEqual(["packages/*"]);
  });

  it("prefers pnpm over bun and yarn", () => {
    const dir = createTempRepo({
      "pnpm-workspace.yaml": `
packages:
  - "packages/*"
`,
      "bun.lockb": "",
      "yarn.lock": "",
      "package.json": JSON.stringify({ workspaces: ["apps/*"] }, null, 2),
    });

    const result = new WorkspaceScanner(dir).detect();

    expect(result.type).toBe("pnpm");
    expect(result.packageGlobs).toEqual(["packages/*"]);
  });

  it("throws if no workspaces found", () => {
    const dir = createTempRepo({
      "package.json": JSON.stringify({}, null, 2),
    });

    expect(() => new WorkspaceScanner(dir).detect()).toThrow(
      "missing 'workspaces'",
    );
  });

  it("throws for invalid workspaces format", () => {
    const dir = createTempRepo({
      "package.json": JSON.stringify({ workspaces: { foo: [] } }, null, 2),
    });

    expect(() => new WorkspaceScanner(dir).detect()).toThrow(
      "must be a non-empty array",
    );
  });

  it("throws for invalid pnpm yaml", () => {
    const dir = createTempRepo({
      "pnpm-workspace.yaml": `invalid: [`,
    });

    expect(() => new WorkspaceScanner(dir).detect()).toThrow(
      "failed to parse YAML",
    );
  });
});
