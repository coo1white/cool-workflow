# One durable write per group: audit appends on the serial drive path

Intent, spec and plan in ONE file, in the shape `AGENTS.md` "Intent
files (the playbook)" asks for, in the AI-native SDLC playbook's order
(intent -> spec -> plan -> build -> test -> review -> maintain). Source:
the operator, 2026-09-26, "approve" on the next goal named at the close
of the state-reads program (`intent/2026-09-archive.md`, the state-reads
part): the trust-audit append cost, measured first.

## Part 1 — Intent

**Problem.** Every worker step writes 7 trust-audit events. On the
serial drive path (the default: one task a round) each event takes the
audit lock, appends one line with its own fsync, and rewrites the tail
cache, so a worker pays for 7 locked durable writes. The concurrent path
already groups the same events with `withTrustAuditBatch`: one lock and
one durable write per group, with the same bytes on disk.

**Outcome.** The serial path uses the same batch for the same two groups
(dispatch and accept). The event log, its hash chain and every run file
stay byte-identical; fewer fsyncs, less CW time.

**Who it touches.** Every `cw -q`, `cw run <app> --drive` and resume
user. Code: `src/shell/trust-audit.ts` (`withTrustAuditBatch`),
`src/shell/drive.ts` (`processSelectedTask`), `dist/`, tests, the
ratchet ceilings.

**North Star.** Track A (CW's part of the wait) and Track B (the audit
chain stays whole across a crash).

## Measured facts (checked by command before design)

On `main` at `2ca747b`, Linux, Node 22, built `dist/`, the perf fan app
(N workers in one serial phase, a stub agent that writes its result at
once). fs time is split by a `--require` hook that times each fs call
whose stack runs through `trust-audit.js`, grouped by entry point.

- Events per worker: 7, in three groups. Dispatch (inside
  `createDispatchManifest`): `worker.sandbox-profile`, `worker.backend`,
  `worker.sandbox-boundary`, `sandbox.path`. Accept (inside
  `recordWorkerOutput`): `worker.output`, `worker.agent-delegation`.
  After the accept checkpoint (`drive.ts`): `worker.agent-env`.
- At N=64: 448 events, 448 durable appends (448 fsyncs), 448 lock
  cycles (temp file, link, read back, unlink) and 448 tail-cache
  rewrites (a rename each): 406 ms of fs time in `recordTrustAuditEvent`.
  At N=16: 90 ms. Linear in N; about 0.9 ms an event.
- An earlier estimate (0.79 s at N=64, in the state-reads close) grouped
  by "trust-audit anywhere in the stack" and so also counted other work
  run inside audit calls; 406 ms is the audit's own fs time.
- `withTrustAuditBatch` (`src/shell/trust-audit.ts`) is used only by the
  concurrent round (`driveConcurrentRound`: the dispatch batch and the
  settlement). The serial path never calls it.
- `withTrustAuditBatch` flushes only when its body returns. Some bodies
  record and then throw: `recordWorkerOutput` records a denied
  `sandbox.path` and a `worker.failure` and then throws on a sandbox
  violation, and records `worker.failure` then throws when attested
  telemetry is required and missing (`src/shell/worker-isolation.ts`).
  Inside today's batch those events would be dropped; one-at-a-time
  appends keep them.
- Prototype (a temporary patch of `dist/`, not committed): the serial
  dispatch and accept groups wrapped in `withTrustAuditBatch`. Perf-trace
  durable writes at N=64 went from 647 to 391 (4 fewer flushes a
  worker); the pinned fan-app run folder, `audit/events.jsonl` included,
  is byte-identical to main (0 of 128 files differ); CW self time over 7
  alternating pairs: N=64 2464 -> 2180 ms (-11.5%), N=16 578 -> 486 ms
  (-16%).
- md count: 134/135 before this file; this file makes 135.

## Paths weighed (complexity / upkeep / cost / can it be undone)

- **Drop the per-event fsync** (write now, fsync later or on a timer):
  turned down. The audit log is the product's evidence; a crash could
  lose events for work already accepted into state.
- **Hold one audit lock and batch across the whole drive:** turned down.
  The batch would cover the agent wait; `withTrustAuditBatch` says in
  its own comment it never does, since the lock would block every other
  writer for minutes and the 30 s stale-lock rule would let one steal it.
- **Skip the tail-cache rewrite:** small (the renames are about 25 ms at
  N=64), and the cache is what keeps each append O(1). Not worth it.
- **Chosen:** the serial path batches the same two groups the concurrent
  path does, and the batch flushes on the way out whether its body
  returned or threw, so the lines on disk are the ones one-at-a-time
  appends would have written. Two small diffs, easy to undo.

## Part 2 — Spec

### Journey and target

| Id | Journey | Now | Target |
|---|---|---|---|
| J4 | Drive step: `cw -q` / `cw run <app> --drive` / resume | 7 audit flushes a worker; `drive.fsyncs` 238, `drive.renames` 430 at N=16 | 3 flushes a worker; `drive.fsyncs` and `drive.renames` 64 lower at N=16; CW self at N=64 at least 8% lower, paired |

### Rules

- Byte-identical on a clean run: `audit/events.jsonl`, the tail cache,
  every run file and stderr are the same as on `main` (the pinned fan
  app and `architecture-review`).
- On a throw inside a batch, the events recorded before the throw are
  written (one durable write) before the error goes on; if that write
  itself fails, the first error is the one thrown.
- A batch never covers an agent spawn or wait: the dispatch group is
  `createDispatchManifest` alone, and the accept group is
  `recordWorkerOutput` plus `maybeExpandLoop`, both synchronous. Each
  batch flushes before the checkpoint that follows it, as on the
  concurrent path.
- What does change, and only after a crash: a crash inside a group
  today can leave the group's first events on disk with no checkpoint
  for them; after this change it leaves none of them. The audit log and
  `state.json` then stop at the same step. The concurrent path has
  behaved this way since it was batched. The operator's approval of
  this plan is the approval of this one change.
- The ratchet: `drive.fsyncs` and `drive.renames` go down with their
  ceilings in the same diff; no other count moves.

## Part 3 — Plan (one PR each, in this order)

### PR 1 — The batch flushes on a throw too (runtime)

Files: `src/shell/trust-audit.ts`, `dist/`, a unit test under
`test/shell/`.

1. `withTrustAuditBatch` flushes the recorded lines when its body
   throws, then rethrows; a failed flush after a throw does not hide
   the first error.
2. Test: a body that records two events and throws leaves both on disk,
   chained exactly as two one-at-a-time appends would be (same ids,
   same hashes, `verifyTrustAudit` ok); a body that returns is as
   before. Fails on `main` (the two events are dropped).
3. No count changes: no counted journey throws inside a batch.

### PR 2 — The serial path batches its dispatch and accept groups (runtime)

Files: `src/shell/drive.ts`, `dist/`, a test, the ceilings.

1. In `processSelectedTask`: `createDispatchManifest` runs inside
   `withTrustAuditBatch`, and so do `recordWorkerOutput` and
   `maybeExpandLoop` on the agent path and the result-cache path. The
   commit and checkpoint stay after the batch, where they are.
2. Tests: a serial drive writes 3 audit flushes a worker (counted, the
   way the ratchet counts fsyncs); a sandbox-denied result on the
   serial path still records `sandbox.path` (denied) and
   `worker.failure`; pinned drives byte-identical to `main`.
3. Expected: `drive.fsyncs` 238 -> 174, `drive.renames` 430 -> 366 at
   N=16; CW self at N=64 about -10%.

### PR 3 — Closing ledger (docs)

1. A receipt at `project/docs/audits/audit-batches-receipt-<date>.json`.
2. Fill the sections below and the status ledger; move this file into
   `intent/2026-09-archive.md`.
3. Leading measures: time from this intent to its first build PR, and
   first-pass CI of the program's PRs.

## Rules for every PR in this program

- One goal per PR. Counts go down, never up. No output, JSON, exit
  code, file layout or record change on a clean run; the crash-only
  change above is the one named exception.
- Local checks before every push: build, `dist:check` (after any probe
  in `dist/`, delete `.cache/tsconfig.tsbuildinfo` first), unit tests,
  the full smoke gate, `release:check --skip-tests`, the v2 conformance
  suite, `perf-counts --check`.
- Frozen surfaces are not touched (`trust-audit.ts`, `drive.ts` and
  `worker-isolation.ts` are not on the list).

## Acceptance

- Manager (per PR): CI green, counts at or below the ceilings,
  byte-identical diff clean, body complete.
- Architect (program): 3 audit flushes a worker on the serial path;
  `drive.fsyncs` 174 and `drive.renames` 366 at N=16; CW self at N=64
  at least 8% lower than `main` at `2ca747b`, over 9 alternating pairs;
  every clean-run file byte-identical.

## Architecture snapshot diff (claims this program makes stale)

(Filled by the closing PR.)

## What this spec got wrong (recorded at close)

(Filled by the closing PR.)

## Status ledger

| Item | State | PR |
|---|---|---|
| Intent + spec + plan (this file) | open | |
| PR 1 — the batch flushes on a throw too | | |
| PR 2 — the serial path batches its groups | | |
| PR 3 — closing ledger | | |
