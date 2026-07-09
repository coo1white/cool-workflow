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
cw loop \
  --intervalMinutes 30 \
  --prompt "Check this workflow and continue if work is due."
```

Make a loop:

```bash
cw schedule create \
  --kind loop \
  --intervalMinutes 30 \
  --prompt "Check this workflow and continue if work is due."
```

Make a cron schedule:

```bash
cw schedule create \
  --kind cron \
  --cron "*/15 * * * *" \
  --prompt "Run the due workflow scan."
```

Make a reminder:

```bash
cw schedule create \
  --kind reminder \
  --delayMinutes 60 \
  --prompt "Remind me to inspect the report."
```

List and look through:

```bash
cw schedule list
cw schedule due
cw schedule complete <schedule-id>
cw schedule pause <schedule-id>
cw schedule resume <schedule-id>
cw schedule run-now <schedule-id>
cw schedule history <schedule-id>
cw schedule delete <schedule-id>
```

Run the local desktop-like daemon one time:

```bash
cw schedule daemon --once
```

Run it without stopping:

```bash
cw schedule daemon --intervalSeconds 60
```

## Notes

- Time is measured to the minute.
- By default, expiration comes after 7 days.
- `jitterSeconds` can put space between runs.
- CW does not start the daemon by default. Use `schedule daemon`, cron, or
  some other overseer to call `schedule due` and run due prompts.
