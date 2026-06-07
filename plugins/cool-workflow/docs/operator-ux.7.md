# Operator UX

Cool Workflow v0.1.12 added a read-only Operator UX layer for understanding a
run from the console. It does not change workflow state, dispatch workers, score
candidates, or commit snapshots. It reads `WorkflowRun` state and renders
deterministic summaries for humans while preserving JSON for scripts and MCP.

## Inspect A Run

Human status is the default:

```bash
node scripts/cw.js status <run-id>
```

The status view includes run id, workflow/app id and version, loop stage, active
phase, blocked reasons, phase/task counts, workers, candidates, feedback,
commits, report path, and the next recommended command.

Machine-readable status stays available:

```bash
node scripts/cw.js status <run-id> --json
node scripts/cw.js status <run-id> --format json
```

`CoolWorkflowRunner.status()` and MCP `cw_status` continue to return structured
status data for integrations.

In v0.1.13, MCP also exposes JSON-native operator tools:
`cw_operator_status`, `cw_operator_graph`, `cw_operator_report`,
`cw_worker_summary`, `cw_candidate_summary`, `cw_feedback_summary`, and
`cw_commit_summary`.

## Next Actions

Recommendations are deterministic and only use commands that exist in the CW
CLI. Examples:

```text
node scripts/cw.js dispatch <run-id> --limit 4
  reason: pending tasks are ready for the active phase

node scripts/cw.js worker manifest <run-id> <worker-id>
  reason: running workers need their manifests inspected

node scripts/cw.js feedback show <run-id> <feedback-id>
  reason: open feedback should be resolved before more dispatch

node scripts/cw.js candidate register <run-id> --worker <worker-id>
  reason: a completed worker result has not been registered as a candidate

node scripts/cw.js commit <run-id> --selection <selection-id>
  reason: a verified selected candidate is ready for a verifier-gated commit
```

Open feedback is prioritized before dispatch or candidate work. If all tracked
work is complete, the advisor points to `cw report <run-id> --show`.

## Graph

Use the top-level graph command for a compact console map:

```bash
node scripts/cw.js graph <run-id>
node scripts/cw.js graph <run-id> --json
```

The legacy node command remains compatible:

```bash
node scripts/cw.js node graph <run-id>
node scripts/cw.js node graph <run-id> --json
```

The human graph groups phases, tasks, dispatches, workers, result nodes,
verifier nodes, candidates, selections, commits, and feedback, then prints the
edges between them. JSON output returns deterministic `nodes` and `edges`.

## Console Report

`cw report` still writes the Markdown report file and prints its path:

```bash
node scripts/cw.js report <run-id>
```

Use `--show` or `--summary` when the operator needs a readable console report:

```bash
node scripts/cw.js report <run-id> --show
node scripts/cw.js report <run-id> --summary
```

The console report includes the same high-value status panels plus active and
pending tasks, evidence paths and locators, and resource inspection commands.

## Resource Summaries

Major run resources have human summaries by default and JSON when requested:

```bash
node scripts/cw.js worker summary <run-id>
node scripts/cw.js worker summary <run-id> --json

node scripts/cw.js candidate summary <run-id>
node scripts/cw.js candidate summary <run-id> --json

node scripts/cw.js feedback summary <run-id>
node scripts/cw.js feedback summary <run-id> --json

node scripts/cw.js commit summary <run-id>
node scripts/cw.js commit summary <run-id> --json
```

Worker summaries show allocated/running/verified/failed/rejected counts,
sandbox profile ids, manifest paths, result paths, and linked feedback for
failed or rejected workers.

Candidate summaries show registered/scored/selected/verified/rejected/failed
counts, latest ranking path, selected candidates, candidates ready for commit,
and obvious missing scoring/evidence/gate problems.

Feedback summaries group records by open/tasked/resolved/rejected status,
severity, classification, and retryability.

Commit summaries distinguish verifier-gated commits from non-gated checkpoints
and show snapshot paths, evidence counts, and linked verifier/candidate/selection
ids.

## File Discipline

Operator UX follows the same FreeBSD-flavored rule as the rest of CW:

```text
clear console output for humans
stable JSON for scripts
plain files for evidence
no hidden daemon assumption
```

When in doubt, inspect `.cw/runs/<run-id>/state.json`, the resource directories,
and the command-specific `--json` output.
