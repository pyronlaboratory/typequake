#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";

import { analyze } from "./commands/analyze";
import { installHook } from "./commands/install-hook";

function validateRef(value: string): string {
  if (!value?.trim()) {
    throw new InvalidArgumentError("Base ref cannot be empty.");
  }
  if (/[\x00-\x1f\x7f ^:?*\[\\]/.test(value)) {
    throw new InvalidArgumentError(`"${value}" is not a valid git ref.`);
  }
  return value.trim();
}

const program = new Command();

program
  .name("typequake")
  .description("Semantic analysis of type changes and their downstream impact")
  .version("1.0.0", "-v, --version")
  .addHelpText(
    "after",
    `
Examples:
  $ typequake main
  $ typequake HEAD~1 --json
  $ typequake origin/main --ci
  $ typequake install-hook
`,
  );

// Main command: typequake <base-ref>
program
  .argument(
    "<base-ref>",
    "Git ref to compare against (branch, tag, or SHA)",
    validateRef,
  )
  .option("--json", "Output results in JSON format")
  .option("--ci", "Exit with non-zero code if breaking changes are detected")
  .option("--no-cache", "Disable caching of analysis results")
  .option("--verbose", "Enable verbose logging")
  .option("--timing", "Log performance timing metrics")
  .action(async (baseRef, options) => {
    await analyze(baseRef, options);
  });

program
  .command("install-hook")
  .description("Install the pre-push git hook for CI enforcement")
  .action(async () => {
    await installHook();
  });

program.showHelpAfterError("(run typequake --help for usage)");
program.configureOutput({ writeErr: (str) => process.stderr.write(str) });

if (!process.argv.slice(2).length) {
  program.outputHelp();
} else {
  program.parseAsync(process.argv).catch((err) => {
    if (!err.code?.startsWith("commander.")) {
      process.stderr.write(`\nError: ${err.message ?? err}\n`);
    }
    process.exit(1);
  });
}
