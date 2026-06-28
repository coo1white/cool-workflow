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

## PDCA Blackboard Development Lessons

When a task asks for agents to work together, first try the parts CW already
has:

- workflow apps give the work shape
- worker output gives checked facts
- the blackboard gives shared state
- MCP gives tool access to the same state
- smoke tests prove the loop

Do not make a new MCP server when the existing server can show the same run
state. Add a workflow app first, then prove the app with one smoke that uses
both CLI and MCP.

For a three-agent loop, keep the order plain:

```text
plan -> build -> audit -> next action
```

Each agent should write one blackboard message and, when there is a result
file, one artifact ref. Take a snapshot after the audit and after the next
action. If audit evidence is missing, let the worker evidence gate refuse the
result instead of adding a new policy layer.

Before a PR, base the branch on `origin/main`, run the generated-doc checks,
and sync generated docs when the gate says they are stale. This keeps unrelated
local commits and generated README/index drift out of the work.

## Boundary

CW v0.1.1 does not give managed cloud infrastructure. It gives a local
routine bridge that may be joined to GitHub Actions, webhooks, cron, or a
small HTTP adapter in a later release.
