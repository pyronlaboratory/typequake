import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import {
  diff,
  ruleAdditive,
  ruleBreaking,
  ruleNarrowing,
  ruleRemoved,
  ruleWidening,
} from "../../src/core/semantic-differ";
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

describe("REMOVED", () => {
  it("detects removed export", () => {
    const before = mapOf(createSig("User"));
    const after = mapOf();

    const result = diff(before, after);

    expect(result).toHaveLength(1);
    expect(result[0]?.mutationClass).toBe("REMOVED");
    expect(result[0]?.detail).toContain("removed");
  });

  it("ruleRemoved works independently", () => {
    const before = createSig("User");
    const res = ruleRemoved("User", before, undefined);

    expect(res?.mutationClass).toBe("REMOVED");
  });
});

describe("ADDITIVE", () => {
  it("detects new export", () => {
    const before = mapOf();
    const after = mapOf(createSig("User"));

    const result = diff(before, after);

    expect(result[0]?.mutationClass).toBe("ADDITIVE");
  });

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

  it("ruleAdditive works independently", () => {
    const res = ruleAdditive("User", undefined, createSig("User"));
    expect(res?.mutationClass).toBe("ADDITIVE");
  });
});

describe("BREAKING", () => {
  it("detects required property removal", () => {
    const before = mapOf(
      createSig("User", {
        properties: [{ name: "id", typeString: "string", optional: false }],
      }),
    );

    const after = mapOf(createSig("User", { properties: [] }));

    const result = diff(before, after);

    expect(result[0]?.mutationClass).toBe("BREAKING");
  });

  it("detects required property addition", () => {
    const before = mapOf(createSig("User", { properties: [] }));

    const after = mapOf(
      createSig("User", {
        properties: [{ name: "id", typeString: "string", optional: false }],
      }),
    );

    const result = diff(before, after);

    expect(result[0]?.mutationClass).toBe("BREAKING");
  });

  it("detects call signature arity change", () => {
    const before = mapOf(
      createSig("fn", {
        callSignatures: ["(a: string) => void"],
      }),
    );

    const after = mapOf(
      createSig("fn", {
        callSignatures: ["(a: string, b: number) => void"],
      }),
    );

    const result = diff(before, after);

    expect(result[0]?.mutationClass).toBe("BREAKING");
  });

  it("ruleBreaking works independently", () => {
    const before = createSig("User", {
      properties: [{ name: "id", typeString: "string", optional: false }],
    });

    const after = createSig("User", { properties: [] });

    const res = ruleBreaking("User", before, after);
    expect(res?.mutationClass).toBe("BREAKING");
  });
});

describe("NARROWING", () => {
  it("detects union narrowing", () => {
    const before = mapOf(createSig("User", { typeString: "string | number" }));

    const after = mapOf(createSig("User", { typeString: "string" }));

    const result = diff(before, after);

    expect(result[0]?.mutationClass).toBe("NARROWING");
  });

  it("detects optional → required property", () => {
    const before = mapOf(
      createSig("User", {
        properties: [{ name: "id", typeString: "string", optional: true }],
      }),
    );

    const after = mapOf(
      createSig("User", {
        properties: [{ name: "id", typeString: "string", optional: false }],
      }),
    );

    const result = diff(before, after);

    expect(result[0]?.mutationClass).toBe("NARROWING");
  });

  it("ruleNarrowing works independently", () => {
    const before = createSig("User", {
      typeString: "string | number",
    });
    const after = createSig("User", {
      typeString: "string",
    });

    const res = ruleNarrowing("User", before, after);
    expect(res?.mutationClass).toBe("NARROWING");
  });
});

describe("WIDENING", () => {
  it("detects union widening", () => {
    const before = mapOf(createSig("User", { typeString: "string" }));

    const after = mapOf(
      createSig("User", { typeString: "string | undefined" }),
    );

    const result = diff(before, after);

    expect(result[0]?.mutationClass).toBe("WIDENING");
  });

  it("detects required → optional property", () => {
    const before = mapOf(
      createSig("User", {
        properties: [{ name: "id", typeString: "string", optional: false }],
      }),
    );

    const after = mapOf(
      createSig("User", {
        properties: [{ name: "id", typeString: "string", optional: true }],
      }),
    );

    const result = diff(before, after);

    expect(result[0]?.mutationClass).toBe("WIDENING");
  });

  it("ruleWidening works independently", () => {
    const before = createSig("User", { typeString: "string" });
    const after = createSig("User", {
      typeString: "string | undefined",
    });

    const res = ruleWidening("User", before, after);
    expect(res?.mutationClass).toBe("WIDENING");
  });
});

describe("NO CHANGE", () => {
  it("returns empty array when identical", () => {
    const sig = createSig("User");

    const before = mapOf(sig);
    const after = mapOf({ ...sig });

    const result = diff(before, after);

    expect(result).toHaveLength(0);
  });
});
