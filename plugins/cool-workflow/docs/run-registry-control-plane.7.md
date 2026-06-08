# Run Registry / Control Plane

CW v0.1.28 adds the Run Registry / Control Plane: a layer that manages MANY
workflow runs across repositories. Before v0.1.28 a run lived only under its
repo's `.cw/runs/<id>/` and was loaded from the current directory
(`loadRunFromCwd`); there was no cross-repo index and no unified lifecycle
management. This release adds search, resume, archive, a durable queue,
cross-repo history, and failed-run rerun — without changing the run-state schema
and without taking ownership of source truth.

The design follows the same base-system observability philosophy as
[State Explosion Management](state-explosion-management.7.md) and the
[Evidence Adoption Reasoning Chain](evidence-adoption-reasoning-chain.7.md):

- the per-run `.cw/runs/<id>/state.json` is the SINGLE source of truth
- the registry is a DERIVED userland index, never a replacement for source records
- plain files, stable JSON, deterministic output
- small composable commands and readable console views with full
  machine-readable output available
- fail closed when the index is stale, a run's source changed, or its source is
  missing — never fabricate run status from the cache
- append-only history: resume continues a run, rerun creates a NEW linked run,
  and archive marks rather than deletes
- backward compatible; no hidden database; no daemon required to read state

## Mechanism vs policy

The registry is MECHANISM: a rebuildable cache over runs. POLICY — retention
windows, queue ordering, and archive thresholds — is configurable and kept out
of the index (`RunRegistryPolicy`, explicit flags). The index can be deleted and
rebuilt from source at any time; it never holds authority a `state.json` does
not.

## Derived index model

A `RunRecord` is derived per run and carries `schemaVersion`, `runId`, `appId`,
`appVersion`, `workflowId`, `title`, `repo` (the owning repo root), `runDir`,
`statePath`, `createdAt`, `updatedAt`, `loopStage`, a `lifecycle` and a
`derivedLifecycle`, an `archived` flag with `archivedAt`/`archiveReason`, task
counts, `commitCount`, `verifierGatedCommitCount`, `openFeedbackCount`, a bounded
`inputsDigest` for free-text search, a deterministic `sourceFingerprint`, a
per-record `freshness` (`valid`, `stale`, or `missing`), and optional
`provenance`.

A `RunRegistryIndex` aggregates records for a scope (`repo` or `home`) with its
own `sourceFingerprint`, the covered `repos`, the `queue`, and lifecycle
`counts`. A `RunRegistryReport` wraps the index with explicit freshness
(`valid`, `stale`, or `absent`) plus the `staleRuns` and `missingRuns` lists and
a `nextAction`. Every read re-derives records from source; the persisted index is
only compared against, never trusted as the live status.

## Lifecycle state machine

Lifecycle is CLASSIFIED from existing state, never invented. `deriveLifecycle`
applies the following rules to a run's source state — first match wins:

```text
1. running tasks > 0                              -> running
2. open feedback > 0                              -> blocked   (failures under correction)
3. failed tasks > 0                               -> failed
4. tasks > 0 and all tasks completed              -> completed
5. verifier-gated commits > 0 and nothing pending -> completed (commit-only runs)
6. completed tasks > 0                            -> running   (mid-flight)
7. otherwise                                      -> queued
```

`archived` is an OVERLAY disposition applied on top of this. The surfaced
`lifecycle` becomes `archived`, but `derivedLifecycle` preserves the
source-derived state so search and history can still match the underlying run.
The classifier never reads the cache; it reads source `state.json`.

## Cross-repo layout

State is plain files, readable and diffable:

```text
<repo>/.cw/runs/<id>/state.json     source of truth (unchanged, never owned here)
<repo>/.cw/registry/index.json      per-repo derived index (rebuildable)
<repo>/.cw/registry/archive.json    archive overlay (mark; never deletes source)
<repo>/.cw/registry/provenance.json rerun provenance links (derived metadata)

$CW_HOME/registry/repos.json        registered repo roots (explicit discovery set)
$CW_HOME/registry/index.json        cross-repo derived index (rebuildable)
$CW_HOME/registry/queue.json        durable run queue (plain, ordered)
```

The home registry root resolves from `CW_HOME`, then
`XDG_STATE_HOME/cool-workflow`, then `~/.local/state/cool-workflow`. A repo is
registered into `repos.json` when it is refreshed (or when a queue entry names
it). Reads never write: a search or show computes the repo set as the union of
the registered repos and the current repo in memory, so reading the index never
mutates discovery state.

## Search

`run search` queries runs by `--app`, `--status`, time range (`--since`,
`--until`), `--repo`, and free-text (`--text`, matched over runId, app, workflow,
title, repo, lifecycle, loop stage, and a bounded digest of run inputs).
Results are deterministic (ordered by `createdAt`, then `runId`) and paginated
(`--limit`, `--offset`). Search is cross-repo by default (`--scope home`); use
`--scope repo` to restrict to the current repo. Archived runs are included by
default and can be excluded with `--include-archived false`.

## Resume

`run resume <run-id>` resolves a run by id across the registry — not just the
cwd — loads its durable state, and returns the next runnable tasks and next
actions for the host to execute. Resume is read-only over source: it never
mutates `state.json` and never un-archives a run.

## Queue

`queue add` appends a durable entry to `$CW_HOME/registry/queue.json` with an
explicit `--priority` (lower drains first; ties break by enqueue time, then id).
`queue list` prints the queue in policy order; `queue show <id>` shows one entry.
`queue drain [--limit N]` marks the next ready entries drained and returns them —
CW records order and readiness; the HOST still executes the workers. Nothing in
the queue spawns work on its own.

## Archive

`run archive <run-id>` writes an overlay mark to the owning repo's
`registry/archive.json`; the run's `state.json` is never moved or deleted, and
the run stays searchable (its `derivedLifecycle` is preserved). `--unarchive`
clears the mark. Retention is POLICY: `run archive --older-than-days N
[--state completed --state failed]` archives eligible runs older than the window
without touching source truth. The default policy archives nothing
(`archiveOlderThanDays = 0`) until a window is given.

## Rerun

`run rerun <run-id>` re-runs a failed run as a NEW run: it reuses the original
inputs and app, lands the new run beside the original (same repo), and records a
provenance link (`rerunOf`, `rerunOfRepo`, `originRunId`, `generation`, `reason`)
in the repo's `registry/provenance.json`. The original failed run is PRESERVED
for audit — the past is never overwritten. Rerunning a rerun increments
`generation` and keeps `originRunId` pinned to the chain root.

## Cross-repo history

`history` reads a unified timeline of runs across all registered repos
(newest first), each entry carrying its repo, lifecycle, loop stage, timestamps,
freshness, and provenance back to its `.cw/runs/<id>/`. Filter with `--app` and
`--status`; paginate with `--limit` and `--offset`.

## CLI

```text
node scripts/cw.js registry refresh [--scope repo|home] [--json]
node scripts/cw.js registry show [--scope repo|home] [--json]
node scripts/cw.js run search [--app ID] [--status STATE] [--text Q] [--repo PATH] [--since ISO] [--until ISO] [--limit N] [--offset N] [--scope repo|home] [--json]
node scripts/cw.js run list [--scope repo|home] [--json]
node scripts/cw.js run show <run-id> [--scope repo|home] [--json]
node scripts/cw.js run resume <run-id> [--limit N] [--json]
node scripts/cw.js run archive <run-id> [--reason TEXT] [--unarchive]
node scripts/cw.js run archive --older-than-days N [--state completed --state failed]
node scripts/cw.js run rerun <run-id> [--reason TEXT]
node scripts/cw.js queue add [--app ID|--workflow ID|--runId ID] [--repo PATH] [--priority N] [--note TEXT]
node scripts/cw.js queue list [--status STATE] [--repo PATH] [--json]
node scripts/cw.js queue show <queue-id>
node scripts/cw.js queue drain [--limit N] [--repo PATH]
node scripts/cw.js history [--app ID] [--status STATE] [--limit N] [--offset N] [--scope repo|home] [--json]
```

Read commands print terse human panels by default (lifecycle, freshness, counts,
and next action) and full machine output under `--json` or `--format json`.

## MCP parity

Every command above is declared once in the v0.1.28 capability registry
(`src/capability-registry.ts`) and rendered on both surfaces, so `cw <cmd>
--json` is schema-identical to the matching `cw_<tool>` result and the pair
passes `npm run parity:check`:

- `cw_registry_refresh`, `cw_registry_show`
- `cw_run_search`, `cw_run_list`, `cw_run_show`, `cw_run_resume`,
  `cw_run_archive`, `cw_run_rerun`
- `cw_queue_add`, `cw_queue_list`, `cw_queue_drain`, `cw_queue_show`
- `cw_history`

See [cli-mcp-parity.7.md](cli-mcp-parity.7.md).

## Freshness and fail-closed behavior

`registry show` recomputes the current source fingerprint for every run and
compares it to the persisted index. If a run's source changed, the report status
is `stale` and the run is named in `staleRuns`. If a persisted run's source is
gone, the run is named in `missingRuns`, it is NOT fabricated into the current
records, and the next action is `registry refresh`. `run show` of a run whose
source is missing returns `found: false` with `freshness: missing` and only the
last-known persisted record, clearly flagged — never as a live status. An
unreadable or unsupported run state is treated as missing, never as success.

## Migration

Pre-0.1.28 single-repo runs and existing `.cw/runs/` layouts keep working with
an empty, rebuildable registry: `registry show` reports `absent` until the first
`registry refresh`, and every pre-0.1.28 CLI command and MCP tool is unchanged.
No run-state schema change ships in v0.1.28; newer unsupported run-state schemas
still fail closed. The registry, archive overlay, provenance overlay, queue, and
home discovery set are all derived files that can be deleted and rebuilt from
source at any time.

## CLI ↔ MCP Parity (v0.1.28)

Every command and tool referenced above is declared in the capability registry
(`src/capability-registry.ts`) and validated by `npm run parity:check`, so
`cw <cmd> --json` and the matching `cw_<tool>` result render one data source.
See [cli-mcp-parity.7.md](cli-mcp-parity.7.md).

## Execution Backends (v0.1.29)

v0.1.29 lifts execution into a pluggable driver layer: one narrow `ExecutionBackend`
contract with interchangeable `node`/`bun`/`shell`/`container`/`remote`/`ci`
drivers, selected by `--backend` (parallel to `--sandbox`) and inspected via
`backend list|show|probe`. The result/evidence envelope is schema-identical across
backends; the backend id + sandbox attestation are recorded as provenance, so this
surface is unchanged regardless of which backend executed a run. See
[execution-backends.7.md](execution-backends.7.md).
## Web / Desktop Workbench (v0.1.30)

v0.1.30 adds the Web / Desktop Workbench: a read-only, localhost-only human
console that renders this surface (and the other four operator panels — run
graph, blackboard, worker logs, candidate compare, audit timeline) for any run,
reading the SAME capability `--json` payloads. It is a THIRD FRONT DOOR alongside
the CLI and MCP that holds no authoritative state and forks no schema: each panel
equals its `cw <cmd> --json` payload byte-for-byte (parity-gated), and refresh
re-derives everything from disk. See
[web-desktop-workbench.7.md](web-desktop-workbench.7.md).

## Observability + Cost Accounting (v0.1.31)

v0.1.31 adds Observability + Cost Accounting: `metrics show`/`metrics summary`
derive durations, failure/verifier/acceptance rates (with sample counts and
fail-closed `n/a`), and host-attested token/cost from existing durable run state
— no metrics database, no collector daemon, no hidden counter. Usage is additive
and optional (absent ⇒ `unreported`, never 0); cost is `attested` (attested usage
× a recorded pricing policy) or clearly `estimated`, with pricing as policy. Both
verbs are parity-gated and render read-only in the v0.1.30 Workbench. See
[observability-cost-accounting.7.md](observability-cost-accounting.7.md).


## Team Collaboration (v0.1.32)

v0.1.32 adds Team Collaboration: a host-attested actor and append-only
approvals/rejections/comments/handoffs provenance-linked to a durable target,
plus a review gate that STACKS ON the verifier gate — required approvals from
authorized roles, enforced inside `resolveCommitGate` AFTER the verifier checks
and never instead of them, failing closed on quorum/authority/self-approval and
recording who approved the very artifact that shipped. Policy (required approvals,
authorized roles, self-approval) is data, default off (pre-v0.1.32 behavior
unchanged). The verbs are parity-gated and render read-only in the v0.1.30
Workbench. See [Team Collaboration](team-collaboration.7.md).

## Release Tooling (v0.1.33)

the per-tag mechanical surfaces (version bump across 17 surfaces, feature scaffold, and the forward-reference docs) become deterministic scripts, with a de-duplicated release gate. See release-tooling(7).

## Real Execution Backend Integrations (v0.1.34)

container/remote/ci backends really execute (docker/podman run, remote/CI POST-and-poll) under the sandbox contract, with byte-stable evidence vs node and fail-closed refusal when a runtime/endpoint is unavailable. See real-execution-backends(7).

## Node Snapshot / Diff / Replay (v0.1.35)

per-node snapshot, structural diff, and isolated deterministic replay over StateNode, reusing the v0.1.23 eval harness; fail-closed on source drift (valid|stale|absent). See node-snapshot-diff-replay(7).

## Contract Migration Tooling (v0.1.36)

first-class declared migration registry (run-state + workflow-app) with per-edge compatibility proofs, fail-closed reachability, and a round-trip/non-destruction prover. See contract-migration-tooling(7).
