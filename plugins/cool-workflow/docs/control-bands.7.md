# CONTROL-BANDS(7)

## NAME

`cw bands` — turn a metric breach into a queued, reviewable work item

## SYNOPSIS

```text
node dist/cli.js bands check --config <bands.json> --input <metrics.json> [--json]
node dist/cli.js bands record --config <bands.json> --input <metrics.json> [--queue] [--json]
```

## DESCRIPTION

CW already has triggers, a queue, rerun lineage, and gates that fail
closed. What it did not have was a "maintain" step: something that turns
a metric going out of band into a queued, reviewable work item, with no
model call anywhere in the check.

`cw bands` is that step. It has only two verbs, on purpose, so the
surface stays small:

- **`bands check`** reads a config file and a metrics input file, works
  out the breached tier, and prints the result. It never writes a file.
  A breach is a normal, successful result — not an error. An unreadable
  or bad-shaped config or input file fails closed (a non-zero exit).
- **`bands record`** runs the same check. On tier 2 or 3 it writes an
  **intent file**. On tier 3 only, with `--queue`, it also adds the
  intent to the run queue that is already there (`cw queue add`).

CW never watches a metric, polls anything, or runs on a timer by itself.
Something else — a CI cron job, or CW's own `cw routine`/`cw schedule` —
must call `bands check`/`bands record` when it is time to look.

## THE THREE-SIGMA RULE

The config's `baseline` field carries a mean and a standard deviation
(`stddev`) for the metric, already worked out from past data. The input
file gives the current reading, as one of:

- `{"value": 165}` — one number, used as-is.
- `{"series": [160, 170, 165]}` — a list of numbers; CW works out this
  list's own mean and standard deviation, and uses the mean as the
  current reading (the standard deviation is reported too, as extra
  proof, but does not change the tier).

The tier is the largest `k` in `{1, 2, 3}` such that the reading is at
least `k` standard deviations away from the baseline mean, in EITHER
direction (up or down); under one standard deviation away, the tier is
`none`. This is the only rule this build has (`"rules": "three-sigma"`
is the one accepted value). The Western Electric rules — flagging a RUN
of points, not one reading — are an open extension, not built yet.

## CONFIG FILE

Plain JSON (this project ships no YAML parser and adds no dependency to
gain one, so config files here are JSON, never YAML):

```json
{
  "metric": "checkout_latency_ms",
  "rules": "three-sigma",
  "window": "7d",
  "baseline": { "mean": 120, "stddev": 15 },
  "affectedSystems": ["checkout-service"],
  "tiers": {
    "1": { "outcome": "Watch: log the reading, no ticket yet." },
    "2": { "outcome": "Open an intent for the metric owner to look at." },
    "3": { "outcome": "Queue urgent work: page on-call." }
  }
}
```

`window` and `affectedSystems` are free text for the intent file; they
change nothing about the tier math.

## THE INTENT FILE

On tier 2 or 3, `bands record` writes one markdown file at
`.cw/intents/<stamp>-<metric>.md` (the repo the command runs in), where
`<stamp>` is the injected `now` and `<metric>` is the config's metric
name, both cut down to a safe file name. Fields:

- **Problem** — the metric, the reading, the tier, the window.
- **Evidence** — the sha256 digest of the input file and of the config
  file, so the intent can be checked against the exact files that made
  it.
- **Proposed outcome** — the one line from the config's `tiers` block for
  the tier that was hit.
- **Affected systems** — from the config's `affectedSystems` list.
- **Open questions** — two standing questions worth asking before acting
  on the intent.

Given the SAME config, input, and `now`, the intent file is byte-for-byte
the same every time — `now` is the only piece of it that ever changes,
and it is always given in by the caller (the CLI passes the real wall
clock), never read from a clock inside the check itself.

## TIER SEMANTICS (MECHANISM, NOT POLICY)

A flag can never reach past what its tier allows:

| Tier | `bands record` writes | `--queue` |
| --- | --- | --- |
| none / 1 | nothing | ignored |
| 2 | an intent file | ignored |
| 3 | an intent file | adds the intent to the queue |

## WIRING EXAMPLES

**With `cw routine`** (a local trigger already in CW): make a routine
whose prompt runs the check, and fire it from CI on a schedule:

```bash
cw routine create --kind api --prompt "Run: cw bands record --config bands/checkout-latency.json --input /tmp/reading.json --queue"
cw routine fire api /tmp/routine-event.json
```

**With plain CI cron** (no CW trigger at all — a scheduled job just
calls the CLI):

```yaml
# .github/workflows/bands.yml (illustration only)
on:
  schedule:
    - cron: "*/15 * * * *"
jobs:
  bands:
    runs-on: ubuntu-latest
    steps:
      - run: node dist/cli.js bands record --config bands/checkout-latency.json --input reading.json --queue
```

Either way, CW itself never starts the clock — it only runs the check
when asked.

## CLI

```text
cw bands check --config <path> --input <path> [--json]
cw bands record --config <path> --input <path> [--queue] [--json]
```

## MCP

`cw_bands_check` and `cw_bands_record` are declared in the capability
registry (`src/core/capability-data.ts`) next to their CLI rows, so
`cw bands check --json` and `cw_bands_check`'s result carry the same
data. See [cli-mcp-parity.7.md](cli-mcp-parity.7.md).

## EXIT CODES

| Exit | Meaning |
| --- | --- |
| 0 | Command done — including a breach; a breach is not an error |
| 1 | Error (missing/bad config or input, bad flags) |

## SEE ALSO

control-plane-scheduling(7) — the queue `bands record --queue` adds into
routine(7) — the trigger bridge one wiring example above uses
cli-mcp-parity(7)
