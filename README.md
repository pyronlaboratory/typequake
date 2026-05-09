## <img src="./logo.svg" width="250">

![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)
![NPM Version](https://img.shields.io/npm/v/typequake)

**typequake** is a static analysis tool for TypeScript monorepos that traces the downstream impact of type changes to every affected import site across your workspace.

Given a base git ref, it reconstructs historical type signatures, classifies structural mutations by severity, traverses the workspace dependency graph transitively, and resolves every affected import site to its exact file and line position.

```
$ npx typequake HEAD~1

IMPACT REPORT                                                                  ref HEAD~1
─────────────────────────────────────────────────────────────────────────────────────────
📦 @super-goggles/app | 5 mutations

BREAKING  (1)
─────────────────────────────────────────────────────────────────────────────────────────
  User                  required property 'account_id' removed from User
    ↳ packages/app/index.ts:3:3


ADDITIVE  (4)
─────────────────────────────────────────────────────────────────────────────────────────
  Status                new export 'Status' added
    ↳ packages/app/index.ts:2:3

  SETTINGS              new export 'SETTINGS' added
    ↳ packages/app/index.ts:4:3

  getProject            new export 'getProject' added
    ↳ packages/app/index.ts:5:3

  Session               new export 'Session' added
    ↳ packages/app/index.ts:6:3

─────────────────────────────────────────────────────────────────────────────────────────
Summary  1 breaking  4 additive  across 1 package

```

## Contents

- [How it works](#how-it-works)
- [Installation](#installation)
- [Requirements](#requirements)
- [Usage](#usage)
- [Mutation classes](#mutation-classes)
- [CI integration](#ci-integration)
- [Git hook](#git-hook)
- [Options reference](#options-reference)
- [Caching](#caching)
- [Workspace support](#workspace-support)
- [JSON output](#json-output)

## How it works

1. **Package change detection**  
   Runs `git diff --name-only <base-ref>` and maps modified files to their corresponding workspace packages.

2. **Type surface extraction**  
   Uses the TypeScript compiler API to capture exported type surfaces including interfaces, types, classes, enums, and functions from both the base reference and the current working tree.

3. **Mutation analysis**  
   Compares both snapshots and classifies symbol-level changes as `BREAKING`, `REMOVED`, `NARROWING`, `WIDENING`, or `ADDITIVE`.

4. **Dependency graph traversal**  
   Traverses the workspace dependency graph to identify all packages that directly or transitively depend on the modified package.

5. **Import site resolution**  
   Analyzes consumer source files using the TypeScript compiler API to locate imports referencing mutated symbols, capturing metadata such as file path, line, column, local alias, and usage count.

6. **Result generation**  
   Renders results in the terminal or as structured JSON, with optional CI enforcement through non-zero exit codes.

## Installation

```bash
# npm
npm install --save-dev typequake

# pnpm
pnpm add -D typequake

# yarn
yarn add -D typequake

# bun
bun add -d typequake
```

Or install globally:

```bash
npm install -g typequake
```

## Requirements

- **Node.js 22+**
- **TypeScript 5.x**

  > typequake uses your project's own TypeScript installation as a peer dependency, so it always analyses your code with the exact compiler version and configuration you ship with. **No separate typescript install is needed if your project already depends on it.**

- A git monorepo with a supported workspace manager (see [Workspace support](#workspace-support)).

  > Single-package repositories are not supported.

  > typequake relies on git history to reconstruct type surfaces at the base ref and on the workspace graph to trace consumer impact.

## Usage

### Basic comparison

Compare your working tree against any git ref _(a branch name, tag, or commit SHA)_:

```bash
npx typequake main          # branch
npx typequake 351071b       # commit SHA
```

typequake always compares the **current working tree** _(including staged and unstaged changes)_ against the ref you provide, so you see the full impact of everything you are about to push.

### Common workflows

```bash
# Check impact before merging a feature branch
npx typequake staging

# Review what changed in the last commit
npx typequake HEAD~1

# Diff against a tagged release
npx typequake v1.2.0

# Machine-readable output for scripts
npx typequake main --json

# Fail the process if breaking changes are present (for CI)
npx typequake main --ci

# Show detailed pipeline logs alongside timing metrics
npx typequake main --verbose --timing
```

## Mutation classes

typequake classifies every changed export into one of five classes, ordered by severity:

| Class       | Meaning                                                                                                                                                                                                             | Safe to ship?                                          |
| :---------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------- |
| `BREAKING`  | Indicates an incompatible API change, such as adding or removing a required property, converting an optional property to required, or modifying a function signature in a way that changes its required parameters. | Consumers are expected to fail compilation.            |
| `REMOVED`   | Indicates that an exported symbol has been removed entirely.                                                                                                                                                        | Consumers are expected to fail compilation.            |
| `NARROWING` | Indicates that a type has become more restrictive, such as removing members from a union type or making previously optional fields required.                                                                        | May introduce runtime or type-level incompatibilities. |
| `WIDENING`  | Indicates that a type has become less restrictive, such as adding members to a union type or making required fields optional.                                                                                       | Generally backwards-compatible.                        |
| `ADDITIVE`  | Indicates a non-breaking extension to the public API, such as introducing a new export or adding optional properties.                                                                                               | Backwards-compatible.                                  |

Terminal output highlights each mutation class using severity-based colour coding, ranging from red (`BREAKING`) to green (`ADDITIVE`). In CI environments, only `BREAKING` mutations produce a non-zero exit code.

## CI integration

Pass `--ci` to exit with code `1` when any `BREAKING` mutations are detected.

> Non-breaking mutations are reported but do not fail the build.

```bash
npx typequake origin/main --ci
```

typequake also respects the standard `CI` environment variable. When `CI=true` is present, as is common on platforms such as GitHub Actions, CircleCI, and other hosted CI providers, CI mode is enabled automatically even if the `--ci` flag is not explicitly provided.

### GitHub Actions

When running inside GitHub Actions, typequake emits [workflow commands](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands) so breaking changes appear as inline annotations on the pull request diff.

```yaml
# .github/workflows/typecheck.yml
name: Type safety

on:
  pull_request:

jobs:
  typequake:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # full history needed for git diff

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - run: corepack enable pnpm

      - run: pnpm install

      - name: Check for breaking type changes
        run: npx typequake origin/${{ github.base_ref }} --ci --json
```

The `fetch-depth: 0` option is required so the base branch ref is available for `git diff`.

## Git hook

typequake can install a `pre-push` hook that runs automatically every time you push, comparing your branch against its upstream:

```bash
npx typequake install-hook
```

This writes the following script to `.git/hooks/pre-push`:

```sh
#!/bin/sh
# Managed by typequake. Please do not remove this file or header.
npx typequake $(git rev-parse --abbrev-ref HEAD@{upstream} 2>/dev/null || echo "HEAD~1")
```

If a `pre-push` hook already exists and was not installed by typequake, the command will abort and prompt you to resolve the conflict manually. Existing hooks are never overwritten automatically.

To uninstall, delete `.git/hooks/pre-push` or replace it with your own script.

## Options reference

```
Usage: typequake [options] [command] <base-ref>

Semantic analysis of type changes and their downstream impact

Arguments:
  base-ref       Git ref to compare against (branch, tag, or SHA)

Options:
  -v, --version  Output the version number
  --json         Output results in JSON format
  --ci           Exit with non-zero code if breaking changes are detected
  --no-cache     Disable caching of analysis results
  --verbose      Enable verbose logging
  --timing       Log performance timing metrics
  -h, --help     Display help for command

Commands:
  install-hook   Install the pre-push git hook for CI enforcement

Examples:
  $ <runner> typequake main
  $ <runner> typequake HEAD~1 --json
  $ <runner> typequake origin/main --ci
  $ <runner> typequake install-hook

(Note: <runner> can be npx, bunx, or pnpx)
```

`--verbose` and `--timing` are independent flags. `--timing` always prints the performance table when set; `--verbose` always prints pipeline-stage logs when set. You can use either or both.

## Caching

Type extraction is the most expensive part of the pipeline. typequake caches each package's extracted type surface to disk, keyed by the git SHA and a hash of the package's `tsconfig.json`. Subsequent runs against the same ref are nearly instant.

> Cache files are stored under `.typequake/cache/` at the repository root. You should add this directory to `.gitignore`

To bypass the cache for a single run (for example, after changing compiler settings):

```bash
npx typequake main --no-cache
```

The cache is never read from or written to when the working tree is dirty for a given package, since there is no stable SHA to key against.

## Workspace support

typequake automatically detects your workspace manager by looking for well-known files at the repository root, in this order:

| Detected file                       | Workspace type |
| ----------------------------------- | -------------- |
| `pnpm-workspace.yaml`               | pnpm           |
| `bun.lockb` / `bun.lock`            | Bun            |
| `yarn.lock`                         | Yarn           |
| `package.json` (`workspaces` field) | npm / generic  |

Package globs are resolved from the detected configuration. All standard glob patterns (`packages/*`, `apps/**`) are supported.

## JSON output

Pass `--json` to receive a stable, machine-readable payload on stdout. The schema is versioned and safe to use in scripts.

```bash
npx typequake main --json
```

```jsonc
{
  "version": 1,
  "baseRef": "HEAD~1",
  "packages": [
    {
      "name": "@super-goggles/app",
    },
    {
      "name": "@super-goggles/core",
    },
  ],
  "reports": [
    {
      "mutationClass": "ADDITIVE",
      "symbol": "accountId",
      "consumerPackage": "@super-goggles/app",
      "detail": "new export 'accountId' added (package added)",
      "sites": [
        {
          "file": "/local/super-goggles/packages/app/index.ts",
          "line": 5,
          "column": 3,
          "symbol": "accountId",
          "localAlias": null,
          "usageCount": 1,
          "isTypeOnly": false,
          "consumerPackage": "@super-goggles/app",
        },
      ],
    },
  ],
  "summary": {
    "total": 1,
    "breaking": 0,
    "removed": 0,
    "narrowing": 0,
    "widening": 0,
    "additive": 1,
    "packagesAffected": 1,
  },
}
```

`--json` output goes to stdout; `--verbose` and `--timing` logs always go to stderr, so the two can be combined without polluting the JSON stream:

```bash
npx typequake main --json --timing 2>timing.log | jq '.summary'
```

## Support

If you find this project or its underlying library useful, please consider supporting its development and leaving a star if you appreciate the work.

<a href='https://ko-fi.com/F1F1VEXA' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://storage.ko-fi.com/cdn/kofi5.png?v=6' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a>
