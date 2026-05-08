import path from "path";
import ts from "typescript";
import { describe, it, expect, beforeEach } from "vitest";
import {
  findImportUsages,
  findReferencesInFile,
  countUsages,
  nearestPackageName,
  isModuleFromPackage,
  clearProgramCache,
} from "../../src/core/resolve-imports";
import type { ImportSite } from "../../src/types/index";

const FIXTURES = path.resolve(__dirname, "../fixtures/references");
const PACKAGES = {
  direct: path.join(FIXTURES, "consumer-direct"),
  aliased: path.join(FIXTURES, "consumer-aliased"),
  typeImport: path.join(FIXTURES, "consumer-type-import"),
  reexport: path.join(FIXTURES, "consumer-reexport"),
  barrel: path.join(FIXTURES, "consumer-barrel"),
  namespace: path.join(FIXTURES, "consumer-namespace"),
  noMatch: path.join(FIXTURES, "consumer-no-match"),
};
const CHANGED_PKG = "@tq/core";

function makeSourceFile(
  source: string,
  fileName = "/fake/src/index.ts",
): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ESNext,
    true, // setParentNodes
  );
}

// Minimal compiler options, mirrors what loadProgram uses when there is no tsconfig.
const defaultOptions: ts.CompilerOptions = { noEmit: true, skipLibCheck: true };

describe("ImportReferenceTracer API", () => {
  describe("identifier usage counting", () => {
    it("counts every non-binding occurrence of the local name", () => {
      const src = `import { User, createUser } from '@tq/core';\n\nconst a: User = createUser('alice');\nconst b: User = createUser('bob');\n`;
      const sf = makeSourceFile(src);
      const importStmt = sf.statements[0]!;

      expect(countUsages("User", sf, importStmt)).toBe(2);
      expect(countUsages("createUser", sf, importStmt)).toBe(2);
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

    it("counts namespace identifier usages", () => {
      const src = `import * as Core from '@tq/core';\n\nconst u: Core.User = Core.createUser('alice');\n`;
      const sf = makeSourceFile(src);
      expect(countUsages("Core", sf, sf.statements[0]!)).toBe(2);
    });

    it("does not count the binding identifier inside the import specifier itself", () => {
      const src = `import { Role } from '@tq/core';\n`;
      const sf = makeSourceFile(src);
      expect(countUsages("Role", sf, sf.statements[0]!)).toBe(0);
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
  });

  describe("nearest package lookup", () => {
    it("returns the name from the nearest package.json walking upward", () => {
      // The changed-package fixture has { "name": "@tq/core" } at its root.
      const filePath = path.join(
        FIXTURES,
        "changed-package",
        "src",
        "index.ts",
      );
      expect(nearestPackageName(filePath)).toBe("@tq/core");
    });

    it("returns null when no package.json with a name field is found", () => {
      // Start from a path that has no package.json ancestors within the fixture tree.
      expect(nearestPackageName("/nonexistent/deep/path/file.ts")).toBeNull();
    });
  });

  describe("package specifier matching", () => {
    it("matches an exact bare specifier", () => {
      expect(
        isModuleFromPackage(
          "@tq/core",
          "/fake/src/index.ts",
          defaultOptions,
          "@tq/core",
        ),
      ).toBe(true);
    });

    it("matches a subpath bare specifier", () => {
      expect(
        isModuleFromPackage(
          "@tq/core/utils",
          "/fake/src/index.ts",
          defaultOptions,
          "@tq/core",
        ),
      ).toBe(true);
    });

    it("rejects a different bare specifier immediately", () => {
      expect(
        isModuleFromPackage(
          "@other/lib",
          "/fake/src/index.ts",
          defaultOptions,
          "@tq/core",
        ),
      ).toBe(false);
    });

    it("rejects a bare specifier that is a prefix but not a subpath", () => {
      // '@tq/core-extra' starts with '@tq/core' but is NOT '@tq/core' or '@tq/core/...'
      expect(
        isModuleFromPackage(
          "@tq/core-extra",
          "/fake/src/index.ts",
          defaultOptions,
          "@tq/core",
        ),
      ).toBe(false);
    });
  });

  describe("reference extraction from source files", () => {
    describe("named imports", () => {
      it("records direct named imports", () => {
        // Probed: symbol=User  line=1 col=10
        const src = `import { User, createUser } from '@tq/core';\n\nconst a: User = createUser('alice');\nconst b: User = createUser('bob');\n`;
        const sf = makeSourceFile(src);

        const sites = findReferencesInFile(
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

      it("tracks usage counts for imported functions", () => {
        // Probed: symbol=createUser  line=1 col=16  usages=2
        const src = `import { User, createUser } from '@tq/core';\n\nconst a: User = createUser('alice');\nconst b: User = createUser('bob');\n`;
        const sf = makeSourceFile(src);

        const sites = findReferencesInFile(
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

      it("filters results to requested symbols", () => {
        const src = `import { User, createUser } from '@tq/core';\n\nconst u: User = createUser('x');\n`;
        const sf = makeSourceFile(src);
        const sites = findReferencesInFile(
          sf,
          "@tq/app",
          CHANGED_PKG,
          new Set(["User"]),
          defaultOptions,
        );

        expect(sites.every((s) => s.symbolName === "User")).toBe(true);
      });

      it("ignores imports from unrelated packages", () => {
        const src = `import { foo } from '@other/lib';\n`;
        const sf = makeSourceFile(src);
        const sites = findReferencesInFile(
          sf,
          "@tq/app",
          CHANGED_PKG,
          new Set(["User"]),
          defaultOptions,
        );

        expect(sites).toHaveLength(0);
      });
    });

    describe("aliased imports", () => {
      it("preserves exported and local alias names", () => {
        // Probed: symbol=User local=U  line=1 col=18  usages=1
        const src = `import { User as U, Role } from '@tq/core';\n\nconst a: U = { id: 1, name: 'x' };\nconst r: Role = 'admin';\n`;
        const sf = makeSourceFile(src);

        const sites = findReferencesInFile(
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

      it("sets localAlias to null for unaliased imports", () => {
        // Probed: symbol=Role local=Role  line=1 col=21  usages=1
        const src = `import { User as U, Role } from '@tq/core';\n\nconst a: U = { id: 1, name: 'x' };\nconst r: Role = 'admin';\n`;
        const sf = makeSourceFile(src);
        const sites = findReferencesInFile(
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
    });

    describe("type-only imports", () => {
      it("marks clause-level type imports as type-only", () => {
        // Probed: User  line=1 col=15  usages=1  clauseTypeOnly=true
        const src = `import type { User } from '@tq/core';\n\nfunction greet(u: User): string {\n  return u.name;\n}\n`;
        const sf = makeSourceFile(src);

        const sites = findReferencesInFile(
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

      it("marks element-level type imports as type-only", () => {
        // Probed: Role  line=2 col=15  usages=1  elemTypeOnly=true
        const src = `import type { User } from '@tq/core';\nimport { type Role } from '@tq/core';\n\nfunction greet(u: User): string {\n  return u.name;\n}\n\nconst r: Role = 'admin';\n`;
        const sf = makeSourceFile(src);

        const sites = findReferencesInFile(
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

      it("does not mark standard imports as type-only", () => {
        const src = `import { User } from '@tq/core';\n`;
        const sf = makeSourceFile(src);
        const sites = findReferencesInFile(
          sf,
          "@tq/app",
          CHANGED_PKG,
          new Set(["User"]),
          defaultOptions,
        );

        expect(sites[0]?.isTypeOnly).toBe(false);
      });
    });

    describe("re-exports", () => {
      it("records named re-exports with zero usages", () => {
        // Probed: symbol=User  line=1 col=10  typeOnly=false
        const src = `export { User } from '@tq/core';\n`;
        const sf = makeSourceFile(src);
        const sites = findReferencesInFile(
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

      it("marks type-only re-exports", () => {
        // Probed: symbol=Role  line=2 col=15  typeOnly=true
        const src = `export { User } from '@tq/core';\nexport type { Role } from '@tq/core';\n`;
        const sf = makeSourceFile(src);
        const sites = findReferencesInFile(
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

      it("records aliased re-export names", () => {
        // Probed: export { createUser as makeUser }  symbol=createUser exportedAs=makeUser  line=3 col=24
        const src = `export { User } from '@tq/core';\nexport type { Role } from '@tq/core';\nexport { createUser as makeUser } from '@tq/core';\n`;
        const sf = makeSourceFile(src);
        const sites = findReferencesInFile(
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
    });

    describe("barrel exports", () => {
      it("emits one reference per symbol for export *", () => {
        // Probed: moduleSpecifier start  line=1 col=15
        const src = `export * from '@tq/core';\n`;
        const sf = makeSourceFile(src);
        const symbols = new Set(["User", "Role", "createUser"]);
        const sites = findReferencesInFile(
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

      it("records namespace aliases for export * as", () => {
        // Probed: Ns  line=1 col=13
        const src = `export * as Ns from '@tq/core';\n`;
        const sf = makeSourceFile(src);
        const symbols = new Set(["User", "Role"]);
        const sites = findReferencesInFile(
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
    });

    describe("namespace imports", () => {
      it("emits one reference per symbol for namespace imports", () => {
        // Probed: Core  line=1 col=13  usages=2
        const src = `import * as Core from '@tq/core';\n\nconst u: Core.User = Core.createUser('alice');\n`;
        const sf = makeSourceFile(src);
        const symbols = new Set(["User", "createUser"]);
        const sites = findReferencesInFile(
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
  });

  describe("package-wide import usage discovery", () => {
    beforeEach(() => {
      clearProgramCache();
    });

    describe("edge cases", () => {
      it("returns an empty result for empty symbol input", async () => {
        expect(
          await findImportUsages(PACKAGES.direct, CHANGED_PKG, []),
        ).toEqual([]);
      });

      it("returns an empty result when no package.json exists", async () => {
        const nonexistent = path.join(FIXTURES, "__no_such_package__");
        expect(
          await findImportUsages(nonexistent, CHANGED_PKG, ["User"]),
        ).toEqual([]);
      });

      it("returns an empty result when no matching imports exist", async () => {
        const sites = await findImportUsages(PACKAGES.noMatch, CHANGED_PKG, [
          "User",
          "Role",
        ]);
        expect(sites).toEqual([]);
      });
    });

    describe("direct imports", () => {
      it("records direct symbol imports", async () => {
        const sites = await findImportUsages(PACKAGES.direct, CHANGED_PKG, [
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

      it("records direct function imports", async () => {
        const sites = await findImportUsages(PACKAGES.direct, CHANGED_PKG, [
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

      it("returns absolute file paths inside the consumer package", async () => {
        const sites = await findImportUsages(PACKAGES.direct, CHANGED_PKG, [
          "User",
        ]);
        expect(path.isAbsolute(sites[0]!.filePath)).toBe(true);
        expect(sites[0]!.filePath.startsWith(PACKAGES.direct)).toBe(true);
      });
    });

    describe("aliased imports", () => {
      it("records aliased local bindings", async () => {
        const sites = await findImportUsages(PACKAGES.aliased, CHANGED_PKG, [
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

      it("preserves null aliases for direct imports", async () => {
        const sites = await findImportUsages(PACKAGES.aliased, CHANGED_PKG, [
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
    });

    describe("type imports", () => {
      it("marks clause-level type imports", async () => {
        const sites = await findImportUsages(PACKAGES.typeImport, CHANGED_PKG, [
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

      it("marks element-level type imports", async () => {
        const sites = await findImportUsages(PACKAGES.typeImport, CHANGED_PKG, [
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
    });

    describe("re-exports", () => {
      it("records named re-exports", async () => {
        const sites = await findImportUsages(PACKAGES.reexport, CHANGED_PKG, [
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

      it("marks type-only re-exports", async () => {
        const sites = await findImportUsages(PACKAGES.reexport, CHANGED_PKG, [
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

      it("records aliased re-export bindings", async () => {
        const sites = await findImportUsages(PACKAGES.reexport, CHANGED_PKG, [
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
    });

    describe("barrel exports", () => {
      it("emits one site per symbol for export *", async () => {
        const sites = await findImportUsages(PACKAGES.barrel, CHANGED_PKG, [
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
    });

    describe("namespace imports", () => {
      it("emits one site per symbol for namespace imports", async () => {
        const sites = await findImportUsages(PACKAGES.namespace, CHANGED_PKG, [
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
    });

    describe("program caching", () => {
      it("reuses cached ts.Program instances", async () => {
        // Two calls for the same package should return the same results and not crash.
        const first = await findImportUsages(PACKAGES.direct, CHANGED_PKG, [
          "User",
        ]);
        const second = await findImportUsages(PACKAGES.direct, CHANGED_PKG, [
          "User",
        ]);

        expect(first).toHaveLength(1);
        expect(second).toHaveLength(1);
        expect(first[0]).toEqual(second[0]);
      });

      it("rebuilds programs after cache invalidation", async () => {
        await findImportUsages(PACKAGES.direct, CHANGED_PKG, ["User"]);
        clearProgramCache();
        // Should not throw — rebuilds the program from scratch.
        const sites = await findImportUsages(PACKAGES.direct, CHANGED_PKG, [
          "User",
        ]);
        expect(sites).toHaveLength(1);
      });
    });
  });
});
