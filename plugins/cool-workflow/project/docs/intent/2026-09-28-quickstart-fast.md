# One focused question, fewer workers: `cw -q --fast`

Intent, spec and plan in ONE file, in the shape `AGENTS.md` "Intent
files (the playbook)" asks for. Source: the operator, 2026-09-28, "做
#4：窄问题少派 worker" (finding #4 of the real-agent Track A run,
`intent/2026-09-archive.md`, the Track A run part). Asked to choose
between a new `--fast` flag, making the fast app the `cw -q` default,
and trimming Map workers by repo, the operator chose "新增 --fast". This
file is the record of what was approved.

## Part 1 — Intent

**Problem.** `cw -q "<question>"` always plans the 14-worker
`architecture-review`, whatever the question. A narrow question (the
Track A run: "How does routing work end-to-end here?" on Express) ran
Map workers for web client, database, deploy and jobs domains the repo
does not have, and the complete run took 409 s, over the Track A 5
minutes.

**Outcome.** One flag gives a focused question the 6-worker
`architecture-review-fast` app, which already exists; the default stays
the full review, byte-for-byte.

**Who it touches.** `cw -q`/`cw quickstart` (`--fast`), its help text,
its terminal summary. Code: `src/shell/pipeline-cli.ts`,
`src/wiring/capability-table/pipeline.ts`, `dist/`; the v2 help fixtures
for `quickstart` and its alias `audit-run`; the README (root and npm),
`docs/agent-delegation-drive.7.md`, `docs/canonical-workflow-apps.7.md`;
one smoke.

**North Star.** Track A: an external user's first question answered in
under 5 minutes from the README.

## Measured facts (checked by command before the build)

On `main` at `828a6b7`, Linux, Node 22, built `dist/`, the real claude
CLI, a clone of Express, the question above, one run each.

- The default app, twice: 409 s and 412 s, `Verdict: PASS`. By phase:
  Map 192 s / 152 s, Assess 86 s / 87 s, Verify 73 s / 121 s, Verdict
  57 s / 59 s. Verify and Verdict each read 107 to 126 KB of earlier
  results.
- A Map phase lasts as long as its slowest worker, and the slow one
  moves: in the first run 5 Map workers were done in 36 to 62 s and
  `transport-core` (a domain the question needs) took 192 s; in the
  second, `web-client` (one Express does not have) took 152 s. So
  cutting the absent domains alone does not reliably cut the wait.
- A copy of the default app with only the two Map workers that fit the
  question (`server-api`, `transport-core`; 10 workers, not committed):
  258 s, Map 46 s, Verify and Verdict inputs 74 and 88 KB, PASS.
- `architecture-review-fast` (6 workers: 2 Map, 2 Assess, Verify,
  Verdict): 230 s, Map 64 s, inputs 51 and 63 KB, PASS.
- The three answers agree: the same call chain
  (`http.createServer(app)` -> `app.handle` -> the lazily built Router
  -> `Router.handle` over Layers -> `Route.dispatch`), all citing
  `lib/router/index.js`, `lib/router/route.js` and `lib/router/layer.js`.
  Findings 21 / 17 / 14, evidence 27 / 17 / 24.
- An app's factory gets no input values (`createWorkflowApi`,
  `src/core/workflow-apps/app-schema.ts`): planning by repo or question
  would need a new kernel mechanism.
- The v2 conformance suite pins that `cw -q` defaults to
  `architecture-review` (`cli-quickstart-redirect`) and that the app has
  14 tasks (`multiagent-app-list`). `quickstart` is CLI-only (no MCP
  peer), so a new flag has no parity cost.

## Paths weighed (complexity / upkeep / cost / can it be undone)

- **`cw -q` defaults to the fast app, `--full` for the 14:** no flag to
  learn; but it changes what the core command means (POLA), two
  conformance cases, the README, man pages and several smokes. Turned
  down by the operator.
- **Trim Map workers by repo at plan time:** 258 s measured; needs a new
  plan-time mechanism in the kernel and file heuristics that a broad
  question could be hurt by, and changes the pinned 14 tasks. Turned
  down.
- **Chosen: `--fast`.** One flag picks the existing fast app when no app
  is named. Undoing it is removing the flag.

## Part 2 — Spec

- `cw -q "<q>" --fast` (and `cw quickstart --fast`) plans
  `architecture-review-fast`. Without `--fast`, nothing changes: the
  same app, 14 workers, the same payload.
- `--fast` next to a named app other than `architecture-review-fast` is
  refused before anything is planned: "--fast runs
  architecture-review-fast; it cannot be used with the app <id>. Drop
  --fast or the app name." With that app named, it is allowed.
- `--fast` is a runtime key, never a plan input (`run.inputs` has no
  `fast`).
- `--check` with `--fast` checks the fast app; its `nextCommand` names it.
- `cw help quickstart` (and `audit-run`) list `--fast`; the two v2 help
  fixtures gain that line.
- On a terminal, a finished default review's summary ends with one line:
  "Faster for one question: add --fast (6 workers in place of 14)".
  `--json` and piped output do not change.
- README step 2 names `--fast` in one line; the man pages say what it
  runs and what was measured.

## Part 3 — Plan

- **PR 1 (build):** this file, the code, `test/quickstart-fast-smoke.js`
  (black box through `scripts/cw.js`: `--fast` runs 6 workers to the end
  and adds no input; the default stays 14; the summary line appears once
  and only on a finished default review; `--fast` with another app is
  refused with nothing planned, with its own app allowed; `--check` and
  help name the fast app), the help fixtures, the docs.
- **PR 2 (close):** a real-agent receipt of `cw -q "<q>" --fast -claude`
  from the README, the sections below, archive.

## Acceptance

- The smoke fails on `main` and passes with PR 1.
- The v2 conformance suite passes, `cli-quickstart-redirect` and
  `multiagent-app-list` unchanged.
- A real agent: the README's `--fast` command on a real repository
  completes under 5 minutes with a cited answer.

## Architecture snapshot diff (claims this program makes stale)

Filled by the closing PR.

## What this spec got wrong (recorded at close)

Filled by the closing PR.

## Status ledger

| Item | State | PR |
|---|---|---|
| Intent + measured facts (this file) | done | PR 1 |
| Build: `--fast`, help, summary line, docs, smoke | in review | PR 1 |
| Close: real-agent receipt, archive | not started | |
