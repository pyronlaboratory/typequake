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
    const cols = Math.min(process.stdout.columns || 60, 40);
    const width = cols - 4;

    const top = `╭${"─".repeat(width)}╮`;
    const mid = `├${"─".repeat(width)}┤`;
    const bot = `╰${"─".repeat(width)}╯`;
    const gray = (str: string) => `\x1b[90m${str}\x1b[0m`;
    const bold = (str: string) => `\x1b[1m${str}\x1b[0m`;
    const cyan = (str: string) => `\x1b[36m${str}\x1b[0m`;

    console.info(`\n${bold("⚡️ Performance Metrics")}`);
    console.info(`${gray(top)}`);

    const format = (label: string, value: number) => {
      const labelStr = `${label}`;
      const valueStr = `${value.toFixed(2)}ms`;
      const padding = " ".repeat(
        Math.max(0, width - labelStr.length - valueStr.length - 6),
      );

      console.info(
        `${gray("│")} ${labelStr}${padding}    ${bold(valueStr)} ${gray("│")}`,
      );
    };

    format("Type extraction", this.metrics.extraction);
    format("AST diffing", this.metrics.diff);
    format("Graph traversal", this.metrics.traversal);

    console.info(`${gray(mid)}`);

    const totalLabel = "Total Runtime";
    const totalValue = `${this.metrics.total.toFixed(2)}ms`;
    const totalPadding = " ".repeat(
      Math.max(0, width - totalLabel.length - totalValue.length - 2),
    );

    console.info(
      `${gray("│")} ${bold(totalLabel)}${totalPadding}${bold(cyan(totalValue))} ${gray("│")}`,
    );
    console.info(`${gray(bot)}\n`);
  }
}

export const tracker = new PerformanceTracker();
