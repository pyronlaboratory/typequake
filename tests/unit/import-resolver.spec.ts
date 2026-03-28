import path from "path";
import ts from "typescript";
import { describe, it, expect, beforeEach } from "vitest";

import {
  resolveImportSites,
  extractSitesFromFile,
  countUsages,
  nearestPackageName,
  specifierResolvesToPackage,
  clearProgramCache,
} from "../../src/core/import-resolver";
import type { ImportSite } from "../../src/types/index";

const FIXTURES = path.resolve(__dirname, "../fixtures/import-resolver");

const pkg = {
  direct: path.join(FIXTURES, "consumer-direct"),
  aliased: path.join(FIXTURES, "consumer-aliased"),
  typeImport: path.join(FIXTURES, "consumer-type-import"),
  reexport: path.join(FIXTURES, "consumer-reexport"),
  barrel: path.join(FIXTURES, "consumer-barrel"),
  namespace: path.join(FIXTURES, "consumer-namespace"),
  noMatch: path.join(FIXTURES, "consumer-no-match"),
};

const CHANGED_PKG = "@tq/core";

/** Parse a TypeScript source string into a SourceFile for use with extractSitesFromFile. */
function makeSourceFile(
  source: string,
  fileName = "/fake/src/index.ts",
): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true,
  );
}

/** Minimal compiler options — mirrors what loadProgram uses when there is no tsconfig. */
const defaultOptions: ts.CompilerOptions = { noEmit: true, skipLibCheck: true };

describe("countUsages", () => {
  it("counts every non-binding occurrence of the local name", () => {
    const src = `import { User, createUser } from '@tq/core';\n\nconst a: User = createUser('alice');\nconst b: User = createUser('bob');\n`;
    const sf = makeSourceFile(src);
    const importStmt = sf.statements[0]!;

    expect(countUsages("User", sf, importStmt)).toBe(2);
    expect(countUsages("createUser", sf, importStmt)).toBe(2);
  });

  it("does not count the binding identifier inside the import specifier itself", () => {
    const src = `import { Role } from '@tq/core';\n`;
    const sf = makeSourceFile(src);
    expect(countUsages("Role", sf, sf.statements[0]!)).toBe(0);
  });

  it("counts the aliased local name, not the original exported name", () => {
    // 'User' is the exported name but 'U' is the local binding.
    // countUsages is called with the *local* name, so 'U' should be 1.
    const src = `import { User as U } from '@tq/core';\n\nconst a: U = { id: 1, name: 'x' };\n`;
    const sf = makeSourceFile(src);
    const importStmt = sf.statements[0]!;

    expect(countUsages("U", sf, importStmt)).toBe(1);
    expect(countUsages("User", sf, importStmt)).toBe(0);
  });

  it("skips the entire skipNode subtree", () => {
    // Both import declarations mention 'Role' in their specifier text but
    // only the second statement uses the binding outside its own declaration.
    const src = `import { Role } from '@tq/core';\nimport { Role as R } from '@tq/core';\n\nconst r: Role = 'admin';\n`;
    const sf = makeSourceFile(src);
    const stmt0 = sf.statements[0]!;
    const stmt1 = sf.statements[1]!;

    // Skipping stmt0 — 'Role' appears in: stmt1 binding (excluded) + type annotation (counted).
    expect(countUsages("Role", sf, stmt0)).toBe(1);
    // Skipping stmt1 — 'Role' appears in: stmt0 binding (excluded) + type annotation (counted).
    expect(countUsages("Role", sf, stmt1)).toBe(1);
  });

  it("counts namespace identifier usages", () => {
    const src = `import * as Core from '@tq/core';\n\nconst u: Core.User = Core.createUser('alice');\n`;
    const sf = makeSourceFile(src);
    expect(countUsages("Core", sf, sf.statements[0]!)).toBe(2);
  });
});

describe("nearestPackageName", () => {
  it("returns the name from the nearest package.json walking upward", () => {
    // The changed-package fixture has { "name": "@tq/core" } at its root.
    const filePath = path.join(FIXTURES, "changed-package", "src", "index.ts");
    expect(nearestPackageName(filePath)).toBe("@tq/core");
  });

  it("returns null when no package.json with a name field is found", () => {
    // Start from a path that has no package.json ancestors within the fixture tree.
    expect(nearestPackageName("/nonexistent/deep/path/file.ts")).toBeNull();
  });
});

describe("specifierResolvesToPackage", () => {
  it("matches an exact bare specifier", () => {
    expect(
      specifierResolvesToPackage(
        "@tq/core",
        "/fake/src/index.ts",
        defaultOptions,
        "@tq/core",
      ),
    ).toBe(true);
  });

  it("matches a subpath bare specifier", () => {
    expect(
      specifierResolvesToPackage(
        "@tq/core/utils",
        "/fake/src/index.ts",
        defaultOptions,
        "@tq/core",
      ),
    ).toBe(true);
  });

  it("rejects a different bare specifier immediately", () => {
    expect(
      specifierResolvesToPackage(
        "@other/lib",
        "/fake/src/index.ts",
        defaultOptions,
        "@tq/core",
      ),
    ).toBe(false);
  });

  it("rejects a bare specifier that is a prefix but not a subpath", () => {
    // '@tq/core-extra' starts with '@tq/core' but is NOT '@tq/core' or '@tq/core/…'
    expect(
      specifierResolvesToPackage(
        "@tq/core-extra",
        "/fake/src/index.ts",
        defaultOptions,
        "@tq/core",
      ),
    ).toBe(false);
  });
});

describe("extractSitesFromFile", () => {
  // ── named imports ──────────────────────────────────────────────────────────

  it("records a named import with no alias — line/col point at the local binding", () => {
    // Probed: symbol=User  line=1 col=10
    const src = `import { User, createUser } from '@tq/core';\n\nconst a: User = createUser('alice');\nconst b: User = createUser('bob');\n`;
    const sf = makeSourceFile(src);

    const sites = extractSitesFromFile(
      sf,
      "@tq/app",
      CHANGED_PKG,
      new Set(["User"]),
      defaultOptions,
    );

    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject<Partial<ImportSite>>({
      symbolName: "User",
      localAlias: null,
      line: 1,
      column: 10,
      usageCount: 2,
      isTypeOnly: false,
      consumerPackage: "@tq/app",
    });
  });

  it("records createUser with correct usageCount", () => {
    // Probed: symbol=createUser  line=1 col=16  usages=2
    const src = `import { User, createUser } from '@tq/core';\n\nconst a: User = createUser('alice');\nconst b: User = createUser('bob');\n`;
    const sf = makeSourceFile(src);

    const sites = extractSitesFromFile(
      sf,
      "@tq/app",
      CHANGED_PKG,
      new Set(["createUser"]),
      defaultOptions,
    );

    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject<Partial<ImportSite>>({
      symbolName: "createUser",
      localAlias: null,
      line: 1,
      column: 16,
      usageCount: 2,
      isTypeOnly: false,
    });
  });

  it("only emits sites for symbols present in the symbolSet", () => {
    const src = `import { User, createUser } from '@tq/core';\n\nconst u: User = createUser('x');\n`;
    const sf = makeSourceFile(src);
    const sites = extractSitesFromFile(
      sf,
      "@tq/app",
      CHANGED_PKG,
      new Set(["User"]),
      defaultOptions,
    );

    expect(sites.every((s) => s.symbolName === "User")).toBe(true);
  });

  it("returns empty array when no import matches the changed package", () => {
    const src = `import { foo } from '@other/lib';\n`;
    const sf = makeSourceFile(src);
    const sites = extractSitesFromFile(
      sf,
      "@tq/app",
      CHANGED_PKG,
      new Set(["User"]),
      defaultOptions,
    );

    expect(sites).toHaveLength(0);
  });

  // ── aliased imports ────────────────────────────────────────────────────────

  it("records symbolName as the exported name and localAlias as the local binding", () => {
    // Probed: symbol=User local=U  line=1 col=18  usages=1
    const src = `import { User as U, Role } from '@tq/core';\n\nconst a: U = { id: 1, name: 'x' };\nconst r: Role = 'admin';\n`;
    const sf = makeSourceFile(src);

    const sites = extractSitesFromFile(
      sf,
      "@tq/aliased",
      CHANGED_PKG,
      new Set(["User"]),
      defaultOptions,
    );

    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject<Partial<ImportSite>>({
      symbolName: "User",
      localAlias: "U",
      line: 1,
      column: 18,
      usageCount: 1,
      isTypeOnly: false,
    });
  });

  it("sets localAlias to null when there is no alias", () => {
    // Probed: symbol=Role local=Role  line=1 col=21  usages=1
    const src = `import { User as U, Role } from '@tq/core';\n\nconst a: U = { id: 1, name: 'x' };\nconst r: Role = 'admin';\n`;
    const sf = makeSourceFile(src);
    const sites = extractSitesFromFile(
      sf,
      "@tq/aliased",
      CHANGED_PKG,
      new Set(["Role"]),
      defaultOptions,
    );

    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject<Partial<ImportSite>>({
      symbolName: "Role",
      localAlias: null,
      line: 1,
      column: 21,
      usageCount: 1,
    });
  });

  // ── type-only imports ──────────────────────────────────────────────────────

  it("sets isTypeOnly=true for a clause-level import type { … }", () => {
    // Probed: User  line=1 col=15  usages=1  clauseTypeOnly=true
    const src = `import type { User } from '@tq/core';\n\nfunction greet(u: User): string {\n  return u.name;\n}\n`;
    const sf = makeSourceFile(src);

    const sites = extractSitesFromFile(
      sf,
      "@tq/type-consumer",
      CHANGED_PKG,
      new Set(["User"]),
      defaultOptions,
    );

    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject<Partial<ImportSite>>({
      symbolName: "User",
      line: 1,
      column: 15,
      usageCount: 1,
      isTypeOnly: true,
    });
  });

  it("sets isTypeOnly=true for an element-level import { type … }", () => {
    // Probed: Role  line=2 col=15  usages=1  elemTypeOnly=true
    const src = `import type { User } from '@tq/core';\nimport { type Role } from '@tq/core';\n\nfunction greet(u: User): string {\n  return u.name;\n}\n\nconst r: Role = 'admin';\n`;
    const sf = makeSourceFile(src);

    const sites = extractSitesFromFile(
      sf,
      "@tq/type-consumer",
      CHANGED_PKG,
      new Set(["Role"]),
      defaultOptions,
    );

    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject<Partial<ImportSite>>({
      symbolName: "Role",
      line: 2,
      column: 15,
      usageCount: 1,
      isTypeOnly: true,
    });
  });

  it("sets isTypeOnly=false for a plain named import", () => {
    const src = `import { User } from '@tq/core';\n`;
    const sf = makeSourceFile(src);
    const sites = extractSitesFromFile(
      sf,
      "@tq/app",
      CHANGED_PKG,
      new Set(["User"]),
      defaultOptions,
    );

    expect(sites[0]?.isTypeOnly).toBe(false);
  });

  // ── re-exports ─────────────────────────────────────────────────────────────

  it("records a named re-export with usageCount=0", () => {
    // Probed: symbol=User  line=1 col=10  typeOnly=false
    const src = `export { User } from '@tq/core';\n`;
    const sf = makeSourceFile(src);
    const sites = extractSitesFromFile(
      sf,
      "@tq/reexporter",
      CHANGED_PKG,
      new Set(["User"]),
      defaultOptions,
    );

    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject<Partial<ImportSite>>({
      symbolName: "User",
      localAlias: null,
      line: 1,
      column: 10,
      usageCount: 0,
      isTypeOnly: false,
    });
  });

  it("sets localAlias to null for a named re-export without alias", () => {
    const src = `export { User } from '@tq/core';\n`;
    const sf = makeSourceFile(src);
    const sites = extractSitesFromFile(
      sf,
      "@tq/reexporter",
      CHANGED_PKG,
      new Set(["User"]),
      defaultOptions,
    );

    expect(sites).toHaveLength(1);
    expect(sites[0]!.localAlias).toBeNull();
  });

  it("sets isTypeOnly=true on a type-only named re-export", () => {
    // Probed: symbol=Role  line=2 col=15  typeOnly=true
    const src = `export { User } from '@tq/core';\nexport type { Role } from '@tq/core';\n`;
    const sf = makeSourceFile(src);
    const sites = extractSitesFromFile(
      sf,
      "@tq/reexporter",
      CHANGED_PKG,
      new Set(["Role"]),
      defaultOptions,
    );

    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject<Partial<ImportSite>>({
      symbolName: "Role",
      isTypeOnly: true,
      usageCount: 0,
    });
  });

  it("records a re-export alias in localAlias and sets usageCount=0", () => {
    // Probed: export { createUser as makeUser }  symbol=createUser exportedAs=makeUser  line=3 col=24
    const src = `export { User } from '@tq/core';\nexport type { Role } from '@tq/core';\nexport { createUser as makeUser } from '@tq/core';\n`;
    const sf = makeSourceFile(src);
    const sites = extractSitesFromFile(
      sf,
      "@tq/reexporter",
      CHANGED_PKG,
      new Set(["createUser"]),
      defaultOptions,
    );

    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject<Partial<ImportSite>>({
      symbolName: "createUser",
      localAlias: "makeUser",
      line: 3,
      column: 24,
      usageCount: 0,
    });
  });

  // ── export * (barrel) ──────────────────────────────────────────────────────

  it("emits one site per changed symbol for export * with usageCount=0", () => {
    // Probed: moduleSpecifier start  line=1 col=15
    const src = `export * from '@tq/core';\n`;
    const sf = makeSourceFile(src);
    const symbols = new Set(["User", "Role", "createUser"]);
    const sites = extractSitesFromFile(
      sf,
      "@tq/barrel",
      CHANGED_PKG,
      symbols,
      defaultOptions,
    );

    expect(sites).toHaveLength(3);

    const names = sites.map((s) => s.symbolName).sort();
    expect(names).toEqual(["Role", "User", "createUser"].sort());

    for (const site of sites) {
      expect(site).toMatchObject<Partial<ImportSite>>({
        localAlias: null,
        usageCount: 0,
        isTypeOnly: false,
        line: 1,
        column: 15,
      });
    }
  });

  it("emits one site per changed symbol for export * as Ns with localAlias set", () => {
    // Probed: Ns  line=1 col=13
    const src = `export * as Ns from '@tq/core';\n`;
    const sf = makeSourceFile(src);
    const symbols = new Set(["User", "Role"]);
    const sites = extractSitesFromFile(
      sf,
      "@tq/ns-reexporter",
      CHANGED_PKG,
      symbols,
      defaultOptions,
    );

    expect(sites).toHaveLength(2);
    for (const site of sites) {
      expect(site).toMatchObject<Partial<ImportSite>>({
        localAlias: "Ns",
        usageCount: 0,
        line: 1,
        column: 13,
      });
    }
  });

  // ── namespace import ───────────────────────────────────────────────────────

  it("records one site per changed symbol for import * as Ns with namespace as localAlias", () => {
    // Probed: Core  line=1 col=13  usages=2
    const src = `import * as Core from '@tq/core';\n\nconst u: Core.User = Core.createUser('alice');\n`;
    const sf = makeSourceFile(src);
    const symbols = new Set(["User", "createUser"]);
    const sites = extractSitesFromFile(
      sf,
      "@tq/ns-consumer",
      CHANGED_PKG,
      symbols,
      defaultOptions,
    );

    expect(sites).toHaveLength(2);
    for (const site of sites) {
      expect(site).toMatchObject<Partial<ImportSite>>({
        localAlias: "Core",
        usageCount: 2,
        isTypeOnly: false,
        line: 1,
        column: 13,
      });
    }

    const names = sites.map((s) => s.symbolName).sort();
    expect(names).toEqual(["User", "createUser"].sort());
  });
});

describe("resolveImportSites", () => {
  beforeEach(() => {
    clearProgramCache();
  });

  // ── edge cases ─────────────────────────────────────────────────────────────

  it("returns [] when changedSymbols is empty", () => {
    expect(resolveImportSites(pkg.direct, CHANGED_PKG, [])).toEqual([]);
  });

  it("returns [] when the consumer package has no package.json", () => {
    const nonexistent = path.join(FIXTURES, "__no_such_package__");
    expect(resolveImportSites(nonexistent, CHANGED_PKG, ["User"])).toEqual([]);
  });

  it("returns [] when the consumer does not import any changed symbol", () => {
    const sites = resolveImportSites(pkg.noMatch, CHANGED_PKG, [
      "User",
      "Role",
    ]);
    expect(sites).toEqual([]);
  });

  // ── consumer-direct ────────────────────────────────────────────────────────

  it("finds both named imports in consumer-direct", () => {
    const sites = resolveImportSites(pkg.direct, CHANGED_PKG, [
      "User",
      "createUser",
    ]);
    expect(sites).toHaveLength(2);
  });

  it("consumer-direct: User site has correct shape", () => {
    const sites = resolveImportSites(pkg.direct, CHANGED_PKG, [
      "User",
      "createUser",
    ]);
    const user = sites.find((s) => s.symbolName === "User")!;

    expect(user).toBeDefined();
    expect(user).toMatchObject<Partial<ImportSite>>({
      consumerPackage: "@tq/app",
      symbolName: "User",
      localAlias: null,
      line: 1,
      column: 10,
      usageCount: 2,
      isTypeOnly: false,
    });
  });

  it("consumer-direct: createUser site has correct shape", () => {
    const sites = resolveImportSites(pkg.direct, CHANGED_PKG, [
      "User",
      "createUser",
    ]);
    const createUser = sites.find((s) => s.symbolName === "createUser")!;

    expect(createUser).toBeDefined();
    expect(createUser).toMatchObject<Partial<ImportSite>>({
      consumerPackage: "@tq/app",
      symbolName: "createUser",
      localAlias: null,
      line: 1,
      column: 16,
      usageCount: 2,
      isTypeOnly: false,
    });
  });

  it("consumer-direct: filePath is an absolute path inside the consumer package", () => {
    const sites = resolveImportSites(pkg.direct, CHANGED_PKG, ["User"]);
    expect(path.isAbsolute(sites[0]!.filePath)).toBe(true);
    expect(sites[0]!.filePath.startsWith(pkg.direct)).toBe(true);
  });

  // ── consumer-aliased ───────────────────────────────────────────────────────

  it("consumer-aliased: User is recorded with localAlias='U'", () => {
    const sites = resolveImportSites(pkg.aliased, CHANGED_PKG, [
      "User",
      "Role",
    ]);
    const user = sites.find((s) => s.symbolName === "User")!;

    expect(user).toBeDefined();
    expect(user).toMatchObject<Partial<ImportSite>>({
      symbolName: "User",
      localAlias: "U",
      line: 1,
      column: 18,
      usageCount: 1,
      isTypeOnly: false,
    });
  });

  it("consumer-aliased: Role has no alias", () => {
    const sites = resolveImportSites(pkg.aliased, CHANGED_PKG, [
      "User",
      "Role",
    ]);
    const role = sites.find((s) => s.symbolName === "Role")!;

    expect(role).toBeDefined();
    expect(role).toMatchObject<Partial<ImportSite>>({
      symbolName: "Role",
      localAlias: null,
      line: 1,
      column: 21,
      usageCount: 1,
    });
  });

  // ── consumer-type-import ───────────────────────────────────────────────────

  it("consumer-type-import: clause-level import type sets isTypeOnly=true", () => {
    const sites = resolveImportSites(pkg.typeImport, CHANGED_PKG, [
      "User",
      "Role",
    ]);
    const user = sites.find((s) => s.symbolName === "User")!;

    expect(user).toBeDefined();
    expect(user).toMatchObject<Partial<ImportSite>>({
      symbolName: "User",
      line: 1,
      column: 15,
      isTypeOnly: true,
      usageCount: 1,
    });
  });

  it("consumer-type-import: element-level type modifier sets isTypeOnly=true", () => {
    const sites = resolveImportSites(pkg.typeImport, CHANGED_PKG, [
      "User",
      "Role",
    ]);
    const role = sites.find((s) => s.symbolName === "Role")!;

    expect(role).toBeDefined();
    expect(role).toMatchObject<Partial<ImportSite>>({
      symbolName: "Role",
      line: 2,
      column: 15,
      isTypeOnly: true,
      usageCount: 1,
    });
  });

  // ── consumer-reexport ─────────────────────────────────────────────────────

  it("consumer-reexport: named re-export has usageCount=0", () => {
    const sites = resolveImportSites(pkg.reexport, CHANGED_PKG, [
      "User",
      "Role",
      "createUser",
    ]);
    const user = sites.find((s) => s.symbolName === "User")!;

    expect(user).toBeDefined();
    expect(user).toMatchObject<Partial<ImportSite>>({
      symbolName: "User",
      localAlias: null,
      usageCount: 0,
      isTypeOnly: false,
    });
  });

  it("consumer-reexport: export type sets isTypeOnly=true with usageCount=0", () => {
    const sites = resolveImportSites(pkg.reexport, CHANGED_PKG, [
      "User",
      "Role",
      "createUser",
    ]);
    const role = sites.find((s) => s.symbolName === "Role")!;

    expect(role).toBeDefined();
    expect(role).toMatchObject<Partial<ImportSite>>({
      symbolName: "Role",
      isTypeOnly: true,
      usageCount: 0,
    });
  });

  it("consumer-reexport: aliased re-export records the exported-as name in localAlias", () => {
    const sites = resolveImportSites(pkg.reexport, CHANGED_PKG, [
      "User",
      "Role",
      "createUser",
    ]);
    const createUser = sites.find((s) => s.symbolName === "createUser")!;

    expect(createUser).toBeDefined();
    expect(createUser).toMatchObject<Partial<ImportSite>>({
      symbolName: "createUser",
      localAlias: "makeUser",
      line: 3,
      column: 24,
      usageCount: 0,
    });
  });

  // ── consumer-barrel ───────────────────────────────────────────────────────

  it("consumer-barrel: export * emits one site per changed symbol with usageCount=0", () => {
    const sites = resolveImportSites(pkg.barrel, CHANGED_PKG, [
      "User",
      "Role",
      "createUser",
    ]);

    expect(sites).toHaveLength(3);

    for (const site of sites) {
      expect(site).toMatchObject<Partial<ImportSite>>({
        consumerPackage: "@tq/barrel",
        localAlias: null,
        usageCount: 0,
        isTypeOnly: false,
        line: 1,
        column: 15,
      });
    }

    const names = sites.map((s) => s.symbolName).sort();
    expect(names).toEqual(["Role", "User", "createUser"].sort());
  });

  // ── consumer-namespace ────────────────────────────────────────────────────

  it("consumer-namespace: import * as Ns emits one site per changed symbol", () => {
    const sites = resolveImportSites(pkg.namespace, CHANGED_PKG, [
      "User",
      "createUser",
    ]);

    expect(sites).toHaveLength(2);

    for (const site of sites) {
      expect(site).toMatchObject<Partial<ImportSite>>({
        consumerPackage: "@tq/ns-consumer",
        localAlias: "Core",
        usageCount: 2,
        isTypeOnly: false,
        line: 1,
        column: 13,
      });
    }
  });

  // ── program cache ─────────────────────────────────────────────────────────

  it("reuses the same ts.Program instance across multiple calls for the same package", () => {
    // Two calls for the same package should return the same results and not crash.
    const first = resolveImportSites(pkg.direct, CHANGED_PKG, ["User"]);
    const second = resolveImportSites(pkg.direct, CHANGED_PKG, ["User"]);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]).toEqual(second[0]);
  });

  it("clearProgramCache allows a fresh program to be built", () => {
    resolveImportSites(pkg.direct, CHANGED_PKG, ["User"]);
    clearProgramCache();
    // Should not throw — rebuilds the program from scratch.
    const sites = resolveImportSites(pkg.direct, CHANGED_PKG, ["User"]);
    expect(sites).toHaveLength(1);
  });
});
