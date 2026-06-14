# Dogfood: real `builtin:claude` agent + `run resume --drive` (2026-06-14)

A live dogfood run with a REAL external agent (`CW_AGENT_COMMAND=builtin:claude`, the
bundled read-only claude wrapper). The model ran in the agent's own process; CW
spawned it and recorded the attested output — CW holds no API key and imports no
model SDK. This run had two purposes and delivered both: it confirmed the real-agent
delegation path works end to end, and — because it exercised the **CLI** rather than
the unit-test function path — it **caught a real shipped bug** in `run resume --drive`.

## What ran

- `cw run architecture-review --drive --once --repo <tmp> --question "…"` with a real
  `builtin:claude` agent: **1 worker completed** end-to-end with zero hand-written
  result.md — the worker's `result.md` was produced by real claude, passed the
  evidence-gated acceptance, and a `report.md` (7.5 KB, "# Architecture Review …")
  + 3 state commits were written. The real-agent path (spawn → attested output →
  evidence gate → commit) works.
- Run: `architecture-review-20260614T104416Z-upkor2`, status `in-progress` (1/14)
  after the single `--once` step.

## The bug it caught (and the fix)

Resuming the partway run with `cw run resume <id> --drive` failed:
`cw: Workflow app not found: resume`. The `run` command's early `--drive` branch
(the `cw run <app> --drive` one-command form) intercepted the invocation *before* the
subcommand switch, so the `resume` keyword was misread as an app name and never
reached the `runResume` continuation shipped in #155.

The A1 unit smoke (`run-resume-drive-smoke`) had tested `runResume()` **directly**, so
it never exercised the CLI dispatch — only a real CLI run surfaced it. Fixed by
guarding the early app-drive route so a leading run-registry subcommand keyword
(resume/show/export/…) falls through to the switch; `run-resume-drive-smoke` now drives
`cw run resume <id> --drive` through the actual CLI and asserts it routes to the verb,
plus a regression guard that `run <app> --drive` still routes to the app drive.

## Takeaway

Unit tests that call the capability function directly can miss CLI-dispatch bugs.
Every both-surface verb that adds a flag wants at least one test through the real CLI
argv path, not just the exported function.
