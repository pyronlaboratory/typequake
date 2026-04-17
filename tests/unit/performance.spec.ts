import { describe, it, expect, vi } from "vitest";
import { tracker } from "../../src/utils/performance";

describe("Performance Tracker", () => {
  it("tracks synchronous operations", () => {
    const result = tracker.track("extraction", () => {
      // Simulate work
      return "done";
    });

    expect(result).toBe("done");
    const metrics = tracker.getMetrics();
    expect(metrics.extraction).toBeGreaterThanOrEqual(0);
  });

  it("tracks asynchronous operations", async () => {
    const result = await tracker.trackAsync("traversal", async () => {
      // Simulate work
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "done";
    });

    expect(result).toBe("done");
    const metrics = tracker.getMetrics();
    expect(metrics.traversal).toBeGreaterThanOrEqual(10);
  });

  it("accumulates metrics", () => {
    const initial = tracker.getMetrics().diff;
    tracker.track("diff", () => {});
    tracker.track("diff", () => {});
    const final = tracker.getMetrics().diff;
    expect(final).toBeGreaterThanOrEqual(initial);
  });

  it("logs metrics when requested", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    tracker.log();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Performance Metrics:"));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Extraction time:"));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Diff time:"));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Graph traversal:"));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Total runtime:"));
    spy.mockRestore();
  });
});
