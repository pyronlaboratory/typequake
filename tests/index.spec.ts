import { describe, it, expect } from "vitest";
import { getChangeType } from "../index";

describe("getChangeType", () => {
  it("detects new export", () =>
    expect(getChangeType(null, "User")).toBe("ADDITIVE"));
  it("detects removed export", () =>
    expect(getChangeType("User", null)).toBe("REMOVED"));
  it("detects type change", () =>
    expect(getChangeType("UserA", "UserB")).toBe("BREAKING"));
  it("detects no change", () =>
    expect(getChangeType("User", "User")).toBe("UNCHANGED"));
});
