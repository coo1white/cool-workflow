# ROUTINE(7)

## NAME

`cw routine` — make and manage trigger-based workflow routines

## SYNOPSIS

```text
node dist/cli.js routine create --kind api|github --prompt PROMPT [--match JSON]
node dist/cli.js routine list [--kind KIND]
node dist/cli.js routine delete <trigger-id>
node dist/cli.js routine fire <kind> <payload-file>
node dist/cli.js routine events [<trigger-id>]
```

## DESCRIPTION

`cw routine` is the local trigger bridge for CW. It lets you make named
triggers that fire when something happens — an API event, a GitHub webhook, or
another outside signal. Each trigger carries a prompt template; when fired,
the prompt gets filled with the event data and handed to an agent host.

CW keeps routine data in:

```text
.cw/routines/triggers.json
.cw/routines/payloads/
```

CW itself does not run a web server or listen for webhooks. The routine bridge
is a local data store that can be joined to GitHub Actions, webhooks, cron, or
a small HTTP adapter.

## COMMANDS

**create**
: Make a new trigger. `--kind` is `api` or `github`. `--prompt` is the prompt
template the agent will see. `--match` is an optional JSON object that filters
events (for example, `{"action":"opened"}` for GitHub pull requests).

**list**
: List all triggers, or filter by kind with `--kind`.

**delete**
: Remove a trigger by its id.

**fire**
: Record an event against a trigger. Give the trigger kind and a path to a
JSON payload file. CW matches the payload against the trigger's match rules
and fills out the prompt.

**events**
: List the events that have been recorded for a trigger.

## FILES

```text
.cw/routines/triggers.json
.cw/routines/payloads/<event-id>.json
```

## EXIT CODES

| Exit | Meaning |
| --- | --- |
| 0 | Command done |
| 1 | Error (bad arguments, missing trigger, etc.) |

## SEE ALSO

cw sched — durable run-queue scheduling for workflow runs
control-plane-scheduling.7.md — the full scheduling and run management design
