#!/usr/bin/env node
import { Command } from "commander";

import { analyze } from "./commands/analyze";
import { installHook } from "./commands/install-hook";

const program = new Command();

program
  .name("typequake")
  .description("Semantic analysis of type changes and their downstream impact")
  .version("0.1.0");

// Main command: typequake <base-ref>
program
  .argument(
    "<base-ref>",
    "The base git reference to compare against (e.g., main, origin/main, HEAD~1)",
  )
  .option("--json", "Output results in JSON format")
  .option("--ci", "Exit with non-zero code if breaking changes are detected")
  .option("--no-cache", "Disable caching of analysis results")
  .option("--verbose", "Enable verbose logging")
  .action(async (baseRef, options) => {
    await analyze(baseRef, options);
  });

program
  .command("install-hook")
  .description("Install the pre-commit hook")
  .action(async () => {
    await installHook();
  });

// Ensure help shows if no args
if (!process.argv.slice(2).length) {
  program.outputHelp();
} else {
  program.parseAsync(process.argv);
}
