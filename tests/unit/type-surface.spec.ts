import path from "path";
import fs from "fs";
import os from "os";
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
} from "vitest";

import { TypeSurfaceExtractor } from "../../src/core/type-surface.js";
import { readCache, writeCache, deleteCache } from "../../src/utils/cache.js";
import type { SignatureMap } from "../../src/types/index.js";

const FIXTURES = path.resolve(import.meta.dirname, "../fixtures/type-surface");
const BASELINE_PKG = path.join(FIXTURES, "baseline-pkg");
const ADVANCED_SURFACE = path.join(FIXTURES, "advanced-surface");
const NO_TSCONFIG = path.join(FIXTURES, "no-tsconfig-pkg");
const JS_MAIN_PKG = path.join(FIXTURES, "js-main-pkg");

function makeTmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "typequake-test-"));
}

function cleanDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe("TypeSurfaceExtractor – baseline-pkg", () => {
  let rootDir: string;
  let map: SignatureMap;

  beforeAll(() => {
    rootDir = makeTmpRoot();
    map = new TypeSurfaceExtractor(rootDir).extract(BASELINE_PKG);
  });

  afterAll(() => cleanDir(rootDir));

  it("extracts all exported symbols and no internal ones", () => {
    const names = [...map.keys()].sort();
    expect(names).toEqual(
      [
        "API_VERSION",
        "Role",
        "User",
        "UserService",
        "UserId",
        "double",
        "greet",
      ].sort(),
    );
    expect(map.has("_internal")).toBe(false);
    expect(map.has("_secret")).toBe(false);
  });

  it("serialises an interface with the correct variant", () => {
    const user = map.get("User");
    expect(user).toBeDefined();
    expect(user!.variant).toBe("interface");
    expect(user!.isExported).toBe(true);
  });

  it("includes all interface properties", () => {
    const propNames = (map.get("User")!.properties ?? [])
      .map((p) => p.name)
      .sort();
    expect(propNames).toContain("id");
    expect(propNames).toContain("name");
    expect(propNames).toContain("email");
  });

  it("marks optional interface properties correctly", () => {
    const props = map.get("User")!.properties!;
    expect(props.find((p) => p.name === "email")?.optional).toBe(true);
    expect(props.find((p) => p.name === "id")?.optional).toBe(false);
  });

  it("serialises a type alias with variant=type", () => {
    const userId = map.get("UserId");
    expect(userId?.variant).toBe("type");
    expect(userId?.typeString).toMatch(/number|string/);
  });

  it("serialises an enum with variant=enum", () => {
    expect(map.get("Role")?.variant).toBe("enum");
  });

  it("serialises a function declaration with variant=function", () => {
    expect(map.get("greet")?.variant).toBe("function");
  });

  it("serialises an arrow-function const with variant=function", () => {
    expect(map.get("double")?.variant).toBe("function");
  });

  it("serialises a plain const with variant=variable", () => {
    const version = map.get("API_VERSION");
    expect(version?.variant).toBe("variable");
    expect(version?.typeString).toBe('"v1"');
  });

  it("serialises a class with variant=class", () => {
    expect(map.get("UserService")?.variant).toBe("class");
  });

  it("produces deterministic output on repeated calls", () => {
    const map2 = new TypeSurfaceExtractor(rootDir).extract(BASELINE_PKG);
    expect([...map.keys()].sort()).toEqual([...map2.keys()].sort());
    for (const [key, sig] of map.entries()) {
      expect(map2.get(key)!.typeString).toBe(sig.typeString);
    }
  });

  it("flags field is always a number", () => {
    for (const sig of map.values()) {
      expect(typeof sig.flags).toBe("number");
    }
  });
});

describe("TypeSurfaceExtractor – advanced-surface", () => {
  let rootDir: string;
  let map: SignatureMap;

  beforeAll(() => {
    rootDir = makeTmpRoot();
    map = new TypeSurfaceExtractor(rootDir).extract(ADVANCED_SURFACE);
  });

  afterAll(() => cleanDir(rootDir));

  it("follows re-exports from sub-modules", () => {
    expect(map.has("Product")).toBe(true);
    expect(map.has("Status")).toBe(true);
  });

  it("serialises a generic interface", () => {
    expect(map.get("Repository")?.variant).toBe("interface");
  });

  it("serialises a union type alias", () => {
    expect(map.get("MaybeError")?.variant).toBe("type");
  });

  it("serialises an overloaded function", () => {
    expect(map.get("parse")?.variant).toBe("function");
  });
});

describe("TypeSurfaceExtractor – entry-point resolution", () => {
  let rootDir: string;

  beforeAll(() => {
    rootDir = makeTmpRoot();
  });
  afterAll(() => cleanDir(rootDir));

  it("falls back to compiler defaults when tsconfig.json is absent", () => {
    const map = new TypeSurfaceExtractor(rootDir).extract(NO_TSCONFIG);
    expect(map.has("VERSION")).toBe(true);
    expect(map.has("Env")).toBe(true);
    expect(map.get("VERSION")?.variant).toBe("variable");
    expect(map.get("Env")?.variant).toBe("type");
  });

  it("resolves main: './dist/index.js' via the .js → .d.ts substitution", () => {
    // package.json points to dist/index.js which doesn't exist;
    // the extractor should find dist/index.d.ts instead.
    const map = new TypeSurfaceExtractor(rootDir).extract(JS_MAIN_PKG);
    expect(map.has("compute")).toBe(true);
    expect(map.has("LABEL")).toBe(true);
  });
});

describe("TypeSurfaceExtractor – error paths", () => {
  let rootDir: string;

  beforeAll(() => {
    rootDir = makeTmpRoot();
  });
  afterAll(() => cleanDir(rootDir));

  it("throws when the package directory has no package.json", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "tq-no-pkg-"));
    try {
      expect(() => new TypeSurfaceExtractor(rootDir).extract(empty)).toThrow(
        /No package\.json/,
      );
    } finally {
      cleanDir(empty);
    }
  });

  it("throws when no TypeScript entry point can be resolved", () => {
    // A package.json with no types/main/exports and no conventional index file.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tq-no-entry-"));
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "empty-entry", version: "1.0.0" }),
    );
    try {
      expect(() => new TypeSurfaceExtractor(rootDir).extract(dir)).toThrow(
        /Cannot resolve TypeScript entry point/,
      );
    } finally {
      cleanDir(dir);
    }
  });
});

describe("TypeSurfaceExtractor – disk cache", () => {
  let rootDir: string;
  let extractor: TypeSurfaceExtractor;

  beforeEach(() => {
    rootDir = makeTmpRoot();
    extractor = new TypeSurfaceExtractor(rootDir);
  });

  afterEach(() => cleanDir(rootDir));

  it("writes a cache file when gitSha is provided", () => {
    const sha = "abc1234";
    extractor.extract(BASELINE_PKG, sha);

    const cachePath = path.join(
      rootDir,
      ".typequake",
      "cache",
      `fixtures__baseline-pkg.${sha}.json`,
    );
    expect(fs.existsSync(cachePath)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    expect(raw).toHaveProperty("User");
    expect(raw).toHaveProperty("greet");
  });

  it("serves from cache on the second call (does not re-parse source)", () => {
    const sha = "abc1234";
    const first = extractor.extract(BASELINE_PKG, sha);

    // Corrupt the source temporarily; the cache should still return good data.
    const indexPath = path.join(BASELINE_PKG, "index.ts");
    const original = fs.readFileSync(indexPath, "utf-8");
    fs.writeFileSync(indexPath, "// intentionally emptied", "utf-8");

    try {
      const second = extractor.extract(BASELINE_PKG, sha);
      expect([...second.keys()].sort()).toEqual([...first.keys()].sort());
    } finally {
      fs.writeFileSync(indexPath, original, "utf-8");
    }
  });

  it("skips cache when gitSha is omitted", () => {
    extractor.extract(BASELINE_PKG);
    const cacheDir = path.join(rootDir, ".typequake", "cache");
    const hasEntries = fs.existsSync(cacheDir)
      ? fs.readdirSync(cacheDir).length > 0
      : false;
    expect(hasEntries).toBe(false);
  });

  it("uses separate cache entries for different gitShas", () => {
    extractor.extract(BASELINE_PKG, "sha-111");
    extractor.extract(BASELINE_PKG, "sha-222");

    const files = fs.readdirSync(path.join(rootDir, ".typequake", "cache"));
    expect(files.some((f) => f.includes("sha-111"))).toBe(true);
    expect(files.some((f) => f.includes("sha-222"))).toBe(true);
  });
});

describe("cache utilities – standalone", () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = makeTmpRoot();
  });
  afterEach(() => cleanDir(rootDir));

  it("round-trips a SignatureMap through writeCache / readCache", () => {
    const original: SignatureMap = new Map([
      [
        "Foo",
        {
          name: "Foo",
          variant: "interface",
          typeString: "Foo",
          flags: 524288,
          isExported: true,
          properties: [{ name: "bar", typeString: "string", optional: false }],
        },
      ],
    ]);

    writeCache(rootDir, "my-pkg", "deadbeef", original);
    const loaded = readCache(rootDir, "my-pkg", "deadbeef");

    expect(loaded).not.toBeNull();
    expect(loaded!.get("Foo")).toMatchObject({
      name: "Foo",
      variant: "interface",
      typeString: "Foo",
      properties: [{ name: "bar", typeString: "string", optional: false }],
    });
  });

  it("returns null for a missing key", () => {
    expect(readCache(rootDir, "no-pkg", "sha123")).toBeNull();
  });

  it("returns null for a corrupt cache file", () => {
    const dir = path.join(rootDir, ".typequake", "cache");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "my-pkg.badsha.json"), "not json", "utf-8");
    expect(readCache(rootDir, "my-pkg", "badsha")).toBeNull();
  });

  it("escapes scoped package names (no @ or / in filename)", () => {
    const map: SignatureMap = new Map([
      [
        "X",
        {
          name: "X",
          variant: "variable",
          typeString: "number",
          flags: 8,
          isExported: true,
        },
      ],
    ]);

    writeCache(rootDir, "@scope/pkg", "sha999", map);
    const loaded = readCache(rootDir, "@scope/pkg", "sha999");
    expect(loaded).not.toBeNull();

    const files = fs.readdirSync(path.join(rootDir, ".typequake", "cache"));
    expect(files.every((f) => !f.includes("@") && !f.includes("/"))).toBe(true);
  });

  it("deleteCache removes the file and subsequent reads return null", () => {
    const map: SignatureMap = new Map();
    writeCache(rootDir, "del-pkg", "sha000", map);
    expect(readCache(rootDir, "del-pkg", "sha000")).not.toBeNull();

    deleteCache(rootDir, "del-pkg", "sha000");
    expect(readCache(rootDir, "del-pkg", "sha000")).toBeNull();
  });
});
