import { chmodSync, writeFileSync } from "fs";
import { join } from "path";

export async function installHook() {
  const hookPath = join(process.cwd(), ".git/hooks/pre-commit");

  const script = `#!/bin/sh
  typequake $(git rev-parse --abbrev-ref HEAD@{upstream})`;

  writeFileSync(hookPath, script, { encoding: "utf-8" });
  chmodSync(hookPath, 0o755);

  console.log("Pre-commit hook installed successfully.");
}
