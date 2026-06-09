# Durable State & Locking

CW v0.1.40 closes the durability seams its own architecture self-audit found:
every authoritative write is now **atomic**, the audit-essential ones are
**fsync-durable**, and the cross-process read-modify-write stores are
**lock-serialized**. This is the hardening half of Run Retention & Provable
Reclamation (v0.1.39) — the reclamation transaction was already write-ahead, but
the kernel persistence primitive underneath it (`state.ts:writeJson`) was a
non-atomic in-place `fs.writeFileSync`, the prior verdict's #1 P1. That is now
fixed for the whole control plane, not just the tombstone.

## Atomic writes — order is the safety property

`writeJson(file, value, { durable? })` writes to a unique temp file and then
`rename(2)`s it over the target. Because rename is atomic on POSIX, a crash,
`SIGKILL`, or `ENOSPC` mid-write can never leave a truncated `state.json` that
throws `Invalid JSON` on reload — a reader always sees **EITHER the old bytes OR
the new bytes**, never a torn file. A failed rename cleans up its temp file, so no
half-written artifact is ever left behind.

With `{ durable: true }` the file is additionally `fsync`'d (and its directory
best-effort `fsync`'d) before the write is considered complete, so the bytes
survive power loss. Durability is reserved for **authoritative** state — `state.json`
(`saveCheckpoint`), the registry overlays (`archive.json`, `provenance.json`, the
home queue, `repos.json`), the scheduler store, and the reclamation `reclaimed.json`
— while high-frequency, rebuildable derived writes (node bodies, worker manifests,
the registry index) stay atomic-but-not-fsync'd so the cheap torn-write fix applies
everywhere without the fsync cost on the hot path.

## Locking — serialize the cross-process read-modify-write

The home queue (`queueAdd`/`queueDrain`), the archive overlay, the repos registry,
and the per-run reclamation chain are read-modify-write stores mutated by more than
one process (the long-running scheduler daemon and the CLI both touch the queue).
`withFileLock(targetPath, fn)` runs `fn` while holding a portable advisory lock:

- **Portable** — an `O_EXCL` (`wx`) lockfile beside the target; no native `flock(2)`,
  so it works identically under CI (node/npm/git only).
- **Stale-stealing** — a lock older than the steal window (30 s) is reclaimed, so a
  crashed holder can never wedge a store forever.
- **Always released** — the lock is removed in a `finally`, even if `fn` throws.

This makes the scheduling kernel's concurrency ceiling hold **across processes**,
not merely within one: a newly-added queue task can no longer vanish under a
concurrent drain, and two reclaimers can no longer lose a tombstone
(freed-without-proof).

## Reclamation durability (the write-ahead seam, v0.1.40)

The v0.1.39 reclamation transaction proved the *tombstone* crash-safe, but the
result-node re-point that scratch reclamation depends on lived outside that
boundary. It is now inside it. `runReclamation` runs, in order:

1. extract + seal skeleton — and **refuse** (`skeleton-incomplete`) not only on a
   missing key but if extraction dropped audit **content** the run actually has
   (a run with commits/evidence must seal them);
2. under the per-run lock: build the tombstone (reads `prevTombstoneHash`) and
   commit it durably — atomic so the chain read-modify-write can never lose a link;
3. `prepareFree()` — re-point surviving nodes off the scratch, **durably persist**
   `state.json`, and **prove** no surviving node references a freed path (and each
   re-pointed node's `loadNodeSnapshot` stays `valid`), failing closed
   (`repoint-incomplete`) otherwise;
4. only then free the bulk bytes.

A crash at any point now leaves EITHER the full run OR a complete tombstone with a
re-pointed, durably-persisted `state.json` — never a node referencing a freed path,
and never a tombstone whose capability claim diverges from reality.

## Compatibility

Additive and invisible to correct single-writer use. No schema change; pre-v0.1.40
runs and stores load unchanged. Atomicity and locking change only HOW the same
bytes are written, never WHAT — no audit, commit, or collaboration record is ever
rewritten.

## See Also

- `docs/run-retention-reclamation.7.md` — the v0.1.39 reclamation transaction this hardens.
- `docs/run-registry-control-plane.7.md` — the registry overlays + home queue now locked.
- `docs/control-plane-scheduling.7.md` — the concurrency ceiling now held across processes.

## Self-Audit Hardening & Pure-Router Decomposition (v0.1.41)

evidence grounding + durable audit append + symlink-hardened containment + deterministic worker ids + recursive redaction; BackendRegistry self-describing drivers (no per-id switches); orchestrator god-object decomposed into per-domain operation modules (pure loadRun->delegate router)

## Robust Result Ingest (v0.1.42)

capture findings/evidence from any reasonable agent shape (alt keys + prose), CW derives grounded evidence itself, warn on empty capture — closes the v0.1.41 live-drive 'accepted with 0 captured' failure
