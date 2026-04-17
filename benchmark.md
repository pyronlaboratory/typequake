# Performance Benchmark

This document describes the runtime performance validation for TypeQuake.

---

## Acceptance Target

| Metric            | Target                       |
| ----------------- | ---------------------------- |
| Workspace size    | ~20 packages                 |
| Packages changed  | 1 (`@benchmark/shared-core`) |
| Cold-run budget   | **< 10 000 ms**              |
| Cached-run budget | < 5 000 ms                   |

---

## Fixture

The 20-package monorepo lives at `tests/fixtures/benchmark/`.

```
benchmark/
├── packages/
│   ├── shared-core           ← the package that is "changed" in the benchmark
│   │                           (BREAKING: removes User.createdAt, narrows role union)
│   │
│   ├── feature-auth          ┐
│   ├── feature-users         │  direct consumers of shared-core (6 packages)
│   ├── feature-billing       │
│   ├── feature-notifications │
│   ├── feature-analytics     │
│   ├── feature-search        ┘
│   │
│   ├── utils-array           ┐
│   ├── utils-string          │  independent utility packages (4 packages)
│   ├── utils-object          │
│   ├── utils-date            ┘
│   │
│   ├── service-api           ┐
│   ├── service-data          │  service layer – consume feature + utils (4 packages)
│   ├── service-events        │
│   ├── service-reporting     ┘
│   │
│   ├── app-dashboard         ┐
│   ├── app-admin             │  application layer – top-level consumers (5 packages)
│   ├── app-mobile            │
│   ├── app-cli               │
│   └── app-webhook           ┘
└── package.json              ← bun workspaces root
```

**Dependency graph summary**

```
shared-core ──► feature-* (×6)
                    │
                    ▼
utils-*    ──► service-* (×4)
                    │
                    ▼
              app-*     (×5)
```

The benchmark simulates a **BREAKING** change to `shared-core`:

- `User.createdAt` field removed
- `User.role` union narrowed (`'editor'` dropped)
- `User.avatarUrl` removed (was `@deprecated`)
- New required field `User.updatedAt` added

This exercises the full transitive-impact path through 6 feature packages,
4 service packages, and 5 app packages.

---

## Running the Benchmark

```bash
# Cold run (recommended for validating the budget)
bun run bench

# Equivalent long form
vitest run --config vitest.bench.config.ts

# If you only want to observe timing without the assertion
bun run src/cli.ts analyze HEAD~1 --no-cache --format json
```

The `bench` script is defined in `package.json`:

```json
{
  "scripts": {
    "bench": "vitest run --config vitest.bench.config.ts"
  }
}
```

---

## Documented Results

> Results should be re-recorded whenever the analysis pipeline or fixture
> changes. Update the table below after each intentional architecture change.

| Date       | Machine | Node / Bun | Cold run (ms) | Cached run (ms) | Status        |
| ---------- | ------- | ---------- | ------------- | --------------- | ------------- |
| _baseline_ | —       | —          | —             | —               | ✅ target set |

### How to record a result

```bash
bun run bench 2>&1 | grep -E '(Elapsed|Cached run)'
```

The benchmark prints a summary box to stdout on every run:

```
┌─ Performance Benchmark Result ─────────────────────────────┐
│  Elapsed          :   2341 ms                              │
│  Budget           :  10000 ms                              │
│  Headroom         :   7659 ms                              │
│  Packages scanned :   20                                   │
│  Packages changed :    1                                   │
└────────────────────────────────────────────────────────────┘
  ✓ Cached run: 481 ms
```

---

## What the Benchmark Measures

The test in `tests/benchmarks/runtime-perf.spec.ts` covers the complete
pipeline, wall-clock:

1. **Workspace scanning** – detect bun workspaces, build dependency graph
2. **Git bridge** – identify changed packages against `baseSha`; reconstruct
   "before" snapshots via `git show`
3. **Type surface extraction** – TypeScript compiler API, 20 packages
4. **Semantic diffing** – classify mutations (BREAKING / NARROWING / WIDENING /
   ADDITIVE / REMOVED)
5. **Import resolution** – locate call sites of changed symbols across all
   consumer packages
6. **Impact reporting** – aggregate and format results

The cold run uses `--no-cache` to bypass `.typequake/cache/` and always
exercises the full extraction path. The cached run omits `--no-cache` and
validates the disk-cache speedup.
