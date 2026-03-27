import type {
  SignatureMap,
  TypeSignature,
  PropertySignature,
  MutationRecord,
} from "../types";

function parseUnion(typeString: string): Set<string> {
  return new Set(
    typeString
      .split("|")
      .map((t) => t.trim())
      .filter(Boolean),
  );
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  for (const val of a) {
    if (!b.has(val)) return false;
  }
  return true;
}

function getPropMap(
  props?: PropertySignature[],
): Map<string, PropertySignature> {
  const map = new Map<string, PropertySignature>();
  if (!props) return map;
  for (const p of props) map.set(p.name, p);
  return map;
}

export function ruleRemoved(
  symbolName: string,
  before: TypeSignature | undefined,
  after: TypeSignature | undefined,
): MutationRecord | null {
  if (before && !after) {
    return {
      symbolName,
      mutationClass: "REMOVED",
      before,
      after: null,
      detail: `export '${symbolName}' was removed`,
    };
  }
  return null;
}

export function ruleAdditive(
  symbolName: string,
  before: TypeSignature | undefined,
  after: TypeSignature | undefined,
): MutationRecord | null {
  if (!before && after) {
    return {
      symbolName,
      mutationClass: "ADDITIVE",
      before: null,
      after,
      detail: `new export '${symbolName}' added`,
    };
  }

  if (!before || !after) return null;

  const beforeProps = getPropMap(before.properties);
  const afterProps = getPropMap(after.properties);

  for (const [name, prop] of afterProps) {
    if (!beforeProps.has(name) && prop.optional) {
      return {
        symbolName,
        mutationClass: "ADDITIVE",
        before,
        after,
        detail: `optional property '${name}' added to ${symbolName}`,
      };
    }
  }

  return null;
}

export function ruleBreaking(
  symbolName: string,
  before: TypeSignature | undefined,
  after: TypeSignature | undefined,
): MutationRecord | null {
  if (!before || !after) return null;

  const beforeProps = getPropMap(before.properties);
  const afterProps = getPropMap(after.properties);

  for (const [name, prop] of beforeProps) {
    if (!afterProps.has(name) && !prop.optional) {
      return {
        symbolName,
        mutationClass: "BREAKING",
        before,
        after,
        detail: `required property '${name}' removed from ${symbolName}`,
      };
    }
  }

  for (const [name, prop] of afterProps) {
    if (!beforeProps.has(name) && !prop.optional) {
      return {
        symbolName,
        mutationClass: "BREAKING",
        before,
        after,
        detail: `required property '${name}' added to ${symbolName}`,
      };
    }
  }

  const beforeCalls = before.callSignatures || [];
  const afterCalls = after.callSignatures || [];

  if (beforeCalls.length && afterCalls.length) {
    const beforeArity = beforeCalls.map((s) => s.split(",").length);
    const afterArity = afterCalls.map((s) => s.split(",").length);

    const mismatch =
      beforeArity.length !== afterArity.length ||
      beforeArity.some((a, i) => a !== afterArity[i]);

    if (mismatch) {
      return {
        symbolName,
        mutationClass: "BREAKING",
        before,
        after,
        detail: `call signature arity changed for ${symbolName}`,
      };
    }
  }

  return null;
}

export function ruleNarrowing(
  symbolName: string,
  before: TypeSignature | undefined,
  after: TypeSignature | undefined,
): MutationRecord | null {
  if (!before || !after) return null;

  const beforeUnion = parseUnion(before.typeString);
  const afterUnion = parseUnion(after.typeString);

  if (
    beforeUnion.size > 1 &&
    afterUnion.size >= 1 &&
    isSubset(afterUnion, beforeUnion) &&
    before.typeString !== after.typeString
  ) {
    return {
      symbolName,
      mutationClass: "NARROWING",
      before,
      after,
      detail: `type of '${symbolName}' narrowed from '${before.typeString}' to '${after.typeString}'`,
    };
  }

  const beforeProps = getPropMap(before.properties);
  const afterProps = getPropMap(after.properties);

  for (const [name, beforeProp] of beforeProps) {
    const afterProp = afterProps.get(name);
    if (afterProp && beforeProp.optional && !afterProp.optional) {
      return {
        symbolName,
        mutationClass: "NARROWING",
        before,
        after,
        detail: `property '${name}' made required in ${symbolName}`,
      };
    }
  }

  return null;
}

export function ruleWidening(
  symbolName: string,
  before: TypeSignature | undefined,
  after: TypeSignature | undefined,
): MutationRecord | null {
  if (!before || !after) return null;

  const beforeUnion = parseUnion(before.typeString);
  const afterUnion = parseUnion(after.typeString);

  if (afterUnion.size > beforeUnion.size && isSubset(beforeUnion, afterUnion)) {
    return {
      symbolName,
      mutationClass: "WIDENING",
      before,
      after,
      detail: `type of '${symbolName}' widened from '${before.typeString}' to '${after.typeString}'`,
    };
  }

  const beforeProps = getPropMap(before.properties);
  const afterProps = getPropMap(after.properties);

  for (const [name, beforeProp] of beforeProps) {
    const afterProp = afterProps.get(name);
    if (afterProp && !beforeProp.optional && afterProp.optional) {
      return {
        symbolName,
        mutationClass: "WIDENING",
        before,
        after,
        detail: `property '${name}' made optional in ${symbolName}`,
      };
    }
  }

  return null;
}

export function diff(
  before: SignatureMap,
  after: SignatureMap,
): MutationRecord[] {
  const results: MutationRecord[] = [];

  const allSymbols = new Set<string>([...before.keys(), ...after.keys()]);

  for (const symbolName of allSymbols) {
    const beforeSig = before.get(symbolName);
    const afterSig = after.get(symbolName);

    const removed = ruleRemoved(symbolName, beforeSig, afterSig);
    if (removed) {
      results.push(removed);
      continue;
    }

    const additive = ruleAdditive(symbolName, beforeSig, afterSig);
    if (additive && !beforeSig) {
      results.push(additive);
      continue;
    }

    // If both exist, evaluate structural changes
    if (beforeSig && afterSig) {
      // Skip identical
      if (
        beforeSig.typeString === afterSig.typeString &&
        JSON.stringify(beforeSig.properties) ===
          JSON.stringify(afterSig.properties) &&
        JSON.stringify(beforeSig.callSignatures) ===
          JSON.stringify(afterSig.callSignatures)
      ) {
        continue;
      }

      const breaking = ruleBreaking(symbolName, beforeSig, afterSig);
      if (breaking) {
        results.push(breaking);
        continue;
      }

      const narrowing = ruleNarrowing(symbolName, beforeSig, afterSig);
      if (narrowing) {
        results.push(narrowing);
        continue;
      }

      const widening = ruleWidening(symbolName, beforeSig, afterSig);
      if (widening) {
        results.push(widening);
        continue;
      }

      const additiveChange = ruleAdditive(symbolName, beforeSig, afterSig);
      if (additiveChange) {
        results.push(additiveChange);
        continue;
      }
    }
  }

  return results;
}
