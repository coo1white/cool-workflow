# Operator UX

Cool Workflow v0.1.12 added a read-only Operator UX layer to help you see a
run from the console. It does not change workflow state, dispatch workers, score
candidates, or commit snapshots. It reads `WorkflowRun` state and makes
deterministic summaries for people, while it keeps JSON for scripts and MCP.

## Inspect A Run

Human status is the default:

```bash
node scripts/cw.js status <run-id>
```

The status view gives you run id, workflow/app id and version, loop stage, active
phase, blocked reasons, phase/task counts, workers, candidates, feedback,
commits, multi-agent runtime health, Multi-Agent Operator UX counts, report
path, and the next command it puts forward.

Machine-readable status is still there for you:

```bash
node scripts/cw.js status <run-id> --json
node scripts/cw.js status <run-id> --format json
```

`CoolWorkflowRunner.status()` and MCP `cw_status` still give back structured
status data for integrations.

In v0.1.13, MCP also gives JSON-native operator tools:
`cw_operator_status`, `cw_operator_graph`, `cw_operator_report`,
`cw_worker_summary`, `cw_candidate_summary`, `cw_feedback_summary`, and
`cw_commit_summary`.

## Next Actions

The things it puts forward are deterministic and use only commands that are in
the CW CLI. Examples:

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

Open feedback comes first, before dispatch or candidate work. If all tracked
work is done, the advisor points to `cw report <run-id> --show`.

## Graph

Use the top-level graph command for a small console map:

```bash
node scripts/cw.js graph <run-id>
node scripts/cw.js graph <run-id> --json
```

The legacy node command still works:

```bash
node scripts/cw.js node graph <run-id>
node scripts/cw.js node graph <run-id> --json
```

The human graph puts phases, tasks, dispatches, workers, result nodes,
verifier nodes, candidates, selections, commits, and feedback into groups, then prints the
edges between them. v0.1.17 also adds `multi-agent-run`, `agent-role`,
`agent-group`, `agent-membership`, `agent-fanout`, and `agent-fanin` nodes when
the run has first-class multi-agent state. v0.1.18 adds `blackboard`,
`blackboard-topic`, `blackboard-message`, `blackboard-context`,
`blackboard-artifact`, `blackboard-snapshot`, and `coordinator-decision` nodes
when shared coordination state is there. JSON output gives back deterministic `nodes`
and `edges`.

## Multi-Agent Operator UX

v0.1.21 adds clear multi-agent operator views that answer who is dependent on
whom, who is blocked, and which evidence went into the accepted result:

```bash
node scripts/cw.js multi-agent graph <run-id>
node scripts/cw.js multi-agent dependencies <run-id>
node scripts/cw.js multi-agent failures <run-id>
node scripts/cw.js multi-agent evidence <run-id>
```

The same derived model is in `status`, `report --show`, and
`cw_multi_agent_status` under `summaries.multiAgentOperator`. See
[multi-agent-operator-ux.7.md](multi-agent-operator-ux.7.md) for the full
trace from agent membership to verifier-gated commit.

## Console Report

`cw report` still writes the Markdown report file and prints its path:

```bash
node scripts/cw.js report <run-id>
```

Use `--show` or `--summary` when the operator needs a console report that is easy to read:

```bash
node scripts/cw.js report <run-id> --show
node scripts/cw.js report <run-id> --summary
```

The console report gives the same high-value status panels plus active and
pending tasks, evidence paths and locators, and resource inspection commands.

## Resource Summaries

The chief run resources have human summaries by default and JSON when you ask for it:

```bash
node scripts/cw.js worker summary <run-id>
node scripts/cw.js worker summary <run-id> --json

node scripts/cw.js candidate summary <run-id>
node scripts/cw.js candidate summary <run-id> --json

node scripts/cw.js feedback summary <run-id>
node scripts/cw.js feedback summary <run-id> --json

node scripts/cw.js commit summary <run-id>
node scripts/cw.js commit summary <run-id> --json

node scripts/cw.js multi-agent summary <run-id>
node scripts/cw.js multi-agent summary <run-id> --json
node scripts/cw.js multi-agent graph <run-id>
node scripts/cw.js multi-agent graph <run-id> --json
node scripts/cw.js multi-agent dependencies <run-id>
node scripts/cw.js multi-agent failures <run-id>
node scripts/cw.js multi-agent evidence <run-id>
```

Worker summaries show allocated/running/verified/failed/rejected counts,
sandbox profile ids, manifest paths, result paths, and linked feedback for
failed or rejected workers.

Candidate summaries show registered/scored/selected/verified/rejected/failed
counts, the newest ranking path, selected candidates, candidates ready for commit,
and clear missing scoring/evidence/gate problems.

Feedback summaries put records into groups by open/tasked/resolved/rejected status,
severity, classification, and retryability.

Commit summaries make a clear line between verifier-gated commits and non-gated checkpoints
and show snapshot paths, evidence counts, and linked verifier/candidate/selection
ids.

Multi-agent summaries show run and group status, role coverage, membership
health, fanout/fanin progress, missing evidence, blocked reasons, and the next
action it puts forward.

## File Discipline

Operator UX keeps the same FreeBSD-flavored rule as the rest of CW:

```text
clear console output for humans
stable JSON for scripts
plain files for evidence
no hidden daemon assumption
```

If you are not certain, inspect `.cw/runs/<run-id>/state.json`, the resource directories,
and the command-specific `--json` output.
0.1.51
