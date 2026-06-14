# Quickstart

## Requirements

- Node.js 18 or newer.
- An external agent command for live reviews, such as Claude Code, Codex, or an
  HTTP agent endpoint.

The tamper-evidence demo does not need an agent, API key, or cloned repo.

## 1. Prove The Integrity Demo

```bash
npx cool-workflow demo tamper
```

Expected result: stdout ends with a `VERDICT: tamper-evidence holds` line. The
demo builds a signed telemetry ledger, edits it in two different ways, and shows
both edits being detected offline.

For a scriptable proof payload:

```bash
npx cool-workflow demo tamper --json
```

The JSON includes `proven: true`, the number of ledger records, and one result
per tamper layer.

## 2. Run A Real Repo Review

```bash
npx cool-workflow quickstart architecture-review \
  --repo /path/to/your/project \
  --question "What are the main risks in this codebase?" \
  --agent-command builtin:claude
```

The command prints JSON that includes a `runId`, status, worker counts, and a
`reportPath`.

Read the report:

```bash
cat /path/to/your/project/.cw/runs/<run-id>/report.md
```

If the agent is not configured, CW returns `status: blocked`. That is expected
fail-closed behavior: the run is saved for triage, but CW does not fabricate a
completed report.

Check the agent backend before a live run:

```bash
cw backend probe agent --json
```

When no command or endpoint is configured, the probe reports `ready: false` and
a reason naming the missing `CW_AGENT_COMMAND` or `CW_AGENT_ENDPOINT`.

## 3. Try A Resumable Run

Advance one step and stop:

```bash
cw quickstart architecture-review \
  --repo /path/to/your/project \
  --question "What should I audit first?" \
  --agent-command builtin:claude \
  --resume
```

Continue the same run:

```bash
cw quickstart architecture-review --run <run-id> --resume
```

You can also resume through the registry:

```bash
cw run resume <run-id> --drive
```

The default `run resume` view is read-only. Adding `--drive` hands pending work
to the existing agent delegation loop.

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

It exercises app validation, planning, dispatch, worker output, candidate
selection, verifier-gated commit, report generation, status, and graph views.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| `status: blocked` | Configure an agent with `--agent-command`, `CW_AGENT_COMMAND`, or `CW_AGENT_ENDPOINT`. |
| `claude: command not found` | Install Claude Code or use another agent command. |
| You want to see the next action only | Add `--preview`; it is read-only. |
| You want one step at a time | Add `--resume`, then continue with the printed `--run <run-id>` command. |
| You need a shorter review | Try `architecture-review-fast`; see [Workflow Apps](Workflow-Apps.md). |

## Next Pages

- [Workflow Apps](Workflow-Apps.md)
- [Trust And Audit](Trust-And-Audit.md)
- [Recovery And Restore](Recovery-And-Restore.md)
