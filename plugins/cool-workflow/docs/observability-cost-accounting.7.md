# Observability + Cost Accounting

CW v0.1.31 adds Observability + Cost Accounting: time/duration, failure rate,
verifier pass rate, candidate acceptance rate, and token/cost — all DERIVED from
the run state CW already keeps. Before v0.1.31 there was no metrics module and no
token or cost field anywhere; run state already carried `createdAt`/`updatedAt`/
`completedAt`/`dispatchedAt` and outcome statuses on tasks, workers, verifier
nodes, candidates, memberships, and feedback. This release projects those into a
report — and adds an additive, host-attested usage record so cost can be
accounted honestly — without changing the `ResultEnvelope` schema and without
taking ownership of source truth.

The design follows the same base-system observability philosophy as
[State Explosion Management](state-explosion-management.7.md) and the
[Run Registry / Control Plane](run-registry-control-plane.7.md):

- the per-run `.cw/runs/<id>/state.json` is the SINGLE source of truth
- metrics are a DERIVED projection of source records, never a separate database
- no telemetry pipeline, no background collector daemon, no hidden counters
- plain files, stable JSON, deterministic output
- fail closed: a rate over zero samples is `n/a`, never a fabricated 0%/100%
- cost is ATTESTED, never measured or fabricated; absent usage is `unreported`
- backward compatible; usage/cost fields are additive and optional

## Derived, not a telemetry pipeline

Every number is a projection of existing durable state:

- durations come from recorded timestamps — `dispatchedAt`→`completedAt` for
  tasks, `createdAt`→worker output `recordedAt` for workers, `createdAt`→
  `updatedAt` for the run;
- the failure rate pools failed/rejected workers, failed memberships, failed
  un-worker-backed tasks, and unresolved (`open`/`tasked`) feedback over the
  total of those samples;
- the verifier pass rate counts `verifier` state nodes whose status is a pass
  (`verified`/`committed`) against decided gates (pass + `failed`/`rejected`/
  `blocked`); pending/running gates are undecided and excluded;
- the candidate acceptance rate counts `selected`/`verified` candidates over all
  candidate records.

There is no metrics store. `deriveMetricsReport(run, { now, policy })` is a PURE
function of one run's state, an injected `now`, and an optional pricing policy.
The only now-derived field is `generatedAt`; durations are computed from recorded
timestamps, so a report over a fixed snapshot is byte-reproducible (eval/replay
agnostic). The per-run report is persisted as a rebuildable, fingerprinted
snapshot under `.cw/runs/<id>/metrics/metrics-report.json`; the cross-repo
summary reports each run's snapshot freshness as `valid|stale|absent` against
current source — fail closed, exactly like the registry.

## A counter you cannot trust is worse than none

Each rate is a `RateMetric` carrying `state` (`ok`/`n/a`), `count`, `total`,
`rate`, and per-bucket sample counts. Over zero samples the state is `n/a` and
`count`/`rate` are `null` — never `0`. No divide-by-zero, no partial-data rate
presented as complete. Sample counts and buckets accompany every rate so a reader
can audit the numerator and denominator.

## Cost is attested, never measured or fabricated

CW does not call the model; the host/worker does. Token usage is recorded as
HOST-ATTESTED provenance — a `UsageRecord` accepted on the existing intake path
and stored on the task or worker record (never on `ResultEnvelope`):

```
cw result <run-id> <task-id> <file> \
  --usage-input-tokens 12000 --usage-output-tokens 3400 \
  --usage-model claude-opus-4-8 --usage-source host-attested
cw worker output <run-id> <worker-id> <file> --usage-input-tokens N --usage-output-tokens M --usage-model ID
```

CW records what the host attests, verbatim, and synthesizes nothing. When the
host reports no usage the value is an explicit `unreported` — never `0`, never a
silent guess. The report surfaces `usage.coverage` (the fraction of work units
carrying attested usage) and `usage.unreportedUnits` so the gap is visible.

A monetary figure is `attested` ONLY when derived from attested usage × a
recorded pricing policy with an EXACT model match. When a model is priced by the
policy's `defaultPrice` fallback, that portion is a SEPARATE `estimated` figure
and the cost `state` becomes `estimated`; the two USD figures are never conflated
into one. Cost states:

- `attested` — every attested model exact-matched a policy entry;
- `estimated` — some attested usage was priced by the policy default/fallback;
- `unpriced` — attested usage present but no policy entry (and no default);
- `unreported` — no attested usage to price.

## Mechanism vs policy: pricing is data

The runtime is MECHANISM: it records attested usage and derives rates/durations.
The pricing table is POLICY — supplied as DATA (`CostPolicy`), not baked into the
kernel. The same attested usage yields different cost reports under different
pricing without touching the runtime. A bundled EXAMPLE policy lives at
`manifest/pricing.policy.json` (USD per 1e6 tokens, an editable starting point —
not a live price feed); pass `--pricing <path>` to use your own, or
`--pricing default` for the bundled example. With no policy supplied, cost is
`unpriced`/`unreported`, never guessed.

## One source, every surface

The metrics verbs are declared once in `src/capability-registry.ts`, so the CLI
and MCP surfaces are two renderings of one core (`src/observability.ts`) and pass
the v0.1.27 parity gate — `cw <cmd> --json` is byte-identical to `cw_<tool>`
(durations are integers from recorded timestamps; only the ISO `generatedAt` is
now-derived and neutralized by the parity probe). The v0.1.30 Workbench renders a
read-only metrics panel from the same payload, showing coverage and
`unreported`/`n/a` honestly — it shows nothing the CLI/MCP cannot.

## Commands

- `cw metrics show <run-id>` — the derived per-run report: durations, the three
  rates with sample counts, attested usage with coverage, and cost. `--json` for
  the canonical payload; `--pricing <path>|default` to price attested usage.
- `cw metrics summary` — the cross-repo rollup over the v0.1.28 run registry:
  pooled rates, summed attested usage/cost with coverage, and per-app and
  per-backend breakdowns. `--scope repo|home`; unreadable runs are counted
  (`unreadableRuns`), never silently dropped.

MCP hosts call `cw_metrics_show` and `cw_metrics_summary` with the identical
payloads. Old runs load and report `unreported` cost while still yielding correct
time and rate metrics from their existing timestamps and outcomes.

This document targets CW 0.1.31.


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

## Control-Plane Scheduling (v0.1.37)

priority + concurrency limits + lease lifecycle + retry/backoff + fail-closed park over the v0.1.28 Run Registry queue; policy-as-data, deterministic. See control-plane-scheduling(7).

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

0.1.52
