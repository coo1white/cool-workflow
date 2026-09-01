# Spec: close CW's AI-native SDLC gaps

Intent: [2026-09-01-sdlc-gap-closure.md](2026-09-01-sdlc-gap-closure.md)
Written by the design role; work is sent out and checked by a manager
role; separate executor sessions implement. Flagged concerns are in
each workstream's Risk notes below.

## Source of truth (playbook "linkage" rule)

- Intent and spec: THIS folder, in git.
- Per-change plan: the PR body (Capability / Implementation / Tests /
  Risk) — the repo's stated record system. Every PR in this program
  carries a Chain line naming this intent and spec by path.
- The audit trail: the PR history plus each run's own `.cw/` record.

## Workstreams

### WS1 — run <-> PR linkage (SHIPPED, PR #584)

`run link <run-id> --url <url> [--kind pr|issue|ticket] [--note ...]`
plus `cw_run_link`: an append-only `{url, kind, note?, addedAt, actor}`
list on the run record; `run show` and `report.md` render a `## Links`
section only when links exist; `run export` carries them. No network
call — it records a link, it never calls the forge. A follow-up PR
pins the smoke's rendered-line assertions (CodeQL finding).
Size: 407 net lines, 4 new files, 0 new .md.

### WS3 — control bands, the maintain-stage arc (IN BUILD)

Two verbs only. `bands check --config <bands.json> --input <metrics.json>`:
pure, deterministic three-sigma evaluation; breach tier (none|1|2|3)
in the payload; exit 0 on a clean read, non-zero fail-closed on a bad
config/input. `bands record` adds: tier >= 2 writes an intent artifact
(markdown, the playbook shape, template lives as a string in code)
under `.cw/intents/`, tier 3 may also `--queue` it via the existing
queue. CW never watches or schedules this itself — the trigger layer
is the caller's (CI cron or the existing `routine`). JSON config, not
YAML (zero-dependency rule). Math in core/ (pure, injectable now);
I/O in shell/.
Budget: <= 900 net src+test lines; exactly ONE new .md
(`docs/control-bands.7.md`); core source-context stays under 54000.

### WS2a — app-code honesty label (QUEUED, after WS3)

Run provenance records `appCode: { path, trustedRoot, execution:
"in-process-unsandboxed" }` when a workflow app's code is loaded; one
Trust Audit report line; a plain man-page section saying the sandbox
contract covers delegated workers only. Real containment is parked in
BACKLOG, not implemented here.
Budget: <= 200 net lines; ZERO new .md.

### WS0 (stretch) — steering-config regression gate

A non-required CI job that runs the reviewer/eval smokes when
AGENTS.md or `plugins/cool-workflow/agents/**` change. Zero new .md.

### WS5 (stretch) — growth-budget gate

`manifest/growth-budget.json` pinning repo-wide .md count and src
comment-line count; `scripts/growth-budget-check.js` (<= 120 lines)
wired as `growth:check` + a release-check line; one smoke with teeth.
Documented in the existing release-tooling.7.md. <= 300 net lines,
zero new .md.

## Standing rules from this program's rulings

- Source-context `core` budget is 54000 (raised from 52000 with the
  measured numbers in commit ce74b1e4; the pin stays exact equality).
  Pushing past it is an escalation, never a bigger raise by default.
- Size discipline: every acceptance report states net lines, new
  files, new .md count, and core-profile headroom.
- No `.includes(<url>)`-shaped checks anywhere, tests included —
  anchored whole-line `assert.match` instead (CodeQL
  `js/incomplete-url-substring-sanitization`).
- When a non-required check (for example CodeQL) is treated as
  blocking on an open PR, auto-merge is taken off FIRST and re-armed
  only after the fix lands on that branch (incident, PR #584).
- Internal planning labels (WS1, WS3, ...) never go into committed
  text; `Evidence:` comments cite only in-tree files.

## Status ledger

Program COMPLETE 2026-09-01. All work merged; no branch or open
code-scanning alert left behind.

| Workstream | State | PR |
|---|---|---|
| WS4 backlog rows | merged | #583 |
| WS1 run link | merged | #584 |
| WS1 follow-up (assert pin) | merged | #586 |
| Intent/spec chain | merged | #585 |
| WS3 control bands | merged | #587 |
| WS2a app-code label | merged | #588 |
| WS5 growth-budget gate | merged | #589 |
| WS0 steering-config gate | merged | #590 |

Closing numbers: conformance 106/106 on every code PR; test:gate
ended 264/264; core source-context 52508 of 54000; growth budget
md 128/135, src comment lines 7210/7571. Fix rounds fell 2 -> 2 -> 0
-> 0 -> 0 as each caught defect became a rule in the next task
prompt — that transfer is the reusable result.
