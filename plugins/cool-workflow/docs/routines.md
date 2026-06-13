# Routines

CW routines define a trigger, an event payload, match rules, and a generated
prompt that an agent host can execute.

CW stores routine data in:

```text
.cw/routines/triggers.json
.cw/routines/payloads/
```

## Commands

Create an API trigger:

```bash
node scripts/cw.js routine create \
  --kind api \
  --prompt "Handle this API event."
```

Create a GitHub trigger:

```bash
node scripts/cw.js routine create \
  --kind github \
  --prompt "Review this GitHub event." \
  --match '{"action":"opened"}'
```

Fire a trigger from a payload file:

```bash
node scripts/cw.js routine fire github payload.json
```

Inspect events:

```bash
node scripts/cw.js routine events
```

## Long Architecture Reviews

Use `architecture-review-fast` for the foreground user path, then schedule the
full `architecture-review` app as background work when a deep audit should not
block an interactive session:

```bash
node scripts/architecture-review-fast.js \
  --repo /path/to/repo \
  --question "Is this architecture sound?" \
  --metrics \
  --schedule-full
```

The wrapper creates a one-shot reminder schedule whose `workflowId` is
`architecture-review`. The schedule prompt is policy. CW stores the schedule and
records due events; the external agent host decides how to run the long review.
The prompt includes the foreground fast run id, fast report path, source-context
digest/profile, and asks the background agent to return the full review report
path and digest.
The `--metrics` flag is optional and reports foreground elapsed time plus
agent-spawn and result-cache-hit counts for the fast run.

## Boundary

CW v0.1.1 does not provide managed cloud infrastructure. It provides a local
routine bridge that can be connected to GitHub Actions, webhooks, cron, or a
small HTTP adapter in a future release.
