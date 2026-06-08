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
