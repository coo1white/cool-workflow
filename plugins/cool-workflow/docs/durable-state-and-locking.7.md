# Durable State & Locking

CW v0.1.40 fixes the durability gaps its own architecture self-audit found:
every authoritative write is now **atomic**, the audit-essential ones are
**fsync-durable**, and the cross-process read-modify-write stores are
**lock-serialized**. This is the hardening half of Run Retention & Provable
Reclamation (v0.1.39) — the reclamation transaction was already write-ahead, but
the kernel persistence primitive under it (`state.ts:writeJson`) was a
non-atomic in-place `fs.writeFileSync`, the #1 P1 from the last verdict. That is now
fixed for the whole control plane, not just the tombstone.

## Atomic writes — order is the safety property

`writeJson(file, value, { durable? })` writes to a unique temp file and then
`rename(2)`s it over the target. Because rename is atomic on POSIX, a crash,
`SIGKILL`, or `ENOSPC` part-way through a write can never leave a cut-short `state.json` that
throws `Invalid JSON` on reload — a reader always sees **EITHER the old bytes OR
the new bytes**, never a torn file. A failed rename clears away its temp file, so no
half-written artifact is ever left behind.

With `{ durable: true }` the file is also `fsync`'d (and its directory
`fsync`'d as best it can) before the write counts as done, so the bytes
live through power loss. Durability is kept for **authoritative** state — `state.json`
(`saveCheckpoint`), the registry overlays (`archive.json`, `provenance.json`, the
home queue, `repos.json`), the scheduler store, and the reclamation `reclaimed.json`
— while high-frequency, rebuildable derived writes (node bodies, worker manifests,
the registry index) stay atomic-but-not-fsync'd so the cheap torn-write fix is used
everywhere without the fsync cost on the hot path.

## Locking — serialize the cross-process read-modify-write

The home queue (`queueAdd`/`queueDrain`), the archive overlay, the repos registry,
and the per-run reclamation chain are read-modify-write stores changed by more than
one process (the long-running scheduler daemon and the CLI both touch the queue).
`withFileLock(targetPath, fn)` runs `fn` while it holds a portable advisory lock:

- **Portable** — an `O_EXCL` (`wx`) lockfile next to the target; no native `flock(2)`,
  so it works the same way under CI (node/npm/git only).
- **Stale-stealing** — a lock older than the steal window (30 s) is taken back, so a
  crashed holder can never block a store for good.
- **Always released** — the lock is removed in a `finally`, even if `fn` throws.

This makes the scheduling kernel's concurrency ceiling hold **across processes**,
not just within one: a newly-added queue task can no longer go missing under a
concurrent drain, and two reclaimers can no longer lose a tombstone
(freed-without-proof).

## Reclamation durability (the write-ahead seam, v0.1.40)

The v0.1.39 reclamation transaction proved the *tombstone* crash-safe, but the
result-node re-point that scratch reclamation needs lived outside that
boundary. It is now inside it. `runReclamation` runs, in this order:

1. extract + seal skeleton — and **refuse** (`skeleton-incomplete`) not only on a
   missing key but if extraction dropped audit **content** the run truly has
   (a run with commits/evidence must seal them);
2. under the per-run lock: build the tombstone (reads `prevTombstoneHash`) and
   commit it durably — atomic so the chain read-modify-write can never lose a link;
3. `prepareFree()` — re-point living nodes off the scratch, **durably persist**
   `state.json`, and **prove** no living node points to a freed path (and each
   re-pointed node's `loadNodeSnapshot` stays `valid`), failing closed
   (`repoint-incomplete`) if not;
4. only then free the bulk bytes.

A crash at any point now leaves EITHER the full run OR a complete tombstone with a
re-pointed, durably-persisted `state.json` — never a node that points to a freed path,
and never a tombstone whose capability claim is at odds with reality.

## Compatibility

Added on top and unseen by correct single-writer use. No schema change; pre-v0.1.40
runs and stores load unchanged. Atomicity and locking change only HOW the same
bytes are written, never WHAT — no audit, commit, or collaboration record is ever
rewritten.

## See Also

- `docs/run-retention-reclamation.7.md` — the v0.1.39 reclamation transaction this makes harder.
- `docs/run-registry-control-plane.7.md` — the registry overlays + home queue now locked.
- `docs/control-plane-scheduling.7.md` — the concurrency ceiling now held across processes.

## Self-Audit Hardening & Pure-Router Decomposition (v0.1.41)

evidence grounding + durable audit append + symlink-hardened containment + deterministic worker ids + recursive redaction; BackendRegistry self-describing drivers (no per-id switches); orchestrator god-object decomposed into per-domain operation modules (pure loadRun->delegate router)

## Robust Result Ingest (v0.1.42)

capture findings/evidence from any sensible agent shape (alt keys + prose), CW works out grounded evidence itself, warn on empty capture — fixes the v0.1.41 live-drive 'accepted with 0 captured' failure

## No-False-Green Gate & Launch Prep (v0.1.43)

Hard gate blocking empty-capture verifier-gated commits, plus quickstart and launch-prep docs.

## Release-Gate Determinism & Agents Vendor (v0.1.44)

Release-readiness checks now validate the committed blob (`git show HEAD:<path>`) instead of the changeable working tree — getting rid of false-red/false-green from concurrent working-tree writes (iCloud/Spotlight/editor). Adds the `agents` vendor manifest target: a generated `.agents/plugins/cool-workflow/` adapter that gives any non-Claude AI agent one common interface to CW.

## P1-P2 Fixes & CI Content Surfaces (v0.1.49)

Migration DAG with reversible edges (v0.1.45), capability auto-discovery (v0.1.46), vendor-adapter registry (v0.1.47), state auto-compaction and P2 fixes (v0.1.48), plus CI content-surface determinism hardening (v0.1.49).
0.1.51

0.1.76

0.1.77

0.1.78

0.1.79

## Fast Architecture Review (v0.1.80)

Adds the opt-in fast architecture-review lane: scoped JSONL source contexts, diff-aware exports, reusable Map and Assess results, wrapper metrics you can measure, a background full-review handoff you can act on, and userland model policy flags for routing fast/strong workers without changing the full review contract.

## Deterministic Tombstone Hash (v0.1.81)

The reclamation tombstone's freed-manifest is now path-sorted before it feeds `tombstoneHash`, so the same freed set always gives the same hash no matter the filesystem enumeration order. This takes a non-determinism out of the write-ahead chain (v0.1.39/v0.1.40), keeping the per-run tombstone hash-chain replayable and steady across hosts. Atomicity, locking, and the durable re-point seam are unchanged. v0.1.81 also adds import-time refusal (`CW_REQUIRE_ARCHIVE_INTEGRITY=1`) and restore-time trust-audit re-proving — see run-registry-control-plane(7).
_No changes in v0.1.82._

## Hardening and Onboarding (v0.1.83)

Loaders fail closed on corrupt state; store writes are made safe under more than one writer; a new cw doctor checks your setup; help lists every command; and the docs are put into Basic English.

## Privacy Release (v0.1.84)

No other change to this page in v0.1.84.

0.1.85

0.1.86

## 0.1.87 (v0.1.87)

npm test parallel, 4-vendor wrappers (Claude/Codex/Gemini/OpenCode), Homebrew-style CLI UX (colors/did-you-mean/categorized help/error tips/cw info/cw search/cw man/doctor --fix), post-success summaries, agent execution timing

## 0.1.88 (v0.1.88)

_No behavioral change in v0.1.88 (atomic writes, fsync-durability for audit-essential state, and lock-serialized cross-process stores are unchanged; the in-place `appendRunNode` optimization keeps `writeRunNode` and the persisted bytes identical)._
