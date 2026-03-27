import fs from "fs";
import path from "path";
import ts from "typescript";

import type {
  PackageJson,
  PropertySignature,
  SignatureMap,
  TypeSignature,
} from "../types/index.js";
import { readCache, writeCache } from "../utils/cache.ts";

/**
 * Ordered list of package.json fields to inspect when locating the TypeScript
 * entry point of a package.  We prefer explicit type declarations over the
 * compiled JS `main` field.
 */
function resolveEntryPoint(
  packagePath: string,
  pkgJson: PackageJson,
): string | null {
  const candidates: (string | undefined)[] = [
    pkgJson.types,
    pkgJson.typings,
    // exports map — supports { ".": { "types": "./dist/index.d.ts" } }
    (pkgJson.exports as any)?.["."]?.types,
    (pkgJson.exports as any)?.types,
    pkgJson.main,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;

    const base = path.resolve(packagePath, candidate);

    // Try the path as-is, then with .d.ts / .ts substituted for .js.
    const variations = [
      base,
      base.replace(/\.js$/, ".d.ts"),
      base.replace(/\.js$/, ".ts"),
    ];

    for (const v of variations) {
      if (fs.existsSync(v)) return v;
    }
  }

  // Fallback: common convention files at the package root.
  for (const name of [
    "index.ts",
    "src/index.ts",
    "index.d.ts",
    "src/index.d.ts",
  ]) {
    const p = path.join(packagePath, name);
    if (fs.existsSync(p)) return p;
  }

  return null;
}

function loadCompilerOptions(packagePath: string): ts.CompilerOptions {
  const tsconfigPath = path.join(packagePath, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) {
    return { noEmit: true, skipLibCheck: true, strict: true };
  }

  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    return { noEmit: true, skipLibCheck: true, strict: true };
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(tsconfigPath),
  );

  return { ...parsed.options, noEmit: true };
}

function variantFromDeclaration(
  decl: ts.Declaration,
  type: ts.Type,
): TypeSignature["variant"] | null {
  if (ts.isInterfaceDeclaration(decl)) return "interface";
  if (ts.isTypeAliasDeclaration(decl)) return "type";
  if (ts.isClassDeclaration(decl)) return "class";
  if (ts.isEnumDeclaration(decl)) return "enum";
  if (
    ts.isFunctionDeclaration(decl) ||
    ts.isMethodDeclaration(decl) ||
    ts.isArrowFunction(decl) ||
    ts.isFunctionExpression(decl)
  ) {
    return "function";
  }
  if (ts.isVariableDeclaration(decl)) {
    // A `const fn = () => {}` still deserves the "function" variant.
    return type.getCallSignatures().length > 0 ? "function" : "variable";
  }
  return null;
}

function extractProperties(
  type: ts.Type,
  checker: ts.TypeChecker,
): PropertySignature[] {
  return type
    .getProperties()
    .sort((a, b) => a.getName().localeCompare(b.getName()))
    .map((prop) => {
      const decl = prop.getDeclarations()?.[0];
      const propType = decl
        ? checker.getTypeOfSymbolAtLocation(prop, decl)
        : checker.getDeclaredTypeOfSymbol(prop);

      return {
        name: prop.getName(),
        typeString: checker.typeToString(propType),
        optional: (prop.flags & ts.SymbolFlags.Optional) !== 0,
      };
    });
}

function extractCallSignatures(
  type: ts.Type,
  checker: ts.TypeChecker,
): string[] {
  return type
    .getCallSignatures()
    .map((sig) => checker.signatureToString(sig))
    .sort((a, b) => a.localeCompare(b));
}

function serializeSymbol(
  sym: ts.Symbol,
  checker: ts.TypeChecker,
): TypeSignature | null {
  const name = sym.escapedName.toString();
  // Skip TS internal / ambient symbols.
  if (name.startsWith("__")) return null;

  const declarations = sym.getDeclarations();
  if (!declarations || declarations.length === 0) return null;

  // Re-exported symbols (e.g. `export type { Foo } from "./other"`) have their
  // first declaration as an ExportSpecifier pointing back to this file's
  // re-export statement, not to the original declaration.  Resolve through the
  // alias so we get the real interface/type/class node.
  let resolvedSym = sym;
  if (ts.isExportSpecifier(declarations[0]!)) {
    // istanbul ignore next
    try {
      resolvedSym = checker.getAliasedSymbol(sym);
    } catch {
      return null;
    }
  }

  const resolvedDecls = resolvedSym.getDeclarations();
  if (!resolvedDecls || resolvedDecls.length === 0) return null;
  const decl = resolvedDecls[0]!;

  let type: ts.Type;
  let typeString: string;

  if (ts.isTypeAliasDeclaration(decl)) {
    // getDeclaredTypeOfSymbol / getTypeFromTypeNode both return the opaque
    // alias name ("UserId") rather than the expanded form ("number | string").
    // Reading the type-node text directly gives the exact RHS of the alias,
    // which is what we need for deterministic diffing.
    type = checker.getDeclaredTypeOfSymbol(resolvedSym);
    typeString = decl.type.getText();
  } else if (ts.isInterfaceDeclaration(decl) || ts.isEnumDeclaration(decl)) {
    type = checker.getDeclaredTypeOfSymbol(resolvedSym);
    typeString = checker.typeToString(
      type,
      undefined,
      ts.TypeFormatFlags.NoTruncation,
    );
  } else {
    type = checker.getTypeOfSymbolAtLocation(resolvedSym, decl);
    typeString = checker.typeToString(
      type,
      undefined,
      ts.TypeFormatFlags.NoTruncation,
    );
  }

  const variant = variantFromDeclaration(decl, type);
  if (!variant) return null;

  const properties =
    variant === "interface" || variant === "class" || variant === "type"
      ? extractProperties(type, checker)
      : undefined;

  const callSigs =
    variant === "function" || variant === "variable"
      ? extractCallSignatures(type, checker)
      : undefined;

  return {
    name,
    variant,
    typeString,
    flags: type.flags,
    properties: properties && properties.length > 0 ? properties : undefined,
    callSignatures: callSigs && callSigs.length > 0 ? callSigs : undefined,
    isExported: true,
  };
}

const programCache = new Map<string, ts.Program>();

function getProgram(entryPoint: string, options: ts.CompilerOptions) {
  // const key = entryPoint + JSON.stringify(options);
  const key = entryPoint;

  let program = programCache.get(key);
  if (!program) {
    program = ts.createProgram([entryPoint], options);
    programCache.set(key, program);
  }

  return program;
}

export class TypeSurfaceExtractor {
  constructor(
    /** Monorepo root — used to locate `.typequake/cache/`. */
    private readonly rootDir: string,
  ) {}

  /**
   * Extract the full exported type surface of a package.
   *
   * @param packagePath  Absolute path to the package directory.
   * @param gitSha       Optional git SHA used as the cache key.  When omitted
   *                     caching is skipped entirely for this call.
   */
  extract(packagePath: string, gitSha?: string): SignatureMap {
    const pkgJsonPath = path.join(packagePath, "package.json");
    if (!fs.existsSync(pkgJsonPath)) {
      throw new Error(`No package.json found at ${packagePath}`);
    }

    const pkgJson: PackageJson = JSON.parse(
      fs.readFileSync(pkgJsonPath, "utf-8"),
    );
    const pkgName = pkgJson.name ?? path.basename(packagePath);

    if (gitSha) {
      const cached = readCache(this.rootDir, pkgName, gitSha);
      if (cached) return cached;
    }

    const entryPoint = resolveEntryPoint(packagePath, pkgJson);
    if (!entryPoint) {
      throw new Error(
        `Cannot resolve TypeScript entry point for package "${pkgName}" at ${packagePath}. ` +
          `Ensure the package.json has a "types", "typings", or "main" field pointing to a .ts or .d.ts file.`,
      );
    }

    const compilerOptions = loadCompilerOptions(packagePath);
    // const program = ts.createProgram([entryPoint], compilerOptions);
    const program = getProgram(entryPoint, compilerOptions);
    const checker = program.getTypeChecker();

    const sourceFile = program.getSourceFile(entryPoint);
    if (!sourceFile) {
      throw new Error(`TypeScript compiler could not load file: ${entryPoint}`);
    }

    const signatures: SignatureMap = new Map();
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);

    if (moduleSymbol) {
      // Standard ES-module path — the checker gives us the module symbol
      // whose exports() list is the canonical set of public symbols.
      for (const sym of checker.getExportsOfModule(moduleSymbol)) {
        const sig = serializeSymbol(sym, checker);
        if (sig) signatures.set(sig.name, sig);
      }
    } else {
      // Script-mode fallback — iterate top-level exported declarations.

      // istanbul ignore next
      for (const stmt of sourceFile.statements) {
        if (!isExportedStatement(stmt)) continue;
        for (const sym of getSymbolsFromStatement(stmt, checker)) {
          const sig = serializeSymbol(sym, checker);
          if (sig) signatures.set(sig.name, sig);
        }
      }
    }

    if (gitSha) {
      writeCache(this.rootDir, pkgName, gitSha, signatures);
    }

    const sorted = new Map(
      [...signatures.entries()].sort(([a], [b]) => a.localeCompare(b)),
    );

    return sorted;
  }
}

// script-mode fallback

// istanbul ignore next
function isExportedStatement(node: ts.Statement): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return (ts.getModifiers(node) ?? []).some(
    (m) => m.kind === ts.SyntaxKind.ExportKeyword,
  );
}

// istanbul ignore next
function getSymbolsFromStatement(
  stmt: ts.Statement,
  checker: ts.TypeChecker,
): ts.Symbol[] {
  if (
    ts.isInterfaceDeclaration(stmt) ||
    ts.isTypeAliasDeclaration(stmt) ||
    ts.isClassDeclaration(stmt) ||
    ts.isEnumDeclaration(stmt) ||
    ts.isFunctionDeclaration(stmt)
  ) {
    if (stmt.name) {
      const sym = checker.getSymbolAtLocation(stmt.name);
      if (sym) return [sym];
    }
    return [];
  }

  if (ts.isVariableStatement(stmt)) {
    return stmt.declarationList.declarations.flatMap((decl) => {
      const sym = checker.getSymbolAtLocation(decl.name);
      return sym ? [sym] : [];
    });
  }

  return [];
}
