import type { AnalyzeOptions } from "../types";

export async function analyze(baseRef: string, options: AnalyzeOptions) {
  if (options.verbose) {
    console.warn("[typequake] Running analysis...");
  }

  console.log(`Analyzing against base ref: ${baseRef}`);

  if (options.json) {
    console.log(JSON.stringify({ ok: true }));
  }

  if (options.ci) {
    // stub: no breaking changes yet
    process.exit(0);
  }
}
