import path from "path";
import fs from "fs";
import os from "os";
import ts from "typescript";
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
} from "vitest";
import { TypeSurfaceExtractor } from "../../src/core/extract-types";
import { readCache, writeCache, getCacheKey } from "../../src/utils/cache";
import type { SignatureMap } from "../../src/types/index";

const FIXTURES = path.resolve(import.meta.dirname, "../fixtures/definitions");
const BASELINE_PKG = path.join(FIXTURES, "pkg-baseline");
const COMPREHENSIVE_PKG = path.join(FIXTURES, "pkg-comprehensive");
const CONFIGLESS_PKG = path.join(FIXTURES, "pkg-configless");
const UNTYPED_PKG = path.join(FIXTURES, "pkg-untyped");

function makeTmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "typequake-test-"));
}

function cleanDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}
describe("TypeSurfaceExtractor API", () => {
  describe("pkg-baseline", () => {
    let rootDir: string;
    let map: SignatureMap;

    beforeAll(() => {
      rootDir = makeTmpRoot();
      map = new TypeSurfaceExtractor(rootDir).extract(BASELINE_PKG);
    });

    afterAll(() => cleanDir(rootDir));

    it("extracts all exported symbols", () => {
      const names = [...map.keys()].sort();
      expect(names).toEqual(["ID", "User", "getUser"].sort());
    });

    it("includes all interface properties", () => {
      const propNames = (map.get("User")!.properties ?? [])
        .map((p) => p.name)
        .sort();
      expect(propNames).toEqual(["id", "username", "email"].sort());
    });

    it("serialises an interface with the correct variant", () => {
      const user = map.get("User");
      expect(user).toBeDefined();
      expect(user!.variant).toBe("interface");
      expect(user!.isExported).toBe(true);
    });

    it("serialises a type alias with variant=type", () => {
      const userId = map.get("ID");
      expect(userId?.variant).toBe("type");
      expect(userId?.typeString).toMatch(/number|string/);
    });

    it("serialises a function declaration with variant=function", () => {
      expect(map.get("getUser")?.variant).toBe("function");
    });

    it("produces deterministic output on repeated calls", () => {
      const map2 = new TypeSurfaceExtractor(rootDir).extract(BASELINE_PKG);
      expect([...map.keys()].sort()).toEqual([...map2.keys()].sort());
      for (const [key, sig] of map.entries()) {
        expect(map2.get(key)!.typeString).toBe(sig.typeString);
      }
    });
  });

  describe("pkg-comprehensive", () => {
    let rootDir: string;
    let map: SignatureMap;

    beforeAll(() => {
      rootDir = makeTmpRoot();
      map = new TypeSurfaceExtractor(rootDir).extract(COMPREHENSIVE_PKG);
    });

    afterAll(() => cleanDir(rootDir));

    it("serialises advanced declaration variants", () => {
      const expectations = [
        ["API", "namespace"],
        ["BaseService", "class"],
        ["UserService", "class"],
        ["Status", "type"],
        ["DeepReadonly", "type"],
      ] as const;

      for (const [name, variant] of expectations) {
        expect(map.has(name)).toBe(true);
        expect(map.get(name)?.variant).toBe(variant);
      }
    });

    it("preserves class method call signatures", () => {
      const userService = map.get("UserService");

      expect(userService).toBeDefined();
      expect(userService?.variant).toBe("class");

      const properties = userService?.properties ?? [];

      const genericMethod = properties.find((p) => p.name === "getById");

      expect(genericMethod).toBeDefined();

      expect(genericMethod?.typeString).toContain("<T>");
      expect(genericMethod?.typeString).toContain("Promise");
      // expect(genericMethod?.typeString).toMatch(/Promise/); // safer version
    });

    it("serialises union types and mapped types", () => {
      expect(map.get("Status")?.variant).toBe("type");
      expect(map.get("DeepReadonly")?.variant).toBe("type");
    });
  });

  describe("entry-point resolution", () => {
    let rootDir: string;

    beforeAll(() => {
      rootDir = makeTmpRoot();
    });

    afterAll(() => cleanDir(rootDir));

    it("falls back to compiler defaults when tsconfig.json is absent", () => {
      const map = new TypeSurfaceExtractor(rootDir).extract(CONFIGLESS_PKG);
      expect(map.has("standalone")).toBe(true);
      expect(map.has("Simple")).toBe(true);
    });

    it("resolves main entry point for untyped packages", () => {
      const map = new TypeSurfaceExtractor(rootDir).extract(UNTYPED_PKG);
      expect(map.has("version")).toBe(true);
      expect(map.has("init")).toBe(true);
    });
  });

  describe("disk cache", () => {
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

      const tsconfig = fs.readFileSync(
        path.join(BASELINE_PKG, "tsconfig.json"),
        "utf-8",
      );
      const hash = getCacheKey("@fixture/baseline", sha, tsconfig);

      const cachePath = path.join(
        rootDir,
        ".typequake",
        "cache",
        `fixture__baseline.${hash}.json`,
      );
      expect(fs.existsSync(cachePath)).toBe(true);
    });

    it("reuses cached extraction results", () => {
      const sha = "abc1234";
      const first = extractor.extract(BASELINE_PKG, sha);

      // Mutate source after cache is written.
      const sourceFile = path.join(BASELINE_PKG, "index.ts");

      const original = fs.readFileSync(sourceFile, "utf-8");

      fs.writeFileSync(
        sourceFile,
        `${original}\nexport interface AddedAfterCache { value: string }`,
        "utf-8",
      );

      try {
        const second = extractor.extract(BASELINE_PKG, sha);

        expect(second.has("AddedAfterCache")).toBe(false);
        expect(second.has("User")).toBe(true);
        expect([...second.keys()]).toEqual([...first.keys()]);
      } finally {
        fs.writeFileSync(sourceFile, original, "utf-8");
      }
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
            flags: ts.TypeFlags.Object,
            isExported: true,
            properties: [
              { name: "bar", typeString: "string", optional: false },
            ],
          },
        ],
      ]);

      writeCache(rootDir, "my-pkg", "deadbeef", original);
      const loaded = readCache(rootDir, "my-pkg", "deadbeef");

      expect(loaded).not.toBeNull();
      expect(loaded!.get("Foo")).toMatchObject({
        name: "Foo",
        variant: "interface",
      });
    });
  });
});
