# Operator UX

Cool Workflow v0.1.12 added a read-only Operator UX layer to help you see a
run from the console. It does not change workflow state, dispatch workers, or
commit snapshots. It reads `WorkflowRun` state and makes
deterministic summaries for people, while it keeps JSON for scripts and MCP.

## Inspect A Run

Human status is the default:

```bash
cw status <run-id>
```

The status view gives you run id, workflow/app id and version, loop stage, active
phase, blocked reasons, phase/task counts, workers, feedback, commits, the
trust-audit chain, report path, and the next command it puts forward.

Machine-readable status is still there for you:

```bash
cw status <run-id> --json
cw status <run-id> --format json
```

`CoolWorkflowRunner.status()` and MCP `cw_status` still give back structured
status data for integrations.

With no run id (no `<run-id>` and no `--run <id>`), `cw status` prints
`No run selected` and one next action, `cw plan <workflow-id> --repo
<path>`, and exits 0. `--json` gives `{"runId": null, "nextActions":
[...]}` with that same one action. This path reads no run files, so it
starts as fast as `cw version`.

In v0.1.13, MCP also gives JSON-native operator tools:
`cw_operator_status`, `cw_operator_graph`, `cw_operator_report`,
`cw_worker_summary`, `cw_feedback_summary`, and `cw_commit_summary`.

## Next Actions

The things it puts forward are deterministic and use only commands that are in
the CW CLI. Examples:

```text
cw dispatch <run-id> --limit 4
  reason: pending tasks are ready for the active phase

cw worker manifest <run-id> <worker-id>
  reason: running workers need their manifests inspected

cw feedback show <run-id> <feedback-id>
  reason: open feedback should be resolved before more dispatch
```

Open feedback comes first, before dispatch. If all tracked work is done, the
advisor points to `cw report <run-id> --show`.

## Graph

Use the top-level graph command for a small console map:

```bash
cw graph <run-id>
cw graph <run-id> --json
```

The legacy node command still works:

```bash
cw node graph <run-id>
cw node graph <run-id> --json
```

The human graph puts phases, tasks, dispatches, workers, result nodes,
verifier nodes, commits, and feedback into groups, then prints the edges
between them. JSON output gives back deterministic `nodes` and `edges`.

## Console Report

`cw report` still writes the Markdown report file and prints its path.
With no run id it takes the newest run under `.cw/runs/`; with no run at
all it prints one line pointing at `cw -q "<question>"` and exits 0:

```bash
cw report <run-id>
cw report
```

Use `--show` or `--summary` when the operator needs a console report that is easy to read:

```bash
cw report <run-id> --show
cw report <run-id> --summary
```

Use `--open` to see the report in a browser. It writes `report.html`
beside `report.md` (only when missing or older) and opens it with the
system viewer: `CW_OPENER` when set, else `open` (macOS), `start`
(Windows) or `xdg-open`. A missing or failing opener is an error that
names the file, never a silent no-op:

```bash
cw report --open
```

`report.html` makes a link only when its target is `http:`, `https:`,
`mailto:`, or has no scheme (a relative path or a `#` fragment). Any
other target from run data, such as `javascript:`, `data:`, `vbscript:`
or `file:`, stays as plain text in its `[label](target)` form, never a
link.

A run started from a terminal opens the same page by itself when it
ends. `--no-open` or `CW_NO_OPEN=1` turns that off; `--json` never opens
anything.

`report.md` carries one `- Verdict:` line in its header: `PASS` when the
run completed, else the run lifecycle in capitals (for example
`FAILED`). `report.html` shows the same word as a stamp.

The console report gives the same high-value status panels plus active and
pending tasks, evidence paths and locators, and resource inspection commands.

## Resource Summaries

The chief run resources have human summaries by default and JSON when you ask for it:

```bash
cw worker summary <run-id>
cw worker summary <run-id> --json

cw feedback summary <run-id>
cw feedback summary <run-id> --json

cw commit summary <run-id>
cw commit summary <run-id> --json
```

Worker summaries show allocated/running/verified/failed/rejected counts,
sandbox profile ids, manifest paths, result paths, and linked feedback for
failed or rejected workers.

Feedback summaries put records into groups by open/tasked/resolved/rejected status,
severity, classification, and retryability.

Commit summaries make a clear line between verifier-gated commits and non-gated checkpoints
and show snapshot paths, evidence counts, and linked verifier ids.

The candidate, multi-agent, blackboard, and topology panels and their
`cw candidate|multi-agent|blackboard|topology` commands were taken out with
the multi-agent family; see release-and-migration(7), "Removed Surfaces".

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
