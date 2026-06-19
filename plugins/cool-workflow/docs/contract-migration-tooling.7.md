# Contract Migration Tooling

CW v0.1.36 makes schema migration a named, declared part of the system. Before
v0.1.36 migration was done one step at a time and only on run-state:
`RUN_STATE_MIGRATIONS` was an inline step array walked by `migrateRunState`,
with no declared `up`-transform registry, no kept compatibility PROOF, no
round-trip/non-destruction guarantee, and NOTHING covering the workflow-app
schema (an old app schema was turned away flatly, never migrated). v0.1.36 adds
a declared registry, per-edge compatibility proofs, fail-closed reachability,
and a round-trip prover — using again the existing `migrateRunState` transform
(no logic forked).

## The declared registry

`migration list` is the one declared source for "what versions exist and how
to move them forward": one `MigrationContract` per schema (`run-state`,
`workflow-app`), each with `currentVersion`, `minVersion`, and an array of
`MigrationEdge { from, to, description, proof }`. The run-state edges ARE
`RUN_STATE_MIGRATIONS` (the transform is not copied). Each edge carries a
machine-checkable `MigrationCompatibilityProof` — the invariant it keeps
(`addsDefaulted`, `dropsNothing`), as data, not as words.

```text
migration list [--json]
```

## Fail closed on reachability

Before transforming, the chain `detected -> current` is worked out. If a
contract's detected version is below `minVersion`, above `currentVersion`, or
has no chained path, the verdict is `unsupported` with a named reason and NO
write — never a part-way migration that does its best. (An older workflow-app,
for which no edge exists yet, fails closed with an exact reason in place of
being taken in quietly.)

```text
migration check <target> [--contract run-state|workflow-app] [--json]
```

`<target>` is a run id (resolves to `.cw/runs/<id>/state.json`) or a path to a
`state.json` / app manifest. The verdict gives the `status`
(`current|migrated|normalized|unsupported`), the detected/current versions, the
resolved `chain`, the count of changes, and any errors.

## Round-trip / non-destruction proof

```text
migration prove <target> [--contract run-state|workflow-app] [--json]
```

`migration prove` runs the chain and PROVES four properties, putting out a
deterministic, sha256-fingerprinted `MigrationProof`:

- **validatesAtCurrent** — the result validates at `currentVersion`.
- **appendOnly** — every source record/key lives on into the output (recursive);
  nothing is lost.
- **idempotent** — running migration again on the output gives no further change.
- **sourceImmutable** — `sourceHash == resultHash`-of-source: the first
  snapshot is byte-unchanged (`migrateRunState` clones; the source `state.json` is
  never changed).

`pass` is true when all of these are true. An `unsupported` verdict never
transforms and never claims a good proof.

## Append-only proof storage

`migration prove` keeps the `MigrationProof` next to the target under
`migration/<fingerprint>.json` — a NEW file, never writing over `state.json` or
the source manifest. Working it out again from disk gives back the same
fingerprint.

## Surfaces & Compatibility

`migration.list`/`check`/`prove` are declared `surface: "both"`, so
`cw migration <verb> --json` and the `cw_migration_*` MCP tools draw from one
core (`src/contract-migration.ts`). It only adds: the run-state and workflow-app
schema versions and `migrateRunState` are unchanged; the registry declares and
proves over the existing transform. Pre-0.1.36 runs and apps load unchanged.

## See Also

release-and-migration(7), state-explosion-management(7), workflow-app-framework(7),
cli-mcp-parity(7)

## Control-Plane Scheduling (v0.1.37)

priority + concurrency limits + lease lifecycle + retry/backoff + fail-closed park over the v0.1.28 Run Registry queue; policy-as-data, deterministic. See control-plane-scheduling(7) for more.

## Agent Delegation Drive (v0.1.38)

spawn an external agent process per worker, capture result.md + attestation, auto-drive plan->dispatch->fulfill->accept->commit

## Run Retention & Provable Reclamation (v0.1.39)

tiered, append-only, cryptographically-verifiable run reclamation: seal the audit skeleton, free the reconstructable bulk, prove it

## Durable State & Locking (v0.1.40)

atomic temp->rename writes + fsync-durability for authoritative stores; portable stale-stealing file lock serializing the cross-process read-modify-write stores

## Self-Audit Hardening & Pure-Router Decomposition (v0.1.41)

evidence grounding + durable audit append + symlink-hardened containment + deterministic worker ids + recursive redaction; BackendRegistry self-describing drivers (no per-id switches); orchestrator god-object decomposed into per-domain operation modules (pure loadRun->delegate router)

## Robust Result Ingest (v0.1.42)

capture findings/evidence from any agent shape that makes sense (alt keys + prose), CW works out grounded evidence itself, give a warning on empty capture — closes the v0.1.41 live-drive 'accepted with 0 captured' failure

## No-False-Green Gate & Launch Prep (v0.1.43)

Hard gate stopping empty-capture verifier-gated commits, plus quickstart and launch-prep docs.

## Release-Gate Determinism & Agents Vendor (v0.1.44)

Release-readiness checks now validate the committed blob (`git show HEAD:<path>`) in place of the changeable working tree — getting rid of false-red/false-green from working-tree writes at the same time (iCloud/Spotlight/editor). Adds the `agents` vendor manifest target: a generated `.agents/plugins/cool-workflow/` adapter that gives any non-Claude AI agent one common way in to CW.

## P1-P2 Fixes & CI Content Surfaces (v0.1.49)

Migration DAG with reversible edges (v0.1.45), capability auto-discovery (v0.1.46), vendor-adapter registry (v0.1.47), state auto-compaction and P2 fixes (v0.1.48), plus CI content-surface determinism hardening (v0.1.49) on top.
0.1.51

0.1.76

0.1.77

0.1.78

0.1.79

## Fast Architecture Review (v0.1.80)

Adds the opt-in fast architecture-review lane: scoped JSONL source contexts, diff-aware exports, reusable Map and Assess results, wrapper metrics you can measure, a background full-review handoff you can act on, and userland model policy flags for routing fast/strong workers without changing the full review contract.

_No changes to the contract-migration subsystem in v0.1.81._
_No changes in v0.1.82._

## Hardening and Onboarding (v0.1.83)

Loaders fail closed on corrupt state; store writes are made safe under more than one writer; a new cw doctor checks your setup; help lists every command; and the docs are put into Basic English.

## Privacy Release (v0.1.84)

No other change to this page in v0.1.84.

0.1.85

0.1.86
