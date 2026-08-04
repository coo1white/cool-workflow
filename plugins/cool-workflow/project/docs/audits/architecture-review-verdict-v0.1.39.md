<!-- Cool Workflow architecture-review — Run Retention & Provable Reclamation (v0.1.39) -->
<!-- Repo: cool-workflow @ bc1473a | Agent-reported model: claude-opus-4-8[1m] | adversarial self-audit of the v0.1.39 surface -->

# Architecture Verdict — Audit CW's Architecture @ v0.1.39

## Short answer

**Still no P0. The system holds, and the v0.1.39 reclamation feature is well-factored — but it introduces a real durability seam that the rest of the transaction's rigor does not cover.** The happy path is sound and was re-verified live: `gc verify` on a real reclaimed run returns `verified=true`, the hash chain recomputes independently, and the audit allow-list (`state.json`, `audit/`, `commits/`, `reclaimed.json`) is never freed. The write-ahead ordering (seal skeleton → write tombstone with pre-deletion sha256 → **fsync** → free) genuinely makes the *tombstone* crash-safe, and `writeJsonDurable` is the **first atomic durable write in the codebase** — a direct, if scoped, answer to the prior verdict's #1 recommendation. The real v0.1.39 risks cluster in one place: **the result-node re-point that scratch reclamation depends on lives OUTSIDE the write-ahead durability boundary** — it mutates `state.json` in memory and is persisted only *after* the bytes are already gone (or never, for direct callers), so a crash in that window or a primitive misuse leaves a node referencing a freed path with a tombstone that claims capability is unchanged. Three P1s, all real and grounded; everything else P2/P3. The prior top P1 (non-atomic, unlocked `writeJson` for `state.json`/registry/scheduler) is **unaddressed** and now has a sibling on the new `reclaimed.json`.

## What v0.1.39 got right (addressed since the prior verdict)

- **A GC/prune path now exists** (`reclamation.ts` + `gc plan|run|verify`) — the prior P2 "unbounded run-state growth, archive overlay-mark-only, 1.0 GB / 260 runs" has a remedy, dry-run-first and fail-closed.
- **First atomic durable write** — `writeJsonDurable` (temp → `fsync` → `rename` → dir `fsync`, `reclamation.ts:143`) makes the tombstone commit crash-safe. This is exactly the technique the prior verdict's recommendation #1 asked for, applied (so far) only to `reclaimed.json`.
- **Tamper-evident audit** — the hash-chained tombstone (`computeTombstoneHash` recomputed independently by `verifyReclamation`, `reclamation.ts:790`) is a partial answer to recommendation #4. Confirmed: flipping a manifest sha or a chain link is caught with distinct codes.
- **Capability downgrade is explicit and queryable** — `run show` surfaces `tier`/`capability`/`capabilityReason` from a closed enum, not prose.

## Ranked risks (real P1s first)

**P1 — The scratch re-point lives OUTSIDE the write-ahead durability boundary.** `freeBulk` re-points the result node's `worker-result` artifact in memory and then deletes the scratch bytes (`reclamation.ts` `freeBulk`), but the `state.json` write that makes the re-point durable happens *afterward* — `saveCheckpoint(run)` runs only once `runReclamation` returns, in `run-registry.ts:905`. The transaction guarantees the *tombstone* is fsynced before any free, but the *node mutation the free depends on* is not. A crash between `freeBulk` and `saveCheckpoint` leaves: tombstone committed, scratch deleted, and `state.json` still pointing the result node's `worker-result` artifact at the freed scratch path. On reload `loadNodeSnapshot` returns `absent` (a silent replay downgrade) — while the tombstone advertises `capability: re-runnable, scratch-only-reclaimed`, i.e. *unchanged*. The audit record and reality diverge. *Real; the one place the write-ahead invariant has a hole.*

**P1 — `freeBulk` never enforces the spec's "prove the snapshot stays valid BEFORE freeing" precondition.** The design requires proving the result-node snapshot is `valid` (not `absent`) before deleting scratch. `repointResultNodeArtifacts` is best-effort: it re-points only when it finds a sibling `result` artifact whose path still exists, and if it doesn't, it **deletes the scratch anyway** (`freeBulk` loops unconditionally). There is no `loadNodeSnapshot === valid` assertion gating the delete. For today's result nodes a retained `result` artifact always exists, so this is latent — but it is an unchecked invariant, not an enforced one. *Real, latent.*

**P1 — Unlocked cross-process read-modify-write on `reclaimed.json` (inherits the prior queue/scheduler P1).** `commitTombstone` does `loadReclamationLog` → `push` → `writeJsonDurable` with no `flock`/`O_EXCL` (`reclamation.ts:636`), and `buildTombstone` separately re-reads the log for `prevTombstoneHash` (`reclamation.ts:606`) — two unsynchronized reads. Two concurrent `gc run` passes over the same run can both read the same prior chain and last-writer-wins: one tombstone is lost, so bytes freed by the losing pass have **no surviving proof** — a direct violation of the append-only "every freed byte leaves a tombstone" invariant. `writeJsonDurable` made the *write* atomic; it did nothing for the *read-modify-write*. Repo-wide grep confirms **no** locking primitive anywhere. *Real; same class as the original, now on the reclamation path.*

**P1 (inherited, unaddressed) — `state.ts:writeJson` is still non-atomic and unlocked.** The single persistence primitive for `state.json`, the registry overlays, and the scheduler store remains in-place `fs.writeFileSync` (`state.ts` `writeJson`). v0.1.39 hardened only its own tombstone; the prior verdict's #1 P1 stands for every other authoritative write, and `gcRun`'s post-free `saveCheckpoint` rides on exactly this non-atomic primitive — compounding P1-A. *Real, carried forward.*

## P2 / P3

**P2 — `validateSkeleton` is presence-of-keys, not presence-of-content.** `commits: []` and `evidenceDigests: []` satisfy the "complete skeleton" gate (`reclamation.ts` `validateSkeleton`), so a run with zero audit content reclaims with an *empty-but-complete* skeleton, and a future extraction bug that silently drops real commits/evidence would not be caught. This echoes the prior verdict's "evidence gate checks presence not grounding" P1, now on the reclamation seal.

**P2 — Direct-primitive callers must `saveCheckpoint` manually.** `runReclamation` mutates `run.nodes` (the re-point) but never persists it; any caller of the primitive that forgets the follow-up `saveCheckpoint` silently loses the re-point (the smoke remembers; nothing enforces it). The API frees bytes but does not persist the state change those freed bytes require.

**P2 — `bytesFreed` is recorded at build time but re-measured at free time.** `buildTombstone` records `dirBytes` per path; `freeBulk` re-measures at delete and returns that sum. Under a concurrent writer appending to scratch the two diverge — the tombstone's `bytesFreed` and the reported freed total disagree.

**P3 — `dirBytes` follows symlinks (`statSync`) while `rmSync` removes the link, not the target.** A symlinked scratch entry would have its *target* size counted into the freed-manifest while only the link is deleted — overstating freed bytes. Not a normal scratch shape; noted for completeness.

## Non-issues (correctly classed)

- **Hash-chain verification trusts nothing stored** — `gc verify` recomputes `tombstoneHash`/`prevTombstoneHash` independently; confirmed 0 failing checks on the real reclaimed run.
- **Allow-list never freed** — `state.json`, `audit/`, `commits/`, `reclaimed.json` retained; confirmed on disk after a live reclaim.
- **Reconstruction vs. re-point conflict** — correctly avoided by retaining any snapshot whose source node is re-pointed in the same pass (fail-closed).
- **`gc run` reclaiming archived terminal runs with `reclaimAfterArchiveDays=0`** — by design for an explicit operator action; it is not a daemon, and defaults reclaim nothing.

## Recommended changes (in priority order)

1. **Pull the re-point INTO the write-ahead transaction.** Make "re-point result-node artifacts + durably persist `state.json` + assert every re-pointed node's `loadNodeSnapshot === valid`" a committed step BEFORE `freeBulk`, and fail closed if any assertion fails. This retires P1-A and P1-B together.
2. **Lock the `reclaimed.json` read-modify-write** (`flock`/`O_EXCL` or single-writer discipline), and generalize the fix to the queue/scheduler/`state.json` writes — closing P1-C and the carried-forward P1-D in one pass (and most of the prior durability cluster).
3. **Strengthen `validateSkeleton` to content, not just keys** — when the run has commits/evidence, require the skeleton to seal them; always seal the terminal verdict.
4. **Make `runReclamation` persist its own mutation** (`saveCheckpoint` inside the transaction) so the primitive is safe by default, not by caller convention.

## Evidence links

Verified verbatim this session against `bc1473a`: `reclamation.ts` `freeBulk` (re-point + unconditional delete), `run-registry.ts:897-905` (`runReclamation` then `saveCheckpoint` — the crash window), `reclamation.ts:636` (`commitTombstone` unlocked RMW), `reclamation.ts:606` (second unsynchronized log read), `state.ts` `writeJson` (still non-atomic), `grep` for `flock|O_EXCL|lockfile` (none). Live happy-path: `gc verify release-cut-…-4va6p2` → `verified=true, tier=reclaimed, 0 failing checks`.
