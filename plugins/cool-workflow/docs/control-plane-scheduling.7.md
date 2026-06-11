# Control-Plane Scheduling

CW v0.1.37 adds Control-Plane Scheduling: a scheduling-policy layer over the
v0.1.28 Run Registry queue. Before v0.1.37 the queue had ORDER (priority,
`enqueuedAt`) but no policy — nothing limited how many runs were in flight, nothing
retried a transient failure with backoff, and nothing bounded retries
(`queue drain` would re-hand the same failing entry forever). v0.1.37 layers
policy-as-data over the existing queue (no queue file duplicated): priority +
readiness selection, a hard concurrency ceiling, leases, retry with computed
backoff, and a fail-closed park state. The verbs use a distinct `sched` namespace,
separate from the unrelated wall-clock `schedule` (loop/cron) scheduler.

The core (`src/scheduling.ts`) is pure and deterministic — every function takes an
injected `now`; "CW records readiness/order/leases, the host still executes the
workers."

## Policy as data

`SchedulingPolicy` is a plain, diffable file under `$CW_HOME/registry/
scheduling-policy.json`, defaulting to conservative fail-closed values when
absent: `maxConcurrent 1`, `maxAttempts 3`, `leaseTtlMs 300000`, backoff
`baseMs 1000 * factor 2 ^ (attempts-1)` capped at `60000` (no jitter).

```text
sched policy show [--json]
sched policy set --maxConcurrent N --maxAttempts N --leaseTtlMs N --backoffBaseMs N --backoffFactor N --backoffCapMs N
```

## The lease lifecycle

```text
ready --lease--> leased --complete--> drained
   ^               |  \--release(failed)/expire--> ready (+backoff) | parked
   |__reset________/
```

- **`sched plan`** — READ-ONLY: the would-be lease plan for the current
  queue+policy+now, deterministic and replayable, without mutating. Payload-
  identical across CLI and MCP.
- **`sched lease`** — claim eligible entries (priority order via `compareQueue`,
  skipping anything not yet eligible / parked / leased) as `leased` with a
  `leaseId` and `leaseExpiresAt`. The **concurrency ceiling is a hard limit** —
  leasing stops at `maxConcurrent`; over-limit entries stay `ready`.
- **`sched complete <leaseId>`** — terminal success (`drained`).
- **`sched release <leaseId> [--failed]`** — failed releases count an attempt
  (retry/backoff or park); a clean release returns the entry to `ready`.
- **`sched reclaim`** — an EXPIRED lease (the host died) is reclaimable and counts
  one failed attempt — recorded, not silently reset.
- **`sched reset <id>`** — operator recovery: a parked entry back to `ready`.

## Fail closed

- **Concurrency is a hard ceiling** — never exceeded; `sched plan`/`lease` stop at
  `maxConcurrent` in-flight leases.
- **Park past budget** — when `attempts >= maxAttempts` the entry becomes `parked`
  with a `parkedReason` and is NEVER re-selected. `sched reset` is the only way
  back. The queue can never re-hand a failing entry forever.
- **Backoff is deterministic** — a pure curve, no randomness; a retried entry sets
  `nextEligibleAt` and is skipped until then.

## Compatibility

Additive: `RunQueueEntry` gains optional `attempts`/`leaseId`/`leaseExpiresAt`/
`nextEligibleAt`/`parkedReason` and two statuses (`leased`/`parked`); a pre-0.1.37
`queue.json` loads unchanged (no scheduling fields = a plain ordered queue). The
existing `queue add|list|drain|show` verbs are unchanged. No new database, no
daemon-owned state.

## See Also

run-registry-control-plane(7), cli-mcp-parity(7), release-and-migration(7)

## Agent Delegation Drive (v0.1.38)

spawn an external agent process per worker, capture result.md + attestation, auto-drive plan->dispatch->fulfill->accept->commit

## Run Retention & Provable Reclamation (v0.1.39)

tiered, append-only, cryptographically-verifiable run reclamation: seal the audit skeleton, free the reconstructable bulk, prove it

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
