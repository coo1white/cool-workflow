# Contract Migration Tooling

CW v0.1.36 makes schema migration a first-class, declared subsystem. Before
v0.1.36 migration was ad-hoc and run-state-only: `RUN_STATE_MIGRATIONS` was an
inline step array walked by `migrateRunState`, with no declared `up`-transform
registry, no recorded compatibility PROOF, no round-trip/non-destruction
guarantee, and NOTHING covering the workflow-app schema (an old app schema was
flatly rejected, never migrated). v0.1.36 adds a declared registry, per-edge
compatibility proofs, fail-closed reachability, and a round-trip prover — reusing
the existing `migrateRunState` transform (no logic forked).

## The declared registry

`migration list` is the single declared source for "what versions exist and how
to advance them": one `MigrationContract` per schema (`run-state`,
`workflow-app`), each with `currentVersion`, `minVersion`, and an array of
`MigrationEdge { from, to, description, proof }`. The run-state edges ARE
`RUN_STATE_MIGRATIONS` (the transform is not duplicated). Each edge carries a
mechanically-checkable `MigrationCompatibilityProof` — the invariant it preserves
(`addsDefaulted`, `dropsNothing`), as data, not prose.

```text
migration list [--json]
```

## Fail closed on reachability

Before transforming, the chain `detected -> current` is resolved. If a contract's
detected version is below `minVersion`, above `currentVersion`, or has no chained
path, the verdict is `unsupported` with a named reason and NO write — never a
best-effort partial migration. (An older workflow-app, for which no edge exists
yet, fails closed with a precise reason instead of being silently accepted.)

```text
migration check <target> [--contract run-state|workflow-app] [--json]
```

`<target>` is a run id (resolves to `.cw/runs/<id>/state.json`) or a path to a
`state.json` / app manifest. The verdict reports `status`
(`current|migrated|normalized|unsupported`), the detected/current versions, the
resolved `chain`, the change count, and any errors.

## Round-trip / non-destruction proof

```text
migration prove <target> [--contract run-state|workflow-app] [--json]
```

`migration prove` runs the chain and PROVES four properties, emitting a
deterministic, sha256-fingerprinted `MigrationProof`:

- **validatesAtCurrent** — the result validates at `currentVersion`.
- **appendOnly** — every source record/key survives into the output (recursive);
  nothing is destroyed.
- **idempotent** — re-running migration on the output yields no further change.
- **sourceImmutable** — `sourceHash == resultHash`-of-source: the original
  snapshot is byte-unchanged (`migrateRunState` clones; the source `state.json` is
  never mutated).

`pass` is the conjunction. An `unsupported` verdict never transforms and never
claims a positive proof.

## Append-only proof storage

`migration prove` persists the `MigrationProof` beside the target under
`migration/<fingerprint>.json` — a NEW file, never overwriting `state.json` or the
source manifest. Re-deriving from disk reproduces the same fingerprint.

## Surfaces & Compatibility

`migration.list`/`check`/`prove` are declared `surface: "both"`, so
`cw migration <verb> --json` and the `cw_migration_*` MCP tools render one core
(`src/contract-migration.ts`). Additive: the run-state and workflow-app schema
versions and `migrateRunState` are unchanged; the registry declares and proves
over the existing transform. Pre-0.1.36 runs and apps load unchanged.

## See Also

release-and-migration(7), state-explosion-management(7), workflow-app-sdk(7),
cli-mcp-parity(7)

## Control-Plane Scheduling (v0.1.37)

priority + concurrency limits + lease lifecycle + retry/backoff + fail-closed park over the v0.1.28 Run Registry queue; policy-as-data, deterministic. See control-plane-scheduling(7).
