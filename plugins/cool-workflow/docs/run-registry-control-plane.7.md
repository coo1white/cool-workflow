# Run Registry / Control Plane

CW v0.1.28 adds the Run Registry / Control Plane: a layer that takes care of MANY
workflow runs across repositories. Before v0.1.28 a run lived only under its
repo's `.cw/runs/<id>/` and was loaded from the current directory
(`loadRunFromCwd`); there was no cross-repo index and no joined-up lifecycle
control. This release adds search, resume, archive, a durable queue,
cross-repo history, and failed-run rerun — without any change to the run-state schema
and without taking ownership of source truth.

The design keeps to the same base-system observability idea as
[State Explosion Management](state-explosion-management.7.md) and the
[Evidence Adoption Reasoning Chain](evidence-adoption-reasoning-chain.7.md):

- the per-run `.cw/runs/<id>/state.json` is the SINGLE source of truth
- the registry is a DERIVED userland index, never a stand-in for source records
- plain files, stable JSON, deterministic output
- small commands that join together and console views easy to read, with full
  machine-readable output on offer
- fail closed when the index is stale, a run's source changed, or its source is
  missing — never make up run status from the cache
- append-only history: resume goes on with a run, rerun makes a NEW linked run,
  and archive marks rather than deletes
- backward compatible; no hidden database; no daemon needed to read state

## Mechanism vs policy

The registry is MECHANISM: a rebuildable cache over runs. POLICY — retention
windows, queue ordering, and archive thresholds — can be set and is kept out
of the index (`RunRegistryPolicy`, explicit flags). The index can be deleted and
built again from source at any time; it never holds power that a `state.json` does
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

A `RunRegistryIndex` brings together records for a scope (`repo` or `home`) with its
own `sourceFingerprint`, the covered `repos`, the `queue`, and lifecycle
`counts`. A `RunRegistryReport` wraps the index with explicit freshness
(`valid`, `stale`, or `absent`) plus the `staleRuns` and `missingRuns` lists and
a `nextAction`. Every read makes records again from source; the persisted index is
only compared against, never trusted as the live status.

During one index build, repo-level overlays (`archive.json` and
`provenance.json`) are read once per repo and passed as an in-memory scan
snapshot to each run record. This is a short-lived mechanism, not a lasting
cache: the next registry command reads source state and overlays again from disk, so
freshness, fail-closed behavior, and output shape stay unchanged while large
repos keep clear of doing the same overlay reads over and over.

## Lifecycle state machine

Lifecycle is SORTED from state that is already there, never made up. `deriveLifecycle`
puts the following rules to a run's source state — first match wins:

```text
1. running tasks > 0                              -> running
2. open feedback > 0                              -> blocked   (failures under correction)
3. failed tasks > 0                               -> failed
4. tasks > 0 and all tasks completed              -> completed
5. verifier-gated commits > 0 and nothing pending -> completed (commit-only runs)
6. completed tasks > 0                            -> running   (mid-flight)
7. otherwise                                      -> queued
```

`archived` is an OVERLAY state put on top of this. The shown
`lifecycle` becomes `archived`, but `derivedLifecycle` keeps the
source-derived state so search and history can still match the run under it.
The classifier never reads the cache; it reads source `state.json`.

## Cross-repo layout

State is plain files, easy to read and to diff:

```text
<repo>/.cw/runs/<id>/state.json     source of truth (unchanged, never owned here)
<repo>/.cw/registry/index.json      per-repo derived index (rebuildable)
<repo>/.cw/registry/archive.json    archive overlay (mark; never deletes source)
<repo>/.cw/registry/provenance.json rerun provenance links (derived metadata)

$CW_HOME/registry/repos.json        registered repo roots (explicit discovery set)
$CW_HOME/registry/index.json        cross-repo derived index (rebuildable)
$CW_HOME/registry/queue.json        durable run queue (plain, ordered)
```

The home registry root is worked out from `CW_HOME`, then
`XDG_STATE_HOME/cool-workflow`, then `~/.local/state/cool-workflow`. A repo is
put into `repos.json` when it is refreshed (or when a queue entry names
it). Reads never write: a search or show works out the repo set as the union of
the registered repos and the current repo in memory, so reading the index never
changes discovery state.

## Search

`run search` queries runs by `--app`, `--status`, time range (`--since`,
`--until`), `--repo`, and free-text (`--text`, matched over runId, app, workflow,
title, repo, lifecycle, loop stage, and a bounded digest of run inputs).
Results are deterministic (ordered by `createdAt`, then `runId`) and in pages
(`--limit`, `--offset`). Search is cross-repo by default (`--scope home`); use
`--scope repo` to keep to the current repo. Archived runs are taken in by
default and can be left out with `--include-archived false`.

## Resume

`run resume <run-id>` finds a run by id across the registry — not just the
cwd — loads its durable state, and gives back the next runnable tasks and next
actions for the host to run. Resume is read-only over source: it never
changes `state.json` and never un-archives a run.

`run resume <run-id> --drive` (or `--once` for a single step) hands the found
run straight to the agent-delegation drive loop that is already there — it plans nothing again and
picks up the pending/running tasks deterministically from durable state — and
adds the drive outcome to the result under a `drive` field. The default (no
`--drive`) payload and `nextActions` stay byte-identical. An unconfigured agent
gives `drive.status="blocked"` (fail-closed, never a made-up completion); CW
hands worker execution to your agent and never runs a model itself.

## Queue

`queue add` adds a durable entry to the end of `$CW_HOME/registry/queue.json` with an
explicit `--priority` (lower drains first; ties break by enqueue time, then id).
`queue list` prints the queue in policy order; `queue show <id>` shows one entry.
`queue drain [--limit N]` marks the next ready entries drained and gives them back —
CW keeps a record of order and readiness; the HOST still runs the workers. Nothing in
the queue starts work on its own.

## Archive

`run archive <run-id>` writes an overlay mark to the owning repo's
`registry/archive.json`; the run's `state.json` is never moved or deleted, and
the run stays searchable (its `derivedLifecycle` is kept). `--unarchive`
clears the mark. Retention is POLICY: `run archive --older-than-days N
[--state completed --state failed]` archives runs that fit and are older than the window
without touching source truth. The default policy archives nothing
(`archiveOlderThanDays = 0`) until a window is given.

## Rerun

`run rerun <run-id>` runs a failed run again as a NEW run: it uses the first
inputs and app again, puts the new run next to the first one (same repo), and keeps a record of a
provenance link (`rerunOf`, `rerunOfRepo`, `originRunId`, `generation`, `reason`)
in the repo's `registry/provenance.json`. The first failed run is KEPT
for audit — the past is never written over. Rerunning a rerun adds one to
`generation` and keeps `originRunId` pinned to the chain root.

## Portable export, import, and restore verification

`run export <run-id> --output PATH` writes a portable JSON archive for a run. The
archive takes in the run state plus run-local files, committed artifacts, audit
overlays, telemetry ledger files, per-file sha256 digests, file sizes, and a
manifest digest. External repo-local artifact paths named by the run are
copied into the archive under `external-artifacts/` and kept with their
first `sourcePath`; the source run is never changed.

`run import PATH --target DIR` puts the archive back under
`DIR/.cw/runs/<run-id>/`, rebases paths to the target repo, writes an
`import-manifest.json`, refreshes the target repo registry, and at once runs
the same verification used by `run verify-import`. Restored part runs can be
resumed from the target repo; restored failed runs can still be found from the
home registry and can be rerun as new linked runs. The import does not change the
source repository or the source run.

**Import-time refusal (fail-closed before any write).** Import checks every
file digest, every file size, the file count, and the manifest digest *before*
making the target run directory — so a tampered archive is turned away with a
non-zero exit and a single `cw:` stderr line, leaving nothing on disk (no part
restore). Set `CW_REQUIRE_ARCHIVE_INTEGRITY=1` to also turn away an archive
whose top-level integrity block is *absent* — closing the legacy fail-open seam
where a stripped-integrity archive imported unverified. Unset (the default) keeps
legacy integrity-less archives byte-identical; the flag is mechanism, not policy.

The archive's run id becomes a directory name under `DIR/.cw/runs/`, so import
also refuses any run id that is not a single safe path segment (`[A-Za-z0-9._-]`,
with no separator and not the `.` or `..` component) and asserts the resolved run
directory stays inside the target's runs root — both *before* the directory is
made — so a crafted id such as `../../etc` can never write outside the runs tree.
(An embedded `..` such as `v1..2` is a safe directory name, not a traversal, and
is allowed so a legitimately-minted run id always round-trips.) The same refusal
protects `cw report verify-bundle`, which restores an untrusted bundle into a
throwaway temporary directory.

`run verify-import <run-id> [--cwd DIR]` reads the restore manifest again, works out
every restored file digest again, checks the manifest digest, checks the telemetry
ledger when one was restored, and proves the **trust-audit hash chain** again (the
decisions / sandbox / commit-gate log, also restored under `audit/`). Missing
manifests, digest mismatches, path escapes, unsupported archive schemas, unreadable
files, telemetry-chain failures, or a forged audit chain (`trust-audit-invalid`)
give back explicit failed checks in place of a made-up success. An archive with no
audit log gives a passing `trust-audit` check (nothing to prove — no false-red).

By default `verify-import` prints the result and exits 0 even when a check fails
(it is a report). Pass `--strict` to make any failed restore check exit non-zero,
so `cw run verify-import <run> --strict && restore` stops on a tampered archive.

**Inspect an archive before restoring.** `run inspect-archive PATH [--json]`
proves a portable archive's integrity again *without writing anything* — set it next to
`run import`, which checks as a side-effect of restoring a full
`.cw/runs/<id>/` tree. It works out every built-in file's sha256 and size again, the
`integrity.fileCount` and manifest digest, and the whole-archive sha256, giving back
a structured `checks[]` — each failure names the bad `relativePath` with a
`digest-mismatch` / `size-mismatch` / `manifest-digest-mismatch` /
`file-count-mismatch` code. It never throws: an unreadable path, invalid JSON, or an
unknown `schemaVersion` (`schemaSupported:false`) is reported as a check, not a
stacktrace — stdout is always valid JSON, diagnostics go to stderr. It exits `1`
when `ok:false`, so `cw run inspect-archive <path> && cw run import <path>` stops
before importing a bad archive. It is a true preview of import: under
`CW_REQUIRE_ARCHIVE_INTEGRITY=1` a stripped-integrity archive (which import would
turn away) also inspects as `ok:false`; with the env unset (default) an absent integrity
block is only reported, not failed.

**Restore in one fail-closed step.** `run restore PATH --target DIR [--json]`
does the whole move-a-run-to-another-machine flow as ONE atomic, fail-closed
step: it integrity-**inspects** the bundle first (writing nothing), **imports**
it, then reuses the verification `import` already ran — and reports `ok:true`
ONLY when that verify passes. This closes a real gap: `run import` runs a
verification (it re-proves restored file digests, the **telemetry ledger**, and
the **trust-audit hash chain**) and reports it, but does NOT fail on it — it
exits `0` even when that chain does not verify. So a run whose telemetry or
trust-audit chain was tampered (yet whose file digests are intact) imports with a
made-up success. `run restore` refuses exactly that: it fails closed on the same
verification `import` only reports. A bundle that fails the up-front integrity
inspect is refused **before any import**, so nothing is written and the run is
never left part-restored; the result carries `imported:null` and `verify:null`.
A bundle that imports but fails post-import verification is reported with
`ok:false` too. It exits `1` whenever `ok:false`, so `cw run restore <path>` is a
single command that either lands a fully-proven run or refuses with a non-zero
exit — never a made-up success. The result is structured
(`{ schemaVersion, ok, target, inspect, imported, verify, registry }`) so it is
scriptable. `run import` and `run inspect-archive` are unchanged; restore is a
thin composition of `inspectArchive` + `importRun` (reusing its verification).

MCP gives the same mechanisms as `cw_run_export`, `cw_run_import`,
`cw_run_verify_import`, `cw_run_inspect_archive`, and `cw_run_restore`; the CLI
and MCP paths share the same runtime functions.

## Cross-repo history

`history` reads one joined-up timeline of runs across all registered repos
(newest first), each entry carrying its repo, lifecycle, loop stage, timestamps,
freshness, and provenance back to its `.cw/runs/<id>/`. Filter with `--app` and
`--status`; page with `--limit` and `--offset`.

## CLI

```text
node scripts/cw.js registry refresh [--scope repo|home] [--json]
node scripts/cw.js registry show [--scope repo|home] [--json]
node scripts/cw.js run search [--app ID] [--status STATE] [--text Q] [--repo PATH] [--since ISO] [--until ISO] [--limit N] [--offset N] [--scope repo|home] [--json]
node scripts/cw.js run list [--scope repo|home] [--json]
node scripts/cw.js run show <run-id> [--scope repo|home] [--json]
node scripts/cw.js run resume <run-id> [--limit N] [--drive [--once]] [--json]
node scripts/cw.js run archive <run-id> [--reason TEXT] [--unarchive]
node scripts/cw.js run archive --older-than-days N [--state completed --state failed]
node scripts/cw.js run rerun <run-id> [--reason TEXT]
node scripts/cw.js run export <run-id> --output PATH
node scripts/cw.js run import PATH --target DIR
node scripts/cw.js run verify-import <run-id> [--cwd DIR]
node scripts/cw.js run inspect-archive PATH [--json]
node scripts/cw.js run restore PATH --target DIR [--json]
node scripts/cw.js queue add [--app ID|--workflow ID|--runId ID] [--repo PATH] [--priority N] [--note TEXT]
node scripts/cw.js queue list [--status STATE] [--repo PATH] [--json]
node scripts/cw.js queue show <queue-id>
node scripts/cw.js queue drain [--limit N] [--repo PATH]
node scripts/cw.js history [--app ID] [--status STATE] [--limit N] [--offset N] [--scope repo|home] [--json]
```

Read commands print short human panels by default (lifecycle, freshness, counts,
and next action) and full machine output under `--json` or `--format json`.

## MCP parity

Every command above is declared once in the v0.1.28 capability registry
(`src/capability-registry.ts`) and shown on both surfaces, so `cw <cmd>
--json` is schema-identical to the matching `cw_<tool>` result and the pair
passes `npm run parity:check`:

- `cw_registry_refresh`, `cw_registry_show`
- `cw_run_search`, `cw_run_list`, `cw_run_show`, `cw_run_resume`,
  `cw_run_archive`, `cw_run_rerun`, `cw_run_export`, `cw_run_import`,
  `cw_run_verify_import`
- `cw_queue_add`, `cw_queue_list`, `cw_queue_drain`, `cw_queue_show`
- `cw_history`

See [cli-mcp-parity.7.md](cli-mcp-parity.7.md).

## Freshness and fail-closed behavior

`registry show` works out the current source fingerprint again for every run and
compares it to the persisted index. If a run's source changed, the report status
is `stale` and the run is named in `staleRuns`. If a persisted run's source is
gone, the run is named in `missingRuns`, it is NOT made up into the current
records, and the next action is `registry refresh`. `run show` of a run whose
source is missing gives back `found: false` with `freshness: missing` and only the
last-known persisted record, marked clearly — never as a live status. An
unreadable or unsupported run state is taken as missing, never as success.

## Migration

Pre-0.1.28 single-repo runs and `.cw/runs/` layouts that are already there keep working with
an empty, rebuildable registry: `registry show` reports `absent` until the first
`registry refresh`, and every pre-0.1.28 CLI command and MCP tool is unchanged.
No run-state schema change ships in v0.1.28; newer unsupported run-state schemas
still fail closed. The registry, archive overlay, provenance overlay, queue, and
home discovery set are all derived files that can be deleted and built again from
source at any time.

## CLI ↔ MCP Parity (v0.1.28)

Every command and tool named above is declared in the capability registry
(`src/capability-registry.ts`) and checked by `npm run parity:check`, so
`cw <cmd> --json` and the matching `cw_<tool>` result show one data source.
See [cli-mcp-parity.7.md](cli-mcp-parity.7.md).

## Execution Backends (v0.1.29)

v0.1.29 lifts execution into a pluggable driver layer: one narrow `ExecutionBackend`
contract with `node`/`bun`/`shell`/`container`/`remote`/`ci`
drivers you can swap, picked by `--backend` (parallel to `--sandbox`) and looked at through
`backend list|show|probe`. The result/evidence envelope is schema-identical across
backends; the backend id + sandbox attestation are kept as provenance, so this
surface is unchanged no matter which backend ran a run. See
[execution-backends.7.md](execution-backends.7.md).
## Web / Desktop Workbench (v0.1.30)

v0.1.30 adds the Web / Desktop Workbench: a read-only, localhost-only human
console that shows this surface (and the other four operator panels — run
graph, blackboard, worker logs, candidate compare, audit timeline) for any run,
reading the SAME capability `--json` payloads. It is a THIRD FRONT DOOR beside
the CLI and MCP that holds no authoritative state and forks no schema: each panel
equals its `cw <cmd> --json` payload byte-for-byte (parity-gated), and refresh
makes everything again from disk. See
[web-desktop-workbench.7.md](web-desktop-workbench.7.md).

## Observability + Cost Accounting (v0.1.31)

v0.1.31 adds Observability + Cost Accounting: `metrics show`/`metrics summary`
work out durations, failure/verifier/acceptance rates (with sample counts and
fail-closed `n/a`), and host-attested token/cost from durable run state that is already there
— no metrics database, no collector daemon, no hidden counter. Usage is additive
and optional (absent ⇒ `unreported`, never 0); cost is `attested` (attested usage
× a recorded pricing policy) or clearly `estimated`, with pricing as policy. Both
verbs are parity-gated and show read-only in the v0.1.30 Workbench. See
[observability-cost-accounting.7.md](observability-cost-accounting.7.md).


## Team Collaboration (v0.1.32)

v0.1.32 adds Team Collaboration: a host-attested actor and append-only
approvals/rejections/comments/handoffs provenance-linked to a durable target,
plus a review gate that STACKS ON the verifier gate — required approvals from
authorized roles, made to hold inside `resolveCommitGate` AFTER the verifier checks
and never in place of them, failing closed on quorum/authority/self-approval and
keeping a record of who approved the very artifact that shipped. Policy (required approvals,
authorized roles, self-approval) is data, default off (pre-v0.1.32 behavior
unchanged). The verbs are parity-gated and show read-only in the v0.1.30
Workbench. See [Team Collaboration](team-collaboration.7.md).

## Release Tooling (v0.1.33)

the per-tag mechanical surfaces (version bump across 17 surfaces, feature scaffold, and the forward-reference docs) become deterministic scripts, with a release gate that has no doubles. See release-tooling(7).

## Real Execution Backend Integrations (v0.1.34)

container/remote/ci backends really run work (docker/podman run, remote/CI POST-and-poll) under the sandbox contract, with byte-stable evidence vs node and fail-closed refusal when a runtime/endpoint is not on hand. See real-execution-backends(7).

## Node Snapshot / Diff / Replay (v0.1.35)

per-node snapshot, structural diff, and on-its-own deterministic replay over StateNode, using the v0.1.23 eval harness again; fail-closed on source drift (valid|stale|absent). See node-snapshot-diff-replay(7).

## Contract Migration Tooling (v0.1.36)

first-class declared migration registry (run-state + workflow-app) with per-edge compatibility proofs, fail-closed reachability, and a round-trip/non-destruction prover. See contract-migration-tooling(7).

## Control-Plane Scheduling (v0.1.37)

priority + concurrency limits + lease lifecycle + retry/backoff + fail-closed park over the v0.1.28 Run Registry queue; policy-as-data, deterministic. See control-plane-scheduling(7).

## Agent Delegation Drive (v0.1.38)

start an external agent process per worker, take in result.md + attestation, auto-drive plan->dispatch->fulfill->accept->commit

## Run Retention & Provable Reclamation (v0.1.39)

tiered, append-only, cryptographically-verifiable run reclamation: seal the audit skeleton, free the bulk that can be built again, prove it

## Durable State & Locking (v0.1.40)

atomic temp->rename writes + fsync-durability for authoritative stores; portable stale-stealing file lock serializing the cross-process read-modify-write stores

## Self-Audit Hardening & Pure-Router Decomposition (v0.1.41)

evidence grounding + durable audit append + symlink-hardened containment + deterministic worker ids + recursive redaction; BackendRegistry self-describing drivers (no per-id switches); orchestrator god-object decomposed into per-domain operation modules (pure loadRun->delegate router)

## Robust Result Ingest (v0.1.42)

take in findings/evidence from any sensible agent shape (alt keys + prose), CW makes grounded evidence itself, give a warning on empty capture — closes the v0.1.41 live-drive 'accepted with 0 captured' failure

## No-False-Green Gate & Launch Prep (v0.1.43)

Hard gate stopping empty-capture verifier-gated commits, plus quickstart and launch-prep docs.

## Release-Gate Determinism & Agents Vendor (v0.1.44)

Release-readiness checks now check the committed blob (`git show HEAD:<path>`) in place of the mutable working tree — doing away with false-red/false-green from working-tree writes at the same time (iCloud/Spotlight/editor). Adds the `agents` vendor manifest target: a generated `.agents/plugins/cool-workflow/` adapter giving any non-Claude AI agent one common interface to CW.

## P1-P2 Fixes & CI Content Surfaces (v0.1.49)

Migration DAG with reversible edges (v0.1.45), capability auto-discovery (v0.1.46), vendor-adapter registry (v0.1.47), state auto-compaction and P2 fixes (v0.1.48), plus CI content-surface determinism hardening (v0.1.49).
0.1.51

0.1.76

0.1.77

0.1.78

0.1.79

## Fast Architecture Review (v0.1.80)

Adds the opt-in fast architecture-review lane: scoped JSONL source contexts, diff-aware exports, Map and Assess results you can use again, wrapper metrics you can measure, a background full-review handoff you can act on, and userland model policy flags for routing fast/strong workers without any change to the full review contract.

## Resume Drive, Inspect-Archive & Restore Re-Prove (v0.1.81)

v0.1.81 adds `run resume <id> --drive/--once` (go on with a run that was stopped through the agent-drive loop; default resume stays read-only and byte-identical), `run inspect-archive PATH` (read-only archive integrity check that names any bad file without importing), and restore-time hardening: `verify-import` now proves the trust-audit chain again on restore and gains `--strict`, and `CW_REQUIRE_ARCHIVE_INTEGRITY=1` turns away a stripped-integrity archive before any write.
_No behavioral change in v0.1.82 (run resolution now threads an explicit base directory via CoolWorkflowRunner.withBaseDir in place of changing process.cwd; the resolved run is unchanged)._

## Hardening and Onboarding (v0.1.83)

Loaders fail closed on corrupt state; store writes are made safe under more than one writer; a new cw doctor checks your setup; help lists every command; and the docs are put into Basic English.

## Privacy Release (v0.1.84)

No other change to this page in v0.1.84.

0.1.85

0.1.86

## 0.1.87 (v0.1.87)

npm test parallel, 4-vendor wrappers (Claude/Codex/Gemini/OpenCode), Homebrew-style CLI UX (colors/did-you-mean/categorized help/error tips/cw info/cw search/cw man/doctor --fix), post-success summaries, agent execution timing

## 0.1.88 (v0.1.88)

Security: archive import now refuses path-traversal run ids (`..`/absolute/separator-bearing ids) before any run dir is minted, closing a write-outside-the-registry vector; run resolution and the run-state schema are otherwise unchanged.

## 0.1.89 (v0.1.89)

_No behavioral change in v0.1.89 (CLI-surface golden-path + help-output fixes only; this subsystem is unchanged)._

0.1.90

0.1.91

0.1.93

0.1.94

0.1.95

0.1.96

0.1.97

0.1.98
