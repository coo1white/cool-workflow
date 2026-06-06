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

## Boundary

CW v0.1.1 does not provide managed cloud infrastructure. It provides a local
routine bridge that can be connected to GitHub Actions, webhooks, cron, or a
small HTTP adapter in a future release.
