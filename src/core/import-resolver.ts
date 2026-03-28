import fs from "fs";
import path from "path";
import ts from "typescript";

import type { ImportSite } from "../types/index.js";

/**
 * One ts.Program per consumer package path.  Re-using a single program for
 * all files in a package is required by the acceptance criteria and avoids
 * re-parsing the same source on every file visit.
 */
const programCache = new Map<string, ts.Program>();

/** Remove all cached programs.  Intended for use in tests only. */
export function clearProgramCache(): void {
  programCache.clear();
}

/**
 * Recursively collect every `.ts` / `.tsx` source file under `dir`,
 * skipping `node_modules` and dotfile directories.
 * Used as a fallback when a package has no `tsconfig.json`.
 */
/* istanbul ignore next */
function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch /* istanbul ignore next */ {
    return results;
  }

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      results.push(full);
    }
  }

  return results;
}

/**
 * Build (or retrieve from cache) a `ts.Program` that covers every source file
 * in `packagePath`.  We load from `tsconfig.json` when present so that path
 * aliases, `include`/`exclude` patterns, and compiler options all match what
 * the author intended.
 */
function loadProgram(packagePath: string): ts.Program {
  const cached = programCache.get(packagePath);
  /* istanbul ignore next */
  if (cached) return cached;

  const tsconfigPath = path.join(packagePath, "tsconfig.json");

  let rootNames: string[];
  let options: ts.CompilerOptions;

  if (fs.existsSync(tsconfigPath)) {
    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    /* istanbul ignore next */
    if (configFile.error) {
      rootNames = collectTsFiles(packagePath);
      options = { noEmit: true, skipLibCheck: true };
    } else {
      // path.dirname(tsconfigPath) keeps resolution of relative paths inside
      // the config consistent with how the real compiler reads it.
      const parsed = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(tsconfigPath),
      );
      rootNames = parsed.fileNames;
      options = { ...parsed.options, noEmit: true };
    }
  } else {
    rootNames = collectTsFiles(packagePath);
    options = { noEmit: true, skipLibCheck: true };
  }

  const program = ts.createProgram(rootNames, options);
  programCache.set(packagePath, program);
  return program;
}

/**
 * Walk the directory tree from `filePath` upward until a `package.json` that
 * contains a `name` field is found.  Returns the name string or `null`.
 *
 * Exported so tests can verify the traversal in isolation.
 */
export function nearestPackageName(filePath: string): string | null {
  let dir = path.dirname(filePath);
  const { root } = path.parse(dir);

  while (dir !== root) {
    const pkgJsonPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const json = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")) as {
          name?: unknown;
        };
        if (typeof json.name === "string") return json.name;
      } catch {
        /* istanbul ignore next */
        // Malformed package.json — keep walking up.
      }
    }

    const parent = path.dirname(dir);
    /* istanbul ignore next */
    if (parent === dir) break; // filesystem root guard
    dir = parent;
  }

  return null;
}

/**
 * Determine whether a module specifier inside a TypeScript source file refers
 * to `changedPackageName`.
 *
 * Resolution order:
 *  1. Exact bare-specifier match:  `'@scope/pkg'`
 *  2. Subpath export match:        `'@scope/pkg/utils'`
 *  3. Relative specifier:          resolved via `ts.resolveModuleName`, then
 *     the nearest `package.json` is read from the resolved file path.
 *
 * Non-relative bare specifiers that do not match (1) or (2) are rejected
 * immediately — they are definitively a different package.
 *
 * Exported so tests can exercise specifier matching without a full pipeline.
 */
export function specifierResolvesToPackage(
  specifier: string,
  sourceFilePath: string,
  compilerOptions: ts.CompilerOptions,
  changedPackageName: string,
): boolean {
  // Fast path — direct or subpath bare import.
  if (
    specifier === changedPackageName ||
    specifier.startsWith(changedPackageName + "/")
  ) {
    return true;
  }

  // Bare specifiers that didn't match above are a different package.
  if (!specifier.startsWith(".")) return false;

  // Relative specifiers: resolve through the compiler so that path aliases
  // (e.g. tsconfig `paths`) are honoured.
  const resolved = ts.resolveModuleName(
    specifier,
    sourceFilePath,
    compilerOptions,
    ts.sys,
  );

  if (!resolved.resolvedModule) return false;

  return (
    nearestPackageName(resolved.resolvedModule.resolvedFileName) ===
    changedPackageName
  );
}

/**
 * Count the number of times `localName` appears as a *non-binding* identifier
 * in `sourceFile`.
 *
 * "Binding" positions — the left-hand name node of import/export specifiers
 * and import clauses — are excluded because they introduce the binding rather
 * than consume it.  The `skipNode` subtree (the import/export declaration that
 * introduced the binding) is skipped entirely so its specifier text is never
 * double-counted.
 *
 * Exported so tests can verify counting logic independently.
 */
export function countUsages(
  localName: string,
  sourceFile: ts.SourceFile,
  skipNode: ts.Node,
): number {
  let count = 0;

  function walk(node: ts.Node): void {
    // Skip the import/export declaration that introduced the binding.
    if (node === skipNode) return;

    if (ts.isIdentifier(node) && node.text === localName) {
      const { parent } = node;
      // Exclude the left-hand identifier of import / export specifiers —
      // those are binding sites, not usages.
      const isBindingSite =
        parent !== undefined &&
        ((ts.isImportSpecifier(parent) &&
          (parent.name === node || parent.propertyName === node)) ||
          (ts.isExportSpecifier(parent) &&
            (parent.name === node || parent.propertyName === node)) ||
          (ts.isImportClause(parent) && parent.name === node) ||
          (ts.isNamespaceImport(parent) && parent.name === node));

      if (!isBindingSite) count++;
    }

    ts.forEachChild(node, walk);
  }

  ts.forEachChild(sourceFile, walk);
  return count;
}

/**
 * Extract every `ImportSite` for `changedPackageName` symbols from a single
 * source file.  Handles all four import/export forms:
 *
 *   import  { Foo, Bar as B }      from '…'   — named import
 *   import  type { Foo }           from '…'   — type-only named import
 *   import  * as Ns                from '…'   — namespace import
 *   export  { Foo, Bar as Baz }    from '…'   — named re-export
 *   export  type { Foo }           from '…'   — type-only named re-export
 *   export  * from '…'             — wildcard re-export
 *   export  * as Ns from '…'       — namespace re-export
 *
 * Exported so it can be driven directly in unit tests without needing a real
 * consumer package on disk.
 */
export function extractSitesFromFile(
  sourceFile: ts.SourceFile,
  consumerPackage: string,
  changedPackageName: string,
  symbolSet: Set<string>,
  compilerOptions: ts.CompilerOptions,
): ImportSite[] {
  const results: ImportSite[] = [];

  for (const stmt of sourceFile.statements) {
    // ── import { Foo, Bar as B } from '…'
    // ── import type { Foo }      from '…'
    // ── import * as Ns           from '…'
    if (ts.isImportDeclaration(stmt)) {
      if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
      const specifier = stmt.moduleSpecifier.text;

      if (
        !specifierResolvesToPackage(
          specifier,
          sourceFile.fileName,
          compilerOptions,
          changedPackageName,
        )
      ) {
        continue;
      }

      const clauseIsTypeOnly = stmt.importClause?.isTypeOnly ?? false;
      const namedBindings = stmt.importClause?.namedBindings;

      if (namedBindings && ts.isNamedImports(namedBindings)) {
        // import { Foo, Bar as B } from '…'
        for (const element of namedBindings.elements) {
          // When `import { Foo as Bar }`, propertyName.text === 'Foo' (original
          // exported name) and name.text === 'Bar' (local binding).
          const symbolName = (element.propertyName ?? element.name).text;
          if (!symbolSet.has(symbolName)) continue;

          const localName = element.name.text;
          const localAlias = element.propertyName ? localName : null;
          const isTypeOnly = clauseIsTypeOnly || element.isTypeOnly;

          const pos = sourceFile.getLineAndCharacterOfPosition(
            element.name.getStart(sourceFile),
          );

          results.push({
            consumerPackage,
            filePath: sourceFile.fileName,
            line: pos.line + 1,
            column: pos.character + 1,
            symbolName,
            localAlias,
            usageCount: countUsages(localName, sourceFile, stmt),
            isTypeOnly,
          });
        }
      } else if (namedBindings && ts.isNamespaceImport(namedBindings)) {
        // import * as Ns from '…'
        // All changed symbols are accessible via the namespace; we record one
        // site per changed symbol with the namespace name as the alias.
        const namespaceName = namedBindings.name.text;
        const pos = sourceFile.getLineAndCharacterOfPosition(
          namedBindings.name.getStart(sourceFile),
        );
        const usageCount = countUsages(namespaceName, sourceFile, stmt);

        for (const symbolName of symbolSet) {
          results.push({
            consumerPackage,
            filePath: sourceFile.fileName,
            line: pos.line + 1,
            column: pos.character + 1,
            symbolName,
            localAlias: namespaceName,
            usageCount,
            isTypeOnly: clauseIsTypeOnly,
          });
        }
      }
    }

    // ── export { Foo, Bar as Baz } from '…'
    // ── export type { Foo }        from '…'
    // ── export * from '…'
    // ── export * as Ns from '…'
    if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier) {
      if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
      const specifier = stmt.moduleSpecifier.text;

      if (
        !specifierResolvesToPackage(
          specifier,
          sourceFile.fileName,
          compilerOptions,
          changedPackageName,
        )
      ) {
        continue;
      }

      const isTypeOnly = stmt.isTypeOnly;

      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        // export { Foo, Bar as Baz } from '…'
        for (const element of stmt.exportClause.elements) {
          // propertyName is the *imported* name; name is what's re-exported as.
          const symbolName = (element.propertyName ?? element.name).text;
          if (!symbolSet.has(symbolName)) continue;

          const exportedAs = element.name.text;
          const localAlias = element.propertyName ? exportedAs : null;

          const pos = sourceFile.getLineAndCharacterOfPosition(
            element.name.getStart(sourceFile),
          );

          // Re-exported symbols are not used locally — the value flows straight
          // out of this module without being bound to a local identifier.
          results.push({
            consumerPackage,
            filePath: sourceFile.fileName,
            line: pos.line + 1,
            column: pos.character + 1,
            symbolName,
            localAlias,
            usageCount: 0,
            isTypeOnly,
          });
        }
      } else if (stmt.exportClause && ts.isNamespaceExport(stmt.exportClause)) {
        // export * as Ns from '…'
        // All changed symbols are re-exported under the namespace name.
        const namespaceName = stmt.exportClause.name.text;
        const pos = sourceFile.getLineAndCharacterOfPosition(
          stmt.exportClause.name.getStart(sourceFile),
        );

        for (const symbolName of symbolSet) {
          results.push({
            consumerPackage,
            filePath: sourceFile.fileName,
            line: pos.line + 1,
            column: pos.character + 1,
            symbolName,
            localAlias: namespaceName,
            usageCount: 0,
            isTypeOnly,
          });
        }
      } else if (!stmt.exportClause) {
        // export * from '…'
        // All changed symbols are potentially re-exported; we can't know which
        // ones without expanding the star, so we record a site for each.
        const pos = sourceFile.getLineAndCharacterOfPosition(
          stmt.moduleSpecifier.getStart(sourceFile),
        );

        for (const symbolName of symbolSet) {
          results.push({
            consumerPackage,
            filePath: sourceFile.fileName,
            line: pos.line + 1,
            column: pos.character + 1,
            symbolName,
            localAlias: null,
            usageCount: 0,
            isTypeOnly,
          });
        }
      }
    }
  }

  return results;
}

/**
 * Locate every import site of `changedSymbols` (exported from
 * `changedPackageName`) within the consumer package at `consumerPkgPath`.
 *
 * A single `ts.Program` is created for the entire consumer package and reused
 * across all source files in that package.  The program is cached by package
 * path so repeated calls within a pipeline run are free.
 *
 * Returns an empty array — never throws — when:
 *  - `changedSymbols` is empty
 *  - the consumer has no `package.json`
 *  - the consumer does not import any of the changed symbols
 */
export function resolveImportSites(
  consumerPkgPath: string,
  changedPackageName: string,
  changedSymbols: string[],
): ImportSite[] {
  if (changedSymbols.length === 0) return [];

  const pkgJsonPath = path.join(consumerPkgPath, "package.json");
  if (!fs.existsSync(pkgJsonPath)) return [];

  let consumerPackage: string;
  try {
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")) as {
      name?: unknown;
    };
    consumerPackage =
      typeof pkgJson.name === "string"
        ? pkgJson.name
        : /* istanbul ignore next */ path.basename(consumerPkgPath);
  } catch /* istanbul ignore next */ {
    consumerPackage = path.basename(consumerPkgPath);
  }

  const program = loadProgram(consumerPkgPath);
  const compilerOptions = program.getCompilerOptions();
  const symbolSet = new Set(changedSymbols);

  // Normalise once so the per-file containment check is a simple string prefix.
  const normalizedPkgPath = path.resolve(consumerPkgPath) + path.sep;

  const results: ImportSite[] = [];

  for (const sourceFile of program.getSourceFiles()) {
    // Skip declaration files — they describe types, not runtime usage sites.
    if (sourceFile.isDeclarationFile) continue;

    // Only inspect files that actually live inside this consumer package.
    // The program may include files from referenced projects or path-aliased
    // packages; we must not attribute their imports to this consumer.
    const normalizedFile = path.resolve(sourceFile.fileName);
    if (!normalizedFile.startsWith(normalizedPkgPath)) continue;

    const sites = extractSitesFromFile(
      sourceFile,
      consumerPackage,
      changedPackageName,
      symbolSet,
      compilerOptions,
    );

    results.push(...sites);
  }

  return results;
}
