# Run Retention & Provable Reclamation

CW v0.1.39 adds Run Retention & Provable Reclamation: a tiered, append-only,
cryptographically-verifiable way to **free disk WITHOUT violating the audit/replay
moat**. A single day of dogfooding produced ~1 GB across 200+ runs under
`.cw/runs/`, and before v0.1.39 there was **zero disk reclamation** — `run archive`
only marked an overlay (it never freed bytes), `sched reclaim` reclaimed expired
leases (not disk), and worker scratch dirs were never cleaned. Naive GC is
forbidden: CW's entire value is "don't trust, verify." So reclamation is a
**verifiable, append-only state transition** — freeing bytes leaves behind
cryptographic proof that what was freed is reconstructable-or-worthless and that
the audit-essential subset is sealed.

This release builds directly on a precise lineage: v0.1.28's archive overlay
(`run-registry.ts` — "Archive is an overlay mark, not a delete"), v0.1.35's
per-node snapshot/diff/deterministic replay (`node-snapshot.ts`), v0.1.32's
append-only collaboration log, and v0.1.37's policy-as-data scheduling. It EXTENDS
them; it forks nothing.

## The lifecycle tiers

```
live      full on disk              re-runnable + verifiable
archived  overlay mark, full bytes  re-runnable + verifiable   (v0.1.28 ceiling)
reclaimed tombstone + skeleton + digests  verify-only (or re-runnable-by-reconstruction)  (v0.1.39 ceiling)
```

`archived` keeps its mark-only semantics, untouched. `reclaimed` is the NEW
disk-freeing tier above it. The lifecycle ceiling for this release is `reclaimed`;
a future `forgotten` compliance tier (discarding even the skeleton, keeping only
the chained tombstone hash) is out of scope — the `RunLifecycleState` union gains
ONLY `reclaimed`, and the hash chain is designed to extend to it later.

## The red line — never delete what is audit-essential AND irreproducible

A byte is freeable ONLY if it is one of two classes:

1. **reconstructable** — deterministically re-derivable from RETAINED inputs + a
   recorded recipe + an `expectDigest`, or
2. **pure scratch** — zero audit value,

AND it is **referenced by no surviving evidence locator or audit/collaboration
event.** Any path that is neither class defaults to **RETAINED** (fail closed).
The hard ALLOW-LIST — never freed under any policy — is `state.json`, `audit/`,
`commits/`, the collaboration log, the attestation chain, `report.md`, and the new
`reclaimed.json` overlay.

The **skeleton** is the machine-checkable contract for what must survive every
reclamation (`SKELETON_REQUIRED_KEYS` + `validateSkeleton()`): the final verdict,
every commit record, every evidence locator's content digest, the attestation
chain, the cost record, and the append-only audit + collaboration logs. If a
complete skeleton cannot be extracted, reclamation **refuses with
`skeleton-incomplete` and frees zero bytes.**

## Write-ahead, fail-closed sequencing — order is the safety property

The reclamation transaction is four discrete, individually-callable steps:

1. `extractSkeleton()` — extract + seal the audit-essential subset.
2. `buildTombstone()` — write the full freed-manifest with a **pre-deletion
   sha256 per path**, plus the hash chain.
3. `commitTombstone()` — **fsync** the tombstone into the append-only
   `reclaimed.json` overlay (temp → fsync → rename), and record the attestation
   through the existing append-only trust-audit log.
4. `freeBulk()` — ONLY THEN free the bulk bytes.

A crash between any steps leaves **EITHER the full run OR a complete tombstone —
never a half-deleted run with no proof.** This is testable by design:
`runReclamation(run, policy, { faultAfter })` throws a synthetic `ReclamationAbort`
after the named step (`skeleton` | `tombstone-write` | `tombstone-commit`) — never
by killing the process.

## Append-only — reclamation EXTENDS history, never rewrites it

The tombstone is a NEW `reclaimed.json` overlay (a peer of `archive.json`'s role).
Only the bulk DATA bytes are freed — no existing audit, state, or commit record is
ever rewritten. It is itself a new audit record, **hash-chained**: `tombstoneHash`
is recomputed from the freed-manifest + sealed skeleton + `prevTombstoneHash`
(genesis = sha256 of the sealed skeleton). `gc verify` recomputes `tombstoneHash`
**independently**, never trusting the stored value, so a tampered registry entry
is caught — flipping a per-path sha256 fails with `tombstone-digest-mismatch`;
editing a hash link fails with `tombstone-chain-broken`.

## Capability downgrade is explicit and queryable — never silent

Reclaiming a node snapshot downgrades a run from `re-runnable` to `verify-only`,
or to `re-runnable-by-reconstruction` when the snapshot's inputs + `expectDigest`
are retained. `cw run show <id>` reports `record.tier`, `record.capability`, and an
enumerable `record.capabilityReason` (a closed set, e.g.
`snapshot-reclaimed-no-reconstruction` | `inputs-and-expectdigest-retained` |
`scratch-only-reclaimed`) — never free-text prose.

**Reconstruction is a distinct code path, NOT live `verifyNodeReplay`.** A reclaimed
artifact making `loadNodeSnapshot` return `absent` is the EXPECTED fail-closed
signal. The reconstruction verifier re-runs the recorded recipe against the
RETAINED inputs (keyed on the retained-inputs digest) and compares the result's
sha256 to the tombstoned `expectDigest` — it never routes through the freed source
bytes. Flipping one retained input byte fails with `reconstruction-digest-mismatch`.

## The eager-scratch exception

Worker scratch is the one class reclaimed eagerly. A worker's scratch dir is pure
scratch with zero audit value, and its `result.md` is already copied to
`results/<task-id>.md` and evidence-gated. Before the scratch is freed, the result
node's `worker-result` artifact (set by `recordWorkerOutput` to a path INSIDE the
scratch dir) is **re-pointed** to the retained `results/<task-id>.md` copy, and the
result-node snapshot is proven to stay `valid` (not `absent`) — so no surviving
node references a freed path. Opt out with `--keep-scratch`.

## CLI

```
cw gc plan   [run-id] [--reclaimAfterArchiveDays N] [--keep-scratch] [--keep-snapshots] [--scope repo|home] [--json]
cw gc run    [run-id] [--reclaimAfterArchiveDays N] [--keep-scratch] [--keep-snapshots] [--limit N] [--actor NAME] [--json]
cw gc verify <run-id> [--scope repo|home] [--json]
```

- `gc plan` is a pure **dry-run**: it computes eligible runs, the exact bytes that
  WOULD be freed per kind, and the per-run capability downgrade. It frees nothing
  (`plan.bytesToFree` equals the summed per-path sizes it lists).
- `gc run` executes the write-ahead transaction for eligible runs, bounded by
  `maxReclaimRuns` / `maxReclaimBytes`, fail-closed on any incomplete skeleton.
- `gc verify` re-proves a reclaimed run end-to-end.

Eligibility is explicit and fail-closed: a run is reclaimable exactly when its
**derived lifecycle is `completed` or `failed` AND it is archived AND it has no
open feedback AND it is past `reclaimAfterArchiveDays`.** `running` / `blocked` /
`queued` runs are NEVER reclaimable; the check reads live source state and fails
closed (`non-terminal` | `not-archived` | `within-retention` | `open-feedback` |
`unreadable` | `already-reclaimed`). **CW never reclaims by default** — every
reclamation knob defaults to reclaim nothing, and `gc run` is an explicit operator
action, never a daemon.

## MCP

`cw_gc_plan`, `cw_gc_run`, and `cw_gc_verify` are the peers of the CLI verbs,
registered in the capability registry and validated by `parity:check` (fail-closed
on drift). The read-only `gc plan` / `gc verify` payloads obey the now-derived-field
rule: only ISO timestamps may be now-derived.

## Policy-as-data

Retention/reclamation thresholds extend `RunRegistryPolicy` (alongside
`archiveOlderThanDays`), never a new policy file: `reclaimAfterArchiveDays`,
`keepSnapshots`, `keepScratch`, `reclaimStates`, `maxReclaimRuns`, `maxReclaimBytes`.
Back-compatible defaults reclaim nothing; pre-v0.1.39 runs load unchanged.

## Compatibility

Additive. The kernel `state.json` schema is unchanged beyond the new per-run
`reclaimed.json` overlay + policy fields; pre-v0.1.39 runs load unchanged. The
`RunLifecycleState` union gains only `reclaimed`. `run archive` keeps its mark-only
semantics. Nothing in the original audit log is ever edited or erased.

## See Also

- `docs/run-registry-control-plane.7.md` — the v0.1.28 archive overlay this extends.
- `docs/node-snapshot-diff-replay.7.md` — the v0.1.35 snapshot engine reconstruction layers beside.
- `docs/control-plane-scheduling.7.md` — the v0.1.37 policy-as-data lineage.
- `docs/team-collaboration.7.md` — the v0.1.32 append-only log sealed in the skeleton.

## Durable State & Locking (v0.1.40)

atomic temp->rename writes + fsync-durability for authoritative stores; portable stale-stealing file lock serializing the cross-process read-modify-write stores

## Self-Audit Hardening & Pure-Router Decomposition (v0.1.41)

evidence grounding + durable audit append + symlink-hardened containment + deterministic worker ids + recursive redaction; BackendRegistry self-describing drivers (no per-id switches); orchestrator god-object decomposed into per-domain operation modules (pure loadRun->delegate router)

## Robust Result Ingest (v0.1.42)

capture findings/evidence from any reasonable agent shape (alt keys + prose), CW derives grounded evidence itself, warn on empty capture — closes the v0.1.41 live-drive 'accepted with 0 captured' failure

## No-False-Green Gate & Launch Prep (v0.1.43)

Hard gate blocking empty-capture verifier-gated commits, plus quickstart and launch-prep docs.

## Release-Gate Determinism & Agents Vendor (v0.1.44)

Release-readiness checks now validate the committed blob (`git show HEAD:<path>`) instead of the mutable working tree — eliminating false-red/false-green from concurrent working-tree writes (iCloud/Spotlight/editor). Adds the `agents` vendor manifest target: a generated `.agents/plugins/cool-workflow/` adapter giving any non-Claude AI agent one common interface to CW.

## P1-P2 Fixes & CI Content Surfaces (v0.1.49)

Migration DAG with reversible edges (v0.1.45), capability auto-discovery (v0.1.46), vendor-adapter registry (v0.1.47), state auto-compaction and P2 fixes (v0.1.48), plus CI content-surface determinism hardening (v0.1.49).
0.1.51

0.1.76

0.1.77

0.1.78
