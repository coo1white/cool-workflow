# Resume takes a parked run to the end

Intent, spec and plan in ONE file, in the shape `AGENTS.md` "Intent
files (the playbook)" asks for. Source: the operator, 2026-09-27, "下一个
修的是 #3 --approve" (finding #3 of the real-agent Track A run,
`intent/2026-09-archive.md`, the Track A run part), then "resume功能非常重要",
then, asked whether a resume should run a parked worker again by default
or only behind a new flag, "默认就重试". This file is the record of what
was approved.

## Part 1 — Intent

**Problem.** A worker whose agent hop fails past its retry budget (3
tries) parks the run. After the cause is fixed, `cw --resume --run <id>`
gives back `parked` again, and no command takes the worker on: the only
way on is a new run. In the Track A run, 13 of 14 workers of real agent
work were done when the Verdict worker parked on an `E2BIG` in the
wrapper; all of it had to be run again. The README row "Run stopped
before the end" says `cw --resume --run <id>` "takes it to the end".

**Outcome.** A resume runs each parked worker again, with a fresh retry
budget, on the same dispatch; the run goes on to the end and its verdict
can be PASS. The park stays on the record.

**Who it touches.** `cw --resume --run <id>` and `cw run resume <id>
--drive`/`--once`. Code: `src/core/pipeline/drive-decide.ts` (which
tasks), `src/shell/worker-isolation.ts` (the reopen, and resolving the
park at accept), `src/shell/error-feedback-io.ts`, `src/shell/drive.ts`
(a `reopenParked` drive option, run under the drive lock),
`src/shell/pipeline-cli.ts` and `src/shell/registry-cli.ts` (the two
resume entry points), `dist/`, the man page, two tests.

**North Star.** Track A (a first run that stops can be finished, not
started over) and Track B (the failure-recovery story).

## Measured facts (checked by command before the build)

On `main` at `7ff87c6`, Linux, Node 22, built `dist/`, the
`end-to-end-golden-path` app, the v2 conformance stub agents (one that
always fails, one that passes).

- Park, then `cw --resume --run <id>` with the passing agent: `parked`,
  one step, "no eligible worker (a parked/failed worker blocks the
  phase gate)", hint "inspect: cw run show <id>". The resume does not
  help.
- The drive can already finish the worker. With the task's `failed`
  set back by hand and the same resume: `accept`, then `commit`,
  status `complete`. No new drive logic is needed; what is missing is
  a lawful, recorded way in.
- Setting the task back alone is not enough: the report says
  `Verdict: BLOCKED`. The park wrote an open feedback record
  (`agent-delegation-parked`), and `deriveLifecycle`
  (`src/shell/run-registry-io.ts`) counts any open feedback as blocked.
  Resolving it by hand with the worker's verifier node (status
  `verified`, the proof `feedback resolve` asks for) gives
  `Verdict: PASS`; `cw audit verify` has no failed checks and
  `cw state check` says `current`.
- Set back to `pending`, the drive dispatches the task anew (a second
  `dispatch:` commit) and counts that dispatch as a retry: the fresh
  budget becomes 2 tries, not 3. Between two tries of one hop the task
  and worker are `running` (loopStage `act`), on the same dispatch; set
  back to that, the fresh budget is 3 tries and no second dispatch is
  made.
- The v2 conformance case `pipeline-park-vs-block` pins that `cw run
  --drive --once --run <id>` on a parked run blocks and never tries the
  task again. No test or case pins what `--resume` does on a parked run.
- The park is kept today as: the worker's error (code
  `agent-delegation-parked`), a failure state node, an open feedback
  record, a `worker.failure` audit event.

## Paths weighed (complexity / upkeep / cost / can it be undone)

- **A new `--retry-parked` flag, default unchanged:** strict POLA, but a
  user who reads the hint or the README still has to learn one more flag,
  the help text and its conformance fixture change, and the README
  promise stays untrue for the plain command. Turned down by the
  operator.
- **Reopen inside every drive (`run --drive` too):** breaks the
  conformance case above and the man page's "never quietly re-driven
  forever". Turned down.
- **Set the task back to `pending`:** measured above; a second dispatch
  and a budget of 2. Turned down.
- **Chosen: a resume reopens.** Only the two resume entry points pass
  `reopenParked`; under the drive lock, before the first round, each
  task parked past its retry budget goes back to the between-tries
  state with a fresh budget, one save for all. On accept, a verified
  result resolves that worker's open park feedback. Undoing it is
  removing the one option.

## Part 2 — Spec

- `cw --resume --run <id>` and `cw run resume <id> --drive`/`--once`
  reopen; plain `cw run --drive --run <id>`, `cw quickstart --run <id>`
  without `--resume`, and every fresh run do not. A drive with nothing
  to reopen is byte-identical to today.
- Reopened: a task whose status is `failed` and whose worker's LAST error
  code is `agent-delegation-parked`. A worker stopped by a sandbox or
  boundary violation, or a turned-down result, stays failed.
- The reopen: task `running`, loopStage `act`; worker `running`,
  `retryCount` 0; the same dispatch and `input.md`. One `worker.reopen`
  audit event a worker (`decision: allowed`, `source:
  operator-recorded`, the prior attempts and the park reason). The
  failure node, the feedback and the old audit events stay.
- A fresh budget each resume: if the agent still fails, the worker parks
  again after the budget. A resume never loops.
- On accept, when the verify stage advances, each open or tasked park
  feedback of that worker is resolved by the verifier node. No other
  feedback is touched.
- Output: the drive result gains `reopenedWorkers` (task ids, run order)
  only when at least one was reopened; on `run resume` it sits in the
  `drive` field. The parked hint gains the way on: "…; fix the cause,
  then: cw --resume --run <id>".
- Man page: `docs/agent-delegation-drive.7.md` (the resume part and the
  Park bullet). The old build's hint list in
  `project/docs/rebuild/SPEC/workflow-apps.md` is brought up to date.

## Part 3 — Plan

- **PR 1 (build):** this file, the code above, the unit test
  `test/core/pipeline/drivedecide-reopenparked.test.js`, the smoke
  `test/resume-parked-smoke.js` (black box through `scripts/cw.js`: one
  task parked, `run --drive` still blocked, a resume while the agent
  still fails gets 3 fresh tries and parks again, a fixed resume
  completes with PASS, both parks resolved by the verifier node, both
  failure nodes kept, one dispatch, two `worker.reopen` events, the
  audit chain verifies, a resume with nothing parked adds no key; a
  worker parked in a parallel phase next to one that passed; a boundary
  violation not reopened), the man page.
- **PR 2 (close):** a real-agent receipt (a run parked by a broken agent
  command, then resumed with the real claude CLI to PASS), the sections
  below, archive.

## Acceptance

- The smoke and the unit test fail on `main` and pass with PR 1.
- The v2 conformance suite passes unchanged (`pipeline-park-vs-block`
  above all).
- A real agent: a run parked, then resumed after the fix, ends with
  `Verdict: PASS` and the park on record.

## Architecture snapshot diff (claims this program makes stale)

Filled by the closing PR.

## What this spec got wrong (recorded at close)

Filled by the closing PR.

## Status ledger

| Item | State | PR |
|---|---|---|
| Intent + measured facts (this file) | done | PR 1 |
| Build: reopen on resume, resolve the park on accept, tests, man page | in review | PR 1 |
| Close: real-agent receipt, archive | not started | |
