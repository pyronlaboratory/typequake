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

const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);

const program = new Command();

program.configureHelp({
  styleOptionDescription: capitalize,
  styleCommandDescription: capitalize,
  styleArgumentDescription: capitalize,
  styleDescriptionText: capitalize,
});

program
  .name("typequake")
  .description("Semantic analysis of type changes and their downstream impact")
  .version("1.0.2", "-v, --version")
  .addHelpText(
    "after",
    `
Examples:
  $ <runner> typequake main
  $ <runner> typequake HEAD~1 --json
  $ <runner> typequake origin/main --ci
  $ <runner> typequake install-hook

(Note: <runner> can be npx, bunx, or pnpx)
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
  .addHelpText(
    "after",
    `
Details:
  This command creates a '.git/hooks/pre-push' script in your repository.
  The hook automatically runs 'typequake' against your upstream branch 
  (falling back to HEAD~1) before every push.

Conflict Resolution:
  - If no hook exists, it creates one.
  - If a typequake-managed hook exists, it updates it.
  - If a custom hook exists, it will abort to prevent overwriting your work.

To Uninstall:
  Simply delete '.git/hooks/pre-push' or remove the typequake execution line.
    `,
  )
  .action(async () => {
    await installHook();
  });

program.showHelpAfterError("(run npx typequake --help for usage)");
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
