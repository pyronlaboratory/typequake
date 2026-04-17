import { performance } from "perf_hooks";
import type { MetricName } from "../types";

class PerformanceTracker {
  private metrics: Record<MetricName, number> = {
    extraction: 0,
    diff: 0,
    traversal: 0,
    total: 0,
  };

  private startTime: number = 0;

  start() {
    this.startTime = performance.now();
  }

  stop() {
    this.metrics.total = performance.now() - this.startTime;
  }

  track<T>(metric: MetricName, fn: () => T): T {
    const start = performance.now();
    try {
      return fn();
    } finally {
      this.metrics[metric] += performance.now() - start;
    }
  }

  async trackAsync<T>(metric: MetricName, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      this.metrics[metric] += performance.now() - start;
    }
  }

  getMetrics() {
    return { ...this.metrics };
  }

  log() {
    console.error("\nPerformance Metrics:");
    console.error(
      `  Extraction time:   ${this.metrics.extraction.toFixed(2)}ms`,
    );
    console.error(`  Diff time:         ${this.metrics.diff.toFixed(2)}ms`);
    console.error(
      `  Graph traversal:   ${this.metrics.traversal.toFixed(2)}ms`,
    );
    console.error(`  Total runtime:     ${this.metrics.total.toFixed(2)}ms`);
  }
}

export const tracker = new PerformanceTracker();
