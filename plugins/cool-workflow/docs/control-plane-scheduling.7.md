# Control-Plane Scheduling

CW v0.1.37 adds Control-Plane Scheduling: a scheduling-policy layer over the
v0.1.28 Run Registry queue. Before v0.1.37 the queue had ORDER (priority,
`enqueuedAt`) but no policy — nothing kept down how many runs were in flight, nothing
tried again after a short-lived failure with backoff, and nothing put a limit on retries
(`queue drain` would hand out the same failing entry again and again, for ever). v0.1.37 puts
policy-as-data over the queue that is already there (no queue file is copied): priority +
readiness selection, a hard concurrency ceiling, leases, retry with worked-out
backoff, and a fail-closed park state. The verbs use their own `sched` namespace,
apart from the unrelated wall-clock `schedule` (loop/cron) scheduler.

The core (`src/scheduling.ts`) is pure and deterministic — every function is given an
injected `now`; "CW writes down readiness/order/leases, the host still runs the
workers."

## Policy as data

`SchedulingPolicy` is a plain, diffable file under `$CW_HOME/registry/
scheduling-policy.json`. When it is not there, it takes safe fail-closed values:
`maxConcurrent 1`, `maxAttempts 3`, `leaseTtlMs 300000`, backoff
`baseMs 1000 * factor 2 ^ (attempts-1)` with a top of `60000` (no jitter).

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

- **`sched plan`** — READ-ONLY: the lease plan that would be used for the current
  queue+policy+now, deterministic and able to be run again, with no changes made. Payload-
  identical across CLI and MCP.
- **`sched lease`** — take eligible entries (priority order via `compareQueue`,
  jumping over anything not yet eligible / parked / leased) as `leased` with a
  `leaseId` and `leaseExpiresAt`. The **concurrency ceiling is a hard limit** —
  leasing stops at `maxConcurrent`; entries over the limit stay `ready`.
- **`sched complete <leaseId>`** — end success (`drained`).
- **`sched release <leaseId> [--failed]`** — failed releases count as an attempt
  (retry/backoff or park); a clean release sends the entry back to `ready`.
- **`sched reclaim`** — an EXPIRED lease (the host died) can be reclaimed and counts
  as one failed attempt — written down, not quietly reset.
- **`sched reset <id>`** — operator recovery: a parked entry back to `ready`.

## Fail closed

- **Concurrency is a hard ceiling** — never gone past; `sched plan`/`lease` stop at
  `maxConcurrent` in-flight leases.
- **Park past budget** — when `attempts >= maxAttempts` the entry becomes `parked`
  with a `parkedReason` and is NEVER picked again. `sched reset` is the only way
  back. The queue can never hand out a failing entry for ever.
- **Backoff is deterministic** — a pure curve, nothing random; a retried entry sets
  `nextEligibleAt` and is jumped over until then.

## Compatibility

Additive: `RunQueueEntry` gets the optional `attempts`/`leaseId`/`leaseExpiresAt`/
`nextEligibleAt`/`parkedReason` and two statuses (`leased`/`parked`); a pre-0.1.37
`queue.json` loads with no change (no scheduling fields = a plain ordered queue). The
`queue add|list|drain|show` verbs that are already there do not change. No new database, no
daemon-owned state.

## See Also

run-registry-control-plane(7), cli-mcp-parity(7), release-and-migration(7)

## Agent Delegation Drive (v0.1.38)

start an outside agent process for each worker, take in result.md + attestation, and drive plan->dispatch->fulfill->accept->commit by itself

## Run Retention & Provable Reclamation (v0.1.39)

tiered, append-only, cryptographically-verifiable run reclamation: shut the audit skeleton, free the bulk that can be built again, give proof of it

## Durable State & Locking (v0.1.40)

atomic temp->rename writes + fsync-durability for the authoritative stores; portable stale-stealing file lock that puts the cross-process read-modify-write stores in order, one at a time

## Self-Audit Hardening & Pure-Router Decomposition (v0.1.41)

evidence grounding + durable audit append + symlink-hardened containment + deterministic worker ids + recursive redaction; BackendRegistry self-describing drivers (no per-id switches); the orchestrator god-object is broken up into per-domain operation modules (pure loadRun->delegate router)

## Robust Result Ingest (v0.1.42)

take in findings/evidence from any reasonable agent shape (alt keys + prose), CW works out grounded evidence by itself, give a warning on empty capture — this shuts the v0.1.41 live-drive 'accepted with 0 captured' failure

## No-False-Green Gate & Launch Prep (v0.1.43)

Hard gate that stops empty-capture verifier-gated commits, plus quickstart and launch-prep docs.

## Release-Gate Determinism & Agents Vendor (v0.1.44)

Release-readiness checks now check the committed blob (`git show HEAD:<path>`) in place of the mutable working tree — taking away false-red/false-green that came from concurrent working-tree writes (iCloud/Spotlight/editor). Adds the `agents` vendor manifest target: a generated `.agents/plugins/cool-workflow/` adapter that gives any non-Claude AI agent one common interface to CW.

## P1-P2 Fixes & CI Content Surfaces (v0.1.49)

Migration DAG with edges that can go both ways (v0.1.45), capability auto-discovery (v0.1.46), vendor-adapter registry (v0.1.47), state auto-compaction and P2 fixes (v0.1.48), plus CI content-surface determinism hardening (v0.1.49).
0.1.51

0.1.76

0.1.77

0.1.78

0.1.79

## Fast Architecture Review (v0.1.80)

Adds the opt-in fast architecture-review lane: scoped JSONL source contexts, diff-aware exports, Map and Assess results that can be used again, wrapper metrics that can be measured, a background full-review handoff you can act on, and userland model policy flags for routing fast/strong workers without changing the full review contract.

_No changes to the control-plane scheduling surface in v0.1.81._
_No change in behavior in v0.1.82 (schedule/run ids are now deterministic-but-unique through a monotonic counter + pid in place of Math.random; ids stay collision-free)._

## Hardening and Onboarding (v0.1.83)

Loaders fail closed on corrupt state; store writes are made safe under more than one writer; a new cw doctor checks your setup; help lists every command; and the docs are put into Basic English.

## Privacy Release (v0.1.84)

No other change to this page in v0.1.84.

0.1.85

0.1.86

## 0.1.87 (v0.1.87)

npm test parallel, 4-vendor wrappers (Claude/Codex/Gemini/OpenCode), Homebrew-style CLI UX (colors/did-you-mean/categorized help/error tips/cw info/cw search/cw man/doctor --fix), post-success summaries, agent execution timing

## 0.1.88 (v0.1.88)

_No behavioral change in v0.1.88 (the `sched` priority/readiness selection, concurrency ceiling, leases, backoff retry, and fail-closed park state are unchanged)._

## 0.1.89 (v0.1.89)

_No behavioral change in v0.1.89 (CLI-surface golden-path + help-output fixes only; this subsystem is unchanged)._

0.1.90

0.1.91

0.1.92
