import { chmodSync, existsSync, writeFileSync } from "fs";
import { join } from "path";

const HOOK_SCRIPT = `#!/bin/sh
# Installed by typequake — do not edit this line
typequake $(git rev-parse --abbrev-ref HEAD@{upstream} 2>/dev/null || echo "HEAD~1")
`;

const HOOK_MARKER = "# Installed by typequake";

export async function installHook(): Promise<void> {
  const gitDir = join(process.cwd(), ".git");

  if (!existsSync(gitDir)) {
    process.stderr.write(
      "typequake: no .git directory found. Run this command from the root of a git repository.\n",
    );
    process.exit(1);
  }

  const hookPath = join(gitDir, "hooks", "pre-push");

  // Safe overwrite: if a hook exists and was NOT installed by typequake, abort.
  if (existsSync(hookPath)) {
    const { readFileSync } = await import("fs");
    const existing = readFileSync(hookPath, "utf-8");

    if (!existing.includes(HOOK_MARKER)) {
      process.stderr.write(
        `typequake: a pre-push hook already exists at ${hookPath} and was not installed by typequake.\n` +
          `Remove it manually and re-run if you want to replace it.\n`,
      );
      process.exit(1);
    }
  }

  writeFileSync(hookPath, HOOK_SCRIPT, { encoding: "utf-8" });
  chmodSync(hookPath, 0o755);

  process.stdout.write(`typequake: pre-push hook installed at ${hookPath}\n`);
}
