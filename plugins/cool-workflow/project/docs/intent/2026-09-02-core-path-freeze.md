# The core path is named, the rest is frozen

Intent and spec in ONE file, in the shape `AGENTS.md` "Intent files (the
playbook)" asks for. Source: the operator asked on 2026-09-02 whether
this project is a minimum viable product. The answer, measured below,
was "no: a wide platform with a thin proven core". The operator agreed
to write the boundary down as the next program.

## Intent

A person should be able to read one place and know which part of Cool
Workflow is the product that has been proved to work, and which part is
kept working but not grown. Today every surface is presented at the
same weight: 244 capability rows, ten apps, 53 wiki pages. The proved
part is one path: ask a question, get a saved report with every claim
tied to a line, check your setup, resume a stopped run. This program
names that path in the North Star, lists the frozen surfaces beside it,
and gives the freeze teeth: a line-count ceiling per frozen path that
`growth:check` fails closed on. Nothing is deleted. Fixes stay allowed
everywhere; new verbs, rows, flags, or files on a frozen surface need
the operator's written yes in an intent first.

## Measured facts (checked by command before design)

- The two receipts under `plugins/cool-workflow/project/docs/audits/`
  (`four-fixes-receipt-2026-09-02.json`, `run-folder-receipt-2026-09-02.json`)
  prove one path on a real project with the Claude agent: `cw`,
  `cw help`, `cw doctor`, `cw demo tamper`, `cw app list`,
  `cw -q "<question>" -claude`, `cw --resume --run <id>`,
  `cw run resume <id> --drive --repo <path>`, `cw doctor --onramp`, and
  reading `.cw/runs/<id>/report.md`. A full run: 14 workers, four
  stages, 22 directories, all with files.
- Size, counted with `wc -l` on `git ls-files`: `src/shell/` 27,403
  lines in 73 files; `src/core/` 12,950 lines. Inside core:
  `multi-agent/` 4,251, `state/` 4,151, `pipeline/` 1,857, `trust/`
  929, `workflow-apps/` 856, `format/` 774.
- The `cw -q` path, by imports: `cli/entry.ts` → `shell/pipeline-cli.ts`
  → `pipeline.ts`, `dispatch.ts`, `drive.ts`, `worker-isolation.ts`,
  `run-store.ts`, `report.ts`, `commit.ts`, `node-store.ts`,
  `trust-audit.ts`, `observability.ts`, `onramp.ts`, `agent-config.ts`,
  `workflow-app-loader.ts`, `sandbox-profile.ts`, `fs-atomic.ts`.
  Resume adds `registry-cli.ts` and `run-registry-io.ts`. The platform
  files are reached from this path only through `report.ts`
  (`coordinator-io`, `candidate-scoring-io`, `multi-agent-io`,
  `multi-agent-operator-ux`, `state-explosion-cli`) and
  `worker-isolation.ts` (`multi-agent-io`, `error-feedback-io`), and
  every one of those calls now survives a missing directory (run-folder
  program).
- Platform surfaces with no proved user path, by file: in `src/shell/`,
  `multi-agent-cli.ts` 1,000, `multi-agent-host.ts` 614,
  `multi-agent-io.ts` 381, `multi-agent-operator-ux.ts` 670,
  `coordinator-io.ts` 563, `topology-io.ts` 444,
  `candidate-scoring-io.ts` 471, `eval-io.ts` 449, `eval-text.ts` 198,
  `scheduler-io.ts` 730, `scheduling-io.ts` 329,
  `collaboration-io.ts` 259, `workbench.ts` 269, `workbench-host.ts`
  340, `workbench-text.ts` 18, `bands-io.ts` 97,
  `state-explosion-cli.ts` 193, `orchestrator.ts` 229,
  `telemetry-demo.ts` 410, `evidence-reasoning.ts` 748,
  `observability-intake.ts` 82, `reclamation-io.ts` 1,728; in
  `src/core/`, `multi-agent/` 4,251 and `state/state-explosion/`. The
  four BACKLOG design rows (purity baseline, async lock,
  schedule/routine/sched, containment) all sit on these surfaces.
- The README "What You Can Run" part already says four apps are "the
  main lanes" and puts multi-agent under "when you need it". The North
  Star in `AGENTS.md` has tracks A, B, C and sends other work to
  BACKLOG, but names no surface as frozen.
- `scripts/growth-budget-check.js` reads `manifest/growth-budget.json`
  (two ceilings: tracked .md count, src comment lines), counts from
  `git ls-files`, fails closed with a message that says slim first and
  raise the cap only with a fresh measured number. Its smoke,
  `test/growth-budget-check-smoke.js`, is 76 lines with one positive and
  one teeth case on a fixture repo.
- md count: 135/135 on main. This spec PR joins the two closed intents
  of 2026-09-02 (`backlog-six-rows`, `new-user-four-fixes`) into
  `intent/2026-09-archive.md`, text kept as is, and adds the archive
  rule to `AGENTS.md`, so the count stays 135 with this file. The
  receipt JSON names a program by its name, not a path, so nothing
  breaks.

## Paths weighed (complexity / upkeep / cost / can it be undone)

- The platform code: (1) delete it: throws away tested work and the
  BACKLOG design rows, and a delete of 15,000 lines is not cheap to
  undo; (2) freeze by words only in `AGENTS.md`: no teeth, the next
  program forgets it; (3) freeze by words plus a per-path line ceiling
  in `growth-budget.json`, checked by the gate that already runs on
  every PR: about 25 lines of script, undone by deleting the list.
  Chosen: 3.
- What "frozen" allows: (a) nothing at all: then a bug on a frozen
  surface cannot be fixed; (b) fixes and deletions, no growth: a fix
  that must add lines pays by cutting lines on the same surface, or
  gets the operator's yes in an intent. Chosen: b.
- md room: (a) raise the .md cap by one with the measured number, as
  the gate's own message allows; (b) join closed intents by month.
  Chosen: b, with the rule written down so it is not a one-off.
- Effect framework: rejected for good (see the archive).

## Rules for every PR in this program

Same as the last three programs: own worktree first (`git worktree add`
to a named path, then `npm ci` in `plugins/cool-workflow`), Plan in the
PR body before code, all gates run before push with the pass lines
quoted, CodeQL green before auto-merge, max 3 rounds, the manager reads
the pushed diff, no worker stops a process it did not start, no worker
touches `manifest/growth-budget.json` except the one this spec names.
Basic English in every changed doc line.

## The North Star names the core path (docs PR)

Files: `AGENTS.md`, root `README.md` (then `npm run sync:readme`),
`plugins/cool-workflow/project/docs/wiki/Home.md`.

1. `AGENTS.md` "# North Star" gets two parts after the three tracks,
   at most 16 lines together. "Core path": the ten commands from the
   measured facts and the files on the `cw -q` path, with the two
   receipts as the proof. "Frozen surfaces": the list from the measured
   facts, one line per group (multi-agent, coordinator and topology,
   candidates and eval, scheduling, collaboration and workbench,
   bands, state explosion, orchestrator, telemetry demo, evidence
   reasoning, observability intake, reclamation), and the rule: fixes
   and deletions only; growth needs the operator's yes in an intent;
   `growth:check` enforces the ceiling.
2. README, under "What You Can Run", one sentence after "the main
   lanes": these lanes and the commands in the User Guide are the core
   path; the rest is kept working, not grown. `Home.md` gets the same
   sentence under "What CW does".
3. Plan step, measured before code: confirm each frozen file in the
   list exists on `origin/main` and is not imported by `cli/entry.ts`
   or `shell/pipeline-cli.ts` directly; list any that is, with the
   import line, and leave it out of the frozen list with a note.

Budget: `AGENTS.md` net <= +18, README net <= +2, `Home.md` net <= +2.
No new files.

## growth:check freezes the platform surfaces (code PR)

Files: `scripts/growth-budget-check.js`, `manifest/growth-budget.json`,
`test/growth-budget-check-smoke.js`.

1. Plan step, measured before code: for each frozen path in the North
   Star list, count tracked lines with `git ls-files <path> | xargs
   wc -l` at `origin/main`, and put the table in the PR body.
2. `growth-budget.json` gets a third part, `frozenPaths`: a list of
   `{ "path", "measuredAt", "measured", "maxLines" }`, one per frozen
   path, `maxLines` equal to `measured`. Paths are repo-root-relative;
   a directory path covers every tracked file under it, so a new file
   there counts too.
3. `growth-budget-check.js` sums tracked lines under each frozen path
   and adds an overage line `frozen <path>: <n> > <max>` when one is
   over. The fail message keeps its present words and adds one line:
   a frozen surface takes fixes and deletions; growth needs an intent.
   The pass line adds `frozen=<k> paths within ceiling`.
4. Smoke: one teeth case on the fixture repo with a frozen path one
   line over its ceiling, asserting exit 1 and the path in the message;
   the positive case asserts the pass line names the frozen count.

Budget: script net <= +28, json net <= +45 (one entry per path), smoke
net <= +22. No new files.

## Closing ledger and receipt (docs PR, last)

1. Receipt at
   `plugins/cool-workflow/project/docs/audits/core-path-receipt-<date>.json`,
   same shape as the run-folder receipt: `commit`, `version`,
   `startedAt`, `finishedAt`, checks: `north-star-names-core-path`
   (the ten commands appear in `AGENTS.md` North Star),
   `frozen-paths-listed` (count of `frozenPaths` entries equals the
   North Star list), `freeze-gate-teeth` (the new smoke case passes on
   main), `growth-check-pass` (`growth:check` on main prints md 135/135
   and the frozen line), `readme-sentence` (the core-path sentence is in
   both README copies and `Home.md`). `verdict` "pass" only if all
   pass, written from what was seen.
2. BACKLOG: the four design rows stay; each gets the words "frozen
   surface: needs an intent" at the start of its third column. No row
   is added or removed.
3. Fill the three sections below and the ledger.

Budget: docs only, no src; md count stays 135/135.

## Acceptance

- Manager (per PR): CI green, CodeQL green, Plan + before/after in the
  body, budget held, Chain line, no internal labels in committed text.
- Architect (program): the receipt's five checks pass; a PR that adds
  one line under `src/core/multi-agent/` on a test branch makes
  `growth:check` fail with the path named (shown in the closing PR
  body, not merged); `test:gate` all green, no new test file;
  `release:check` 18/18.

## Architecture snapshot diff (claims this program makes stale)

(filled by the closing PR)

## What this spec got wrong (recorded at close)

(filled at close)

## Status ledger

| Item | State | PR |
|---|---|---|
| Intent + spec (this file) | open | |
| The North Star names the core path | | |
| growth:check freezes the platform surfaces | | |
| Closing ledger and receipt | | |
