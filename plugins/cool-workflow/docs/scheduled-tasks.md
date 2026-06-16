# Scheduled Tasks

CW scheduled tasks let you make looping prompts, cron-like schedules, one-shot
reminders, expiration, jitter, and clear completion.

CW keeps schedules in:

```text
.cw/schedules/tasks.json
```

## Commands

Make a `/loop`-ready schedule:

```bash
node scripts/cw.js loop \
  --intervalMinutes 30 \
  --prompt "Check this workflow and continue if work is due."
```

Make a loop:

```bash
node scripts/cw.js schedule create \
  --kind loop \
  --intervalMinutes 30 \
  --prompt "Check this workflow and continue if work is due."
```

Make a cron schedule:

```bash
node scripts/cw.js schedule create \
  --kind cron \
  --cron "*/15 * * * *" \
  --prompt "Run the due workflow scan."
```

Make a reminder:

```bash
node scripts/cw.js schedule create \
  --kind reminder \
  --delayMinutes 60 \
  --prompt "Remind me to inspect the report."
```

List and look through:

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

Run the local desktop-like daemon one time:

```bash
node scripts/cw.js schedule daemon --once
```

Run it without stopping:

```bash
node scripts/cw.js schedule daemon --intervalSeconds 60
```

## Notes

- Time is measured to the minute.
- By default, expiration comes after 7 days.
- `jitterSeconds` can put space between runs.
- CW does not start the daemon by default. Use `schedule daemon`, cron, or
  some other overseer to call `schedule due` and run due prompts.
