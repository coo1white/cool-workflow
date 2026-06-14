# Architecture

CW is a base system plus userland apps. The runtime owns the mechanisms for
planning, dispatch, state, verification, and reporting. Workflow apps, model
choice, pricing policy, and vendor wrappers live outside that kernel.

```text
workflow app -> runner -> dispatch -> isolated workers
    -> results -> feedback/candidates -> verifier gate
    -> commit/checkpoint -> report/trust audit

multi-agent host -> topology -> blackboard/coordinator
    -> fanout/fanin -> candidate score/select
```

## Core Boundary

The runtime lives under `plugins/cool-workflow/src/`. It provides:

| Area | Responsibility |
| --- | --- |
| `orchestrator` | Plans runs, loads workflows, records results, writes reports. |
| `state` | Persists `.cw/runs/<id>/state.json` and migration entry points. |
| `dispatch` and `worker-isolation` | Allocate worker scopes, manifests, and result paths. |
| `verifier` and `commit` | Validate outputs and create verifier-gated checkpoints. |
| `capability-registry` | Declares the CLI and MCP surfaces from one source. |
| `run-registry` | Indexes, resumes, archives, exports, and imports runs. |
| `telemetry` and `trust-audit` | Record usage attestations, hash chains, and decisions. |

The project index in the source repo is generated from code and is the best
maintainer map when module ownership matters.

## Delegation Boundary

CW delegates worker execution to an external process or endpoint. The agent
reads the worker input, writes `result.md`, and may report model and usage
metadata. CW records the handle and validates the result envelope, but it does
not import a model SDK or call a model API.

That boundary is why model credentials stay with the agent. It is also why
telemetry verification is an attribution and integrity mechanism, not a direct
measurement of model usage.

## State Layout

A run is stored as plain files:

```text
<repo>/.cw/runs/<run-id>/
  state.json
  report.md
  audit/events.jsonl
  telemetry.json
  workers/<worker-id>/
  results/
  nodes/
  candidates/
  commits/
```

The per-run `state.json` is the source of truth. Registry indexes, summaries,
reasoning views, and workbench panels are derived views.

## CLI And MCP

The CLI is for human speed. MCP tools are for machine context. Both route through
shared capability entries, and declared JSON payloads are parity-checked.

Examples:

- `cw app list` and `cw_app_list`
- `cw report --json` and `cw_report`
- `cw run import` and `cw_run_import`
- `cw telemetry verify` and `cw_telemetry_verify`

The Workbench is a read-only localhost view over the same run files and
capability payloads. It does not own authoritative state.

For more on vendor manifests and MCP boot checks, see
[MCP And Manifests](MCP-And-Manifests.md).

## Failure Discipline

CW prefers explicit refusal over quiet fallback:

- no agent configured -> blocked,
- invalid result envelope -> rejected or parked,
- corrupted archive -> refused or reported failed,
- stale derived index -> reported stale,
- unverifiable audit chain -> failed verification.

stdout is reserved for data. Human diagnostics and live agent traces go to
stderr when explicitly enabled.

## Related Pages

- [Workflow Apps](Workflow-Apps.md)
- [Trust And Audit](Trust-And-Audit.md)
- [Recovery And Restore](Recovery-And-Restore.md)
