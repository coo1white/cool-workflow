# Routines

A CW routine has a trigger, an event payload, match rules, and a prompt it makes
for an agent host to run.

CW keeps routine data in:

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

Use `architecture-review-fast` for the foreground user path. Then put the
full `architecture-review` app in line as background work when a deep look-over
should not get in the way of a back-and-forth session:

```bash
node scripts/architecture-review-fast.js \
  --repo /path/to/repo \
  --question "Is this architecture sound?" \
  --metrics \
  --schedule-full
```

The wrapper makes a one-shot reminder schedule whose `workflowId` is
`architecture-review`. The schedule prompt is policy. CW keeps the schedule and
notes down due events; the outside agent host says how to run the long review.
The prompt has in it the foreground fast run id, fast report path, source-context
digest/profile, and it asks the background agent to give back the full review
report path and digest.
The `--metrics` flag is not required and it gives back foreground time used plus
agent-spawn and result-cache-hit counts for the fast run.

## Boundary

CW v0.1.1 does not give managed cloud infrastructure. It gives a local
routine bridge that may be joined to GitHub Actions, webhooks, cron, or a
small HTTP adapter in a later release.
