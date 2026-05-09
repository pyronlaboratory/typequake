# Changelog

All notable changes to typequake will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
typequake adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.1] - 2025-05-09

Maintenance Release

### Added

- README with full project documentation.

## [1.0.0] — 2025-05-09

Initial public release.

### Added

#### Core analysis pipeline

- **Type surface extraction** via the TypeScript compiler API. Captures every exported symbol (interfaces, type aliases, classes, enums, functions, and variables) from a package's entry point, including properties, optional flags, call signatures, and type strings.
- **Semantic diff engine** with five mutation classes:
  - `BREAKING`: Indicates an incompatible API change, such as adding or removing a required property, converting an optional property to required, or modifying a function signature in a way that changes its required parameters.
  - `REMOVED`: Indicates that an exported symbol has been removed entirely.
  - `NARROWING`: Indicates that a type has become more restrictive, such as removing members from a union type or making previously optional fields required.
  - `WIDENING`: Indicates that a type has become less restrictive, such as adding members to a union type or making required fields optional.
  - `ADDITIVE`: Indicates a non-breaking extension to the public API, such as introducing a new export or adding optional properties.
- **Workspace-aware dependency graph** built from each package's `dependencies` and `devDependencies`. Supports transitive traversal so changes in a shared utility package surface impact in every downstream consumer.
- **Import site resolution** using the TypeScript compiler. Locates every `import` / `export` statement (named, namespace, type-only, re-exports, wildcard re-exports) that references a mutated symbol, recording the file path, line, column, local alias, and usage count.

#### Workspace manager support

- **pnpm**: Resolves workspace topology via `pnpm-workspace.yaml`.
- **Bun**: Extracts workspace configurations from `bun.lockb`, `bun.lock`, or the `package.json` workspaces field.
- **Yarn**: Parses `yarn.lock` and the `package.json` workspaces field for dependency resolution.
- **npm** / **generic**: Utilizes the standard `package.json` workspaces field.
- Custom glob patterns: Supports patterns like `packages/*`, `apps/**`, or `libs/react-*` through a native recursive glob walker, eliminating external dependencies.

#### CLI

- `typequake <base-ref>`: Primary analysis command that accepts any git ref, including branch names, tags, relative refs (`HEAD~1`), or full SHAs.
- `typequake install-hook`: Installs a `pre-push` git hook. Safely aborts to avoid overwriting existing hooks not managed by typequake.
- `--json`: Emits structured JSON output to stdout using schema `version: 1`.
- `--ci`: Returns exit code `1` upon detecting `BREAKING` mutations. Automatically activates if the `CI` environment variable is set to `true`.
- `--no-cache`: Forces a fresh analysis by bypassing the local disk cache.
- `--verbose`: Streams pipeline logs to stderr, covering changed packages, diff statuses, and report counts.
- `--timing`: Displays a performance metrics table (extraction, diff, traversal, total) on stderr post-run.
- `-v, --version`: Displays the current installed version.

#### Output

- **Terminal renderer** built with [Ink](https://github.com/vadimdemedes/ink). Reports grouped by consumer package, then by mutation class. Features include color-coded severity and OSC 8 clickable file links in supported terminals.
- **JSON renderer** using stable, deterministic key ordering for reliable snapshot tests and `git diff`.
- **GitHub Actions annotations** enabled via `GITHUB_ACTIONS=true` environment variable. Emits `::error` annotations for `BREAKING` mutations and `::warning` annotations for all others, linking directly to the affected file and line.

#### Caching

- Disk cache stored under `.typequake/cache/` at the repository root.
- Cache key derived from the git SHA and a hash of the package's `tsconfig.json` content, ensuring stale entries are never served after compiler config changes.
- Cache is skipped entirely for packages with a dirty working tree (no stable SHA to key against).

#### Performance

- `PerformanceTracker` utility wraps synchronous and async pipeline stages, accumulating time per metric name (`extraction`, `diff`, `traversal`, `total`).
- TypeScript `ts.Program` instances are cached per entry point within a run to avoid redundant parsing across multiple consumer packages.

[1.0.1]: https://github.com/pyronlaboratory/typequake/releases/tag/v1.0.1
[1.0.0]: https://github.com/pyronlaboratory/typequake/releases/tag/v1.0.0
