# Scheduled Tasks

CW scheduled tasks support looping prompts, cron-like schedules, one-shot
reminders, expiration, jitter, and explicit completion.

CW stores schedules in:

```text
.cw/schedules/tasks.json
```

## Commands

Create a `/loop`-compatible schedule:

```bash
node scripts/cw.js loop \
  --intervalMinutes 30 \
  --prompt "Check this workflow and continue if work is due."
```

Create a loop:

```bash
node scripts/cw.js schedule create \
  --kind loop \
  --intervalMinutes 30 \
  --prompt "Check this workflow and continue if work is due."
```

Create a cron schedule:

```bash
node scripts/cw.js schedule create \
  --kind cron \
  --cron "*/15 * * * *" \
  --prompt "Run the due workflow scan."
```

Create a reminder:

```bash
node scripts/cw.js schedule create \
  --kind reminder \
  --delayMinutes 60 \
  --prompt "Remind me to inspect the report."
```

List and scan:

```bash
node scripts/cw.js schedule list
node scripts/cw.js schedule due
node scripts/cw.js schedule complete <schedule-id>
node scripts/cw.js schedule pause <schedule-id>
node scripts/cw.js schedule resume <schedule-id>
node scripts/cw.js schedule run-now <schedule-id>
node scripts/cw.js schedule history <schedule-id>
node scripts/cw.js schedule delete <schedule-id>
```

Run the local desktop-style daemon once:

```bash
node scripts/cw.js schedule daemon --once
```

Run it continuously:

```bash
node scripts/cw.js schedule daemon --intervalSeconds 60
```

## Notes

- Resolution is minute-level.
- Default expiration is 7 days.
- `jitterSeconds` can spread runs.
- CW does not start the daemon by default. Use `schedule daemon`, cron, or
  another supervisor to call `schedule due` and execute due prompts.
