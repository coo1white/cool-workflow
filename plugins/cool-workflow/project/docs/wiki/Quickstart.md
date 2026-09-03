# Quickstart

The fast command reference. If a step here is not clear, the
[Getting Started](Getting-Started.md) walk-through explains each one in full.

## Requirements

- Node.js 18 or newer.
- One agent CLI on your `PATH` for live reviews: `claude`, `codex`, `gemini`,
  or `opencode` — or an HTTP agent endpoint via `CW_AGENT_ENDPOINT`.

The tamper-evidence demo needs no agent, no API key, and no cloned repo.

## 1. Run The Integrity Demo

```bash
npx cool-workflow demo tamper
```

Expected result: stdout ends with a `VERDICT: tamper-evidence holds` line. The
demo builds a signed telemetry ledger, edits it in two different ways, and
shows both edits being caught offline.

For a proof payload a script can read:

```bash
npx cool-workflow demo tamper --json
```

The JSON includes `proven: true`, the number of ledger records, and one result
per tamper layer.

## 2. Run A Real Repo Review

```bash
npx cool-workflow quickstart architecture-review \
  --repo /path/to/your/project \
  --question "How does auth work end-to-end here?" \
  --agent-command builtin:claude
```

On a real terminal, CW opens the report in your browser by itself and
prints a short summary (`✓ Report: <path>`, status, and `cw report --open`
for later). Add `--json`, or pipe the output, for the machine payload
instead — a `runId`, status, worker counts, and a `reportPath`, with no
browser opened:

```bash
npx cool-workflow quickstart architecture-review \
  --repo /path/to/your/project \
  --question "How does auth work end-to-end here?" \
  --agent-command builtin:claude \
  --json
```

Read the report again any time:

```bash
cw report --open      # reopens it in your browser
cw report --show      # or read it in the terminal
```

If no agent is configured, CW returns `status: blocked`. That is the expected
fail-closed behavior: the run is saved so you can look into it, but CW does
not make up a completed report.

Check the agent backend before a live run:

```bash
cw backend probe agent --json
```

When no command or endpoint is configured, the probe reports `ready: false`
and a reason naming the missing `CW_AGENT_COMMAND` or `CW_AGENT_ENDPOINT`.

## 3. Try A Resumable Run

Go one step forward and stop:

```bash
cw quickstart architecture-review \
  --repo /path/to/your/project \
  --question "What should I audit first?" \
  --agent-command builtin:claude \
  --resume
```

Go on with the same run:

```bash
cw quickstart architecture-review --run <run-id> --resume
```

Or, from the project's own folder (or with `--repo <path>`), the shorter
bare flag form:

```bash
cw --resume --run <run-id>
```

You can also resume through the registry:

```bash
cw run resume <run-id> --drive
```

The default `run resume` view is read-only. Adding `--drive` hands the waiting
work to the existing agent delegation loop.

## From A Source Checkout

```bash
cd plugins/cool-workflow
npm install
npm run build
node scripts/cw.js app list
node scripts/cw.js demo tamper
```

Run the deterministic integration proof:

```bash
npm run golden-path
```

It walks the full path end to end: app validation, planning, dispatch, worker
output, candidate selection, verifier-gated commit, report generation, status,
and graph views.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| `status: blocked` | Configure an agent with `--agent-command`, `CW_AGENT_COMMAND`, or `CW_AGENT_ENDPOINT`. |
| `claude: command not found` | Install Claude Code or use another agent command. |
| You want to see the next action only | Add `--preview`; it is read-only. |
| You want one step at a time | Add `--resume`, then go on with the printed `--run <run-id>` command. |
| You need a shorter review | Try `architecture-review-fast`; see [Workflow Apps](Workflow-Apps.md). |

## Next Pages

- [Workflow Apps](Workflow-Apps.md)
- [Trust And Audit](Trust-And-Audit.md)
- [Recovery And Restore](Recovery-And-Restore.md)
