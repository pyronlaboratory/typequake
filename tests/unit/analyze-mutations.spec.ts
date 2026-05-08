import * as ts from "typescript";
import { describe, it, expect } from "vitest";
import {
  diff,
  ruleAdditive,
  ruleBreaking,
  ruleNarrowing,
  ruleRemoved,
  ruleWidening,
} from "../../src/core/analyze-mutations";
import type { SignatureMap, TypeSignature } from "../../src/types";

function createSig(
  name: string,
  overrides: Partial<TypeSignature> = {},
): TypeSignature {
  return {
    name,
    variant: "interface",
    typeString: "string",
    flags: 0 as ts.TypeFlags,
    properties: [],
    callSignatures: [],
    isExported: true,
    ...overrides,
  };
}

function mapOf(...sigs: TypeSignature[]): SignatureMap {
  const map = new Map<string, TypeSignature>();
  for (const s of sigs) map.set(s.name, s);
  return map;
}
describe("Mutation Analysis", () => {
  describe("export lifecycle changes", () => {
    it.each([
      {
        name: "removed export",
        before: mapOf(createSig("User")),
        after: mapOf(),
        expected: "REMOVED",
      },
      {
        name: "new export",
        before: mapOf(),
        after: mapOf(createSig("User")),
        expected: "ADDITIVE",
      },
    ])("detects $name", ({ before, after, expected }) => {
      const result = diff(before, after);

      expect(result).toHaveLength(1);
      expect(result[0]?.mutationClass).toBe(expected);
    });
  });

  describe("breaking structural changes", () => {
    it.each([
      {
        name: "required property removal",
        before: mapOf(
          createSig("User", {
            properties: [{ name: "id", typeString: "string", optional: false }],
          }),
        ),
        after: mapOf(createSig("User", { properties: [] })),
      },
      {
        name: "required property addition",
        before: mapOf(createSig("User", { properties: [] })),
        after: mapOf(
          createSig("User", {
            properties: [{ name: "id", typeString: "string", optional: false }],
          }),
        ),
      },
      {
        name: "call signature arity change",
        before: mapOf(
          createSig("fn", {
            callSignatures: ["(a: string) => void"],
          }),
        ),
        after: mapOf(
          createSig("fn", {
            callSignatures: ["(a: string, b: number) => void"],
          }),
        ),
      },
    ])("detects $name", ({ before, after }) => {
      const result = diff(before, after);

      expect(result[0]?.mutationClass).toBe("BREAKING");
    });
  });

  describe("type compatibility changes", () => {
    describe("narrowing", () => {
      it.each([
        {
          name: "union narrowing",
          before: mapOf(
            createSig("User", {
              typeString: "string | number",
            }),
          ),
          after: mapOf(
            createSig("User", {
              typeString: "string",
            }),
          ),
        },
        {
          name: "optional property becoming required",
          before: mapOf(
            createSig("User", {
              properties: [
                { name: "id", typeString: "string", optional: true },
              ],
            }),
          ),
          after: mapOf(
            createSig("User", {
              properties: [
                { name: "id", typeString: "string", optional: false },
              ],
            }),
          ),
        },
      ])("detects $name", ({ before, after }) => {
        const result = diff(before, after);

        expect(result[0]?.mutationClass).toBe("NARROWING");
      });
    });

    describe("widening", () => {
      it.each([
        {
          name: "union widening",
          before: mapOf(
            createSig("User", {
              typeString: "string",
            }),
          ),
          after: mapOf(
            createSig("User", {
              typeString: "string | undefined",
            }),
          ),
        },
        {
          name: "required property becoming optional",
          before: mapOf(
            createSig("User", {
              properties: [
                { name: "id", typeString: "string", optional: false },
              ],
            }),
          ),
          after: mapOf(
            createSig("User", {
              properties: [
                { name: "id", typeString: "string", optional: true },
              ],
            }),
          ),
        },
      ])("detects $name", ({ before, after }) => {
        const result = diff(before, after);

        expect(result[0]?.mutationClass).toBe("WIDENING");
      });
    });

    describe("non-breaking structural changes", () => {
      it("detects optional property addition", () => {
        const before = mapOf(
          createSig("User", {
            properties: [{ name: "id", typeString: "string", optional: false }],
          }),
        );

        const after = mapOf(
          createSig("User", {
            properties: [
              { name: "id", typeString: "string", optional: false },
              { name: "age", typeString: "number", optional: true },
            ],
          }),
        );

        const result = diff(before, after);

        expect(result[0]?.mutationClass).toBe("ADDITIVE");
      });
    });
  });

  describe("rule helpers", () => {
    it.each([
      {
        name: "removed rule",
        result: ruleRemoved("User", createSig("User"), undefined),
        expected: "REMOVED",
      },
      {
        name: "additive rule",
        result: ruleAdditive("User", undefined, createSig("User")),
        expected: "ADDITIVE",
      },
      {
        name: "breaking rule",
        result: ruleBreaking(
          "User",
          createSig("User", {
            properties: [{ name: "id", typeString: "string", optional: false }],
          }),
          createSig("User", { properties: [] }),
        ),
        expected: "BREAKING",
      },
      {
        name: "narrowing rule",
        result: ruleNarrowing(
          "User",
          createSig("User", { typeString: "string | number" }),
          createSig("User", { typeString: "string" }),
        ),
        expected: "NARROWING",
      },
      {
        name: "widening rule",
        result: ruleWidening(
          "User",
          createSig("User", { typeString: "string" }),
          createSig("User", { typeString: "string | undefined" }),
        ),
        expected: "WIDENING",
      },
    ])("$name returns correct mutation class", ({ result, expected }) => {
      expect(result?.mutationClass).toBe(expected);
    });
  });

  describe("stable surfaces", () => {
    it("returns no mutations for identical signatures", () => {
      const sig = createSig("User");

      const result = diff(mapOf(sig), mapOf({ ...sig }));

      expect(result).toEqual([]);
    });
  });
});
