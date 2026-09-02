# A new user's first ten minutes: four fixes

Intent and spec in ONE file, in the shape `AGENTS.md` "Intent files (the
playbook)" asks for. Source: a walkthrough on 2026-09-02 where an agent
that had never seen this tool installed the 0.2.7 tarball into a
private prefix, read only the README and `cw help`, and tried to get a
report on a small sample project. Operator's order: fix the four stuck
points it hit, before any more code cleanup.

## Intent

The tool gets a new user to a first report in under three minutes, and
then loses them. One worker of six wrote a `cw:result` block that was
not closed, and the whole run stopped at stage one of four with no
second try. The help screen's own `--resume --run <id>` line is not
accepted as typed, and the README's `cw run resume` line does not find
the run when `--repo` is given. Typed in a folder that is not a
project, `cw -q` says nothing and reviews everything under it,
including the tool's own files. The run folder opens on five empty
directories with no words about any of them, and `cw doctor --onramp`
tells a user about release gates that only this repo's contributors
run. Each of the four is small; together they are the difference
between "I will try this again" and "I will not".

## Measured facts (checked by command before design)

- Walkthrough: install to first report 2 min 43 s; the run then parked
  with `result.md rejected: Invalid cw:result JSON: Expected ',' or '}'
  after property value in JSON at position 3523 (line 62 column 1)`.
  The worker's `result.md` block has 62 lines and ends after the
  `"evidence": [...]` array with no closing `}`. In `state.json` that
  worker has `retryCount: 1` and one dispatch: there was no second try.
  `src/shell/worker-isolation.ts` records this failure with
  `code: "result-parse-error", retryable: false`, while
  `src/core/pipeline/drive-decide.ts` has `DEFAULT_SCHEDULING_POLICY =
  { maxAttempts: 3 }` and `retryOrPark` would have allowed two more.
  A feedback record `feedback-parse-error-0001.json` was written with
  the exact message.
- `cw --resume --run <id>` prints `Unknown command: --resume`:
  `src/cli/parseargv.ts` takes the first token as the command, and
  `src/cli/entry.ts` special-cases only `-q` / `--question` into
  `quickstart`. The flag works only as `cw quickstart <app> --resume
  --run <id>` (`src/shell/pipeline-cli.ts`).
- `cw run resume <id> --drive --repo <path>` says `Cannot resume: run
  ... not found in source state`: `resolveCwd` in
  `src/shell/registry-cli.ts` reads `options.cwd` only, so `--repo` is
  dropped and the lookup falls to `process.cwd()` and the home registry.
- `cw -q "..."` with no `--repo` in a folder that is not a git work
  tree: `src/shell/pipeline-cli.ts` sets `args.repo` from the invocation
  cwd and plans; there is no git check anywhere on that path. Progress
  lines go to stderr only on a TTY (`emitProgress` in
  `src/shell/drive.ts`, the Rule of Silence), so a piped run is silent
  by design; the defect is the missing check, not the silence.
- `ensureRunDirs` in `src/shell/run-store.ts` creates 14 directories at
  plan time. In the sample run five stayed empty: `artifacts`,
  `blackboard`, `candidates`, `multi-agent`, `topologies`. Every writer
  goes through `src/shell/fs-atomic.ts`, whose write paths `mkdirSync`
  the parent. `src/shell` has 25 `readdirSync(` calls, 11 with an
  `existsSync` guard within two lines.
- `buildDoctorOnramp` in `src/shell/onramp.ts` always emits the
  sections "Change Loop", "Surface Guard", and "Release Gate", whose
  commands are `npm run build`, `node test/doctor-smoke.js`, `npm run
  parity:check`, `npm run gen:manifests -- --check`, `npm run
  release:check`. The same file has `detectSourceCheckout(cwd)`, which
  is true only when `cwd` (or `cwd/plugins/cool-workflow`) holds a
  `package.json` named `cool-workflow`.

## Paths weighed (complexity / upkeep / cost / can it be undone)

- Unclosed result block: (1) repair the JSON (add a `}`): clever, hides
  the agent's mistake, and a fabricated success is what rule 4 forbids;
  (2) mark the parse failure retryable so the existing three-attempt
  policy runs, and put the parse error into the retry prompt: small,
  fail-closed after three tries, undoable; (3) ask the agent for JSON
  without a fence: changes the worker contract for every app. Chosen: 2.
- `--resume` as first token: (1) change the help line to
  `cw quickstart <app> --resume --run <id>`: true but 20 columns longer
  and it pushes the app id onto a user who never typed one; (2) redirect
  a leading `--resume` to `quickstart` the way `-q` is redirected, so
  the help line becomes true as printed: three lines. Chosen: 2.
- Not a project: (1) warn and go on: the six workers still start; (2)
  refuse with one line that names `--repo`, only when the repo came from
  the cwd fallback (an explicit `--repo`, `--dir`, or `--link` is never
  refused): fail-closed, matches rule 4, undoable. Chosen: 2.
- Empty run folders: (1) a `README.md` inside every run: one more file
  per run and text that goes stale; (2) create a directory when the
  first file is written, for the five that were empty, after proving
  each reader survives its absence; keep the nine that are always
  written: no new files, less noise. Chosen: 2, with the proof as a
  gate on the change.
- Contributor sections in doctor: (1) a flag to hide them: one more
  flag to learn; (2) show them only when `detectSourceCheckout(cwd)`
  is true, which is exactly "you are in this repo": zero new surface.
  Chosen: 2.
- Adopting Effect (effect.website) across the project, asked at the
  same time as this program: REJECTED FOR GOOD (operator ruling,
  2026-09-02). Measured: Effect 3.22.1, v4 rc in flight, 27 MB
  unpacked against a 2.5 MB `dist/`; this package has zero runtime
  dependencies, 49,786 src lines, 17 async functions, 418 `throw new`,
  69 injected-dependency parameters, 47 `validate*` functions. It
  breaks the zero-runtime-dependency red line in `AGENTS.md` (FreeBSD
  discipline, rule 5) and would be the first framework dependency; it
  is a second dialect (fibers, typed error channel, Layer injection)
  for a synchronous code base that passes its dependencies as
  parameters, so adoption is a rewrite of ~50k lines judged only by
  the conformance suite; v3 to v4 is in flight, so upkeep starts on
  day one; and it can not be undone without a second rewrite. Every
  gain it offers has a zero-dependency form: a shared `Result` type
  for the throws, declarative checks as the long-term shape of the
  validators, and an async lock acquire for the one real concurrency
  gap (its own BACKLOG row). The one honest experiment would be a
  single pure `core/` module rewritten on a branch, compared on
  conformance and size, never merged.

## Design rules

R1 files not lines in comments; R2 named paths exist; R3 net small, no
new .md, at most one new smoke file in the whole program; R4 one PR per
item, Chain line + Plan + before/after in the body; R5 Basic English;
R6 wording a user reads (errors, hints) says what happened and what to
type next, in one line, no apology. Merge conflicts: rebase per
`AGENTS.md`. Full `test:gate` before every push.

## A bad result block gets a second try (code PR)

Files: `src/shell/worker-isolation.ts`, `src/shell/drive.ts` (only if
step 2 needs it), one smoke.

1. In `worker-isolation.ts`, the `result-parse-error` failure becomes
   `retryable: true`. `missing-required-evidence` and the sandbox
   violations stay as they are.
2. Plan step, measured before code: find how a retried worker's next
   `input.md` is built and whether the previous failure reason reaches
   it (the feedback record exists; the question is whether the prompt
   reads it). If it does, change nothing. If it does not, add the last
   failure message as one short paragraph at the top of the retry
   input: "Your last result was rejected: <message>. The `cw:result`
   block must be one JSON object, closed with `}`." At most 12 lines.
3. After `maxAttempts`, the run still parks; the parked hint line in
   `pipeline-cli.ts` stays.
4. Smoke: a worker whose first result block is unclosed and whose
   second is valid completes the task; the run's worker record shows
   `retryCount: 2` (or the field the code uses) and the second
   `input.md` holds the rejection line. Use the existing fake-agent
   harness the other drive smokes use; if one file already covers
   retries, add the case there, else this is the program's one new
   smoke file.

Budget: src net <= +20, smoke net <= +50.

## Resume works as the help says (code PR)

Files: `src/cli/entry.ts`, `src/shell/registry-cli.ts`,
`test/cli-arg-parsing-smoke.js` (or the smoke that covers the `-q`
redirect), `README.md`.

1. `entry.ts`: when `args.command === "--resume"`, set
   `args.options.resume = true` and `args.command = "quickstart"`, in
   the same block that redirects `-q`. The default app applies, which
   is the app a bare `-q` run used.
2. `registry-cli.ts` `resolveCwd`: `options.cwd`, else `options.repo`,
   else `process.cwd()`. Nothing else in that file changes.
3. Smoke: `cw --resume --run <id>` on a planned run does not print
   `Unknown command`; `cw run resume <id> --repo <path>` from another
   folder finds the run.
4. README: the troubleshooting row "Run stopped before the end" lists
   `cw --resume --run <id>` first, then the two forms it lists today.
   One row edited, no new rows.

Budget: src net <= +12, smoke net <= +30, README net 0.

## cw refuses to review a folder that is not a project (code PR)

Files: `src/shell/pipeline-cli.ts`, one existing smoke
(`test/quickstart-readme-path-smoke.js` or `test/headline-commands-smoke.js`),
`README.md`.

1. Where `args.repo` is set from the invocation cwd because neither
   `--repo` nor `--cwd` was given, check that the cwd is inside a git
   work tree (`git rev-parse --is-inside-work-tree`, same spawn style
   as `gitRoot` in `onramp.ts`; a missing `git` binary counts as "not
   inside"). If not, throw one line: `<cwd> is not a git project. Run
   cw inside a project, or pass --repo <path>.` The check runs before
   any plan, so it takes well under a second and creates no `.cw/`.
2. An explicit `--repo`, `--dir`, `--cwd`, or `--link` never triggers
   the check. `cw doctor`, `cw help`, `cw version`, `cw demo` are not
   on this path and do not change.
3. Smoke: `cw -q "x"` in a fresh temp dir with no git exits non-zero
   with that line and leaves no `.cw/`; the same with `--repo <a git
   dir>` proceeds to the existing "agent not configured" path.
4. README troubleshooting: one row, `... is not a git project` ->
   "run it inside the project, or pass `--repo`".

Budget: src net <= +14, smoke net <= +25, README +1 row.

## The run folder holds only what the run used (code PR)

Files: `src/shell/run-store.ts`, readers named in the Plan, one existing
smoke.

1. Plan step, measured before code: for each of the five directories
   (`artifacts`, `blackboard`, `candidates`, `multi-agent`,
   `topologies`), list every reader in `src/` (`readdirSync`,
   `existsSync`, `statSync`, `readFileSync` on a path under it) and say
   whether it survives a missing directory. Put the table in the PR
   body.
2. `ensureRunDirs` stops creating a directory that (a) was empty in the
   sample run and (b) every reader survives without, or can be made to
   survive with a guard of at most three lines. A directory that fails
   (b) stays, and the PR body says which and why.
3. Smoke: plan a run with the fake agent, assert that no directory
   under the run folder is empty right after plan, and that the run
   still completes. Add the case to the smoke that already plans a run
   and lists its folder.

Budget: src net <= +10 (guards) and at least -5 (the dropped lines),
smoke net <= +20.

## doctor --onramp speaks to the person in front of it (code PR)

Files: `src/shell/onramp.ts`, `test/doctor-smoke.js` (or the onramp
smoke), `docs/*.7.md` only if a man page lists the sections by name.

1. In `buildDoctorOnramp`, the sections "Change Loop", "Surface Guard",
   and "Release Gate" are added only when `detectSourceCheckout(cwd)`
   returns a value. The user sections stay in every case.
2. Smoke: in a temp dir that is not this repo, the onramp payload has
   none of the three titles; in this repo it has all three.
3. If a man page lists the onramp sections, one sentence there says
   the contributor sections show only inside the cool-workflow repo.

Budget: src net <= +6, smoke net <= +15.

## Roles and flow

Same as the six-rows program: the manager (Opus) sends one worker per
PR (sonnet for all five; haiku only for the closing ledger); every
worker writes its Plan into the PR body before editing, and for the
two PRs with a "Plan step, measured before code" the measurement goes
into the body first; runs `npm run build`, `test:gate`,
`release:check`, `onramp:check`, `growth:check`, `citation:check` in
`plugins/cool-workflow` before push, and quotes the pass lines. The
five PRs touch different files and run in parallel; the two that edit
`README.md` rebase onto the other when it lands. CodeQL green before
auto-merge. Max 3 rounds per PR.

## Acceptance

- Manager (per PR): CI green, CodeQL green, Plan + before/after in the
  body, budget held, Chain line, no internal labels in committed text,
  user-facing lines follow R6.
- Architect (program): the walkthrough is run again on a tarball built
  from main, same brief, same sample. Pass means: a worker's unclosed
  block leads to a second try and the run reaches a stage past the
  first, or parks with a hint whose command works as typed;
  `cw --resume --run <id>` is accepted; `cw -q` in a non-git folder
  refuses in under one second and writes nothing; the run folder has
  no empty directory; `cw doctor --onramp` in the sample shows no
  "Surface Guard" or "Release Gate"; `release:check` 18/18;
  `growth:check` md count unchanged; `test:gate` all green with at
  most one new smoke file.

## Architecture snapshot diff (claims this program makes stale)

Checked: the root `README.md` rows named by this program, the generated
`plugins/cool-workflow/README.md` copy, the man pages under
`plugins/cool-workflow/docs/*.7.md` that name the onramp sections or the
run folder layout, and the true directory list in
`plugins/cool-workflow/src/core/state/run-paths.ts`.

- `README.md` troubleshooting rows: "Run stopped before the end" now lists
  `cw --resume --run <id>` first, and a new row for "`... is not a git
  project`" tells the user to pass `--repo`. Both rows were fixed inside
  the merged PRs (#627, #629) at the same time as the code, so they were
  never left stale. `plugins/cool-workflow/README.md` — the copy
  `scripts/sync-readme.js` makes from the root file — carries the same two
  rows word for word, so the built copy is not stale either.
- `plugins/cool-workflow/docs/doctor.7.md` names `--onramp` only as "a
  quick-start guide... with recommended checks and a three-step path". It
  never names "Change Loop", "Surface Guard", or "Release Gate" by name, so
  the contributor-only check added in PR #626
  (`detectSourceCheckout(cwd)` in `src/shell/onramp.ts`) left this page true
  as written. No fix was needed.
- The man pages that describe the run folder
  (`plugins/cool-workflow/docs/coordinator-blackboard.7.md`,
  `candidate-scoring.7.md`, `multi-agent-topologies.7.md`,
  `pipeline-runner.7.md`, `run-retention-reclamation.7.md`) each say what a
  feature writes when it runs — none of them say the five directories are
  always there from the start. So none went stale when `ensureRunDirs` (in
  `src/shell/run-store.ts`) stopped making four of them up front.
- One real gap, not a stale claim:
  `plugins/cool-workflow/docs/agent-delegation-drive.7.md` writes out
  `quickstart --resume` and `run resume <id> --drive` in full, but never
  names the new top-level `cw --resume --run <id>` short form that PR #627
  added in `src/cli/entry.ts`. Nothing on that page is wrong — it just does
  not name the shortest way to type the command it already explains. Logged
  as one row in `plugins/cool-workflow/project/docs/BACKLOG.md`
  (2026-09-02).

## What this spec got wrong (recorded at close)

**Spec corrections**

- The spec said the fix was to make the `result-parse-error` failure
  `retryable: true`. That flag alone was not the block: `recordWorkerFailure`
  in `src/shell/worker-isolation.ts` set `task.status = "failed"` no
  matter what the flag said, and `selectDriveTask` in
  `src/core/pipeline/drive-decide.ts` only picks a task whose status is
  "running" or "pending". So the second try the spec counted on could
  never run. The fix had to change the status-setting line too.
- The spec counted five directories to drop from `ensureRunDirs`. Only
  four could go. `artifacts` has no writer of its own anywhere in `src/`,
  and three smoke tests write an evidence file straight into it with no
  `mkdir` first, so it stays.
- The spec's own smoke test for the run-folder item checked the folder
  right after plan, not after a full run. A person sees the folder
  after the run ends, not at plan time. The readers the item's own Plan
  step listed (`summarizeBlackboard`, `buildTopologyGraph` /
  `summarizeTopologies`, `listCandidates`, `recordFeedback`,
  `allocateWorkerScope`) do live through a missing directory — by
  making it while they read — and the spec never said a read must not
  make one. So the item passed the test it was given and a full run
  still ends with empty directories: `candidates`, `artifacts`,
  `feedback`, `topologies/runs`, the five `blackboard/` sub-directories,
  and `artifacts` plus `logs` under every worker. Recorded, not fixed,
  as its own row in `plugins/cool-workflow/project/docs/BACKLOG.md`.
- The spec said to check git with "the same spawn style as `gitRoot` in
  `onramp.ts`" inside `pipeline-cli.ts`. That could not be done as
  written: `test/quickstart-smoke.js` has a check that
  `pipeline-cli.ts` holds no `child_process` / `spawn(` / `execFile` text.
  The fix was an exported `isGitWorkTree` function next to `gitRoot` in
  `onramp.ts`, brought in by `pipeline-cli.ts`.
- `attachDispatchToMultiAgent` in `src/shell/multi-agent-io.ts` called
  `ensureMultiAgentState(run)` before its own
  `if (!result.multiAgent) return result;` check, and `src/shell/dispatch.ts`
  calls it on every dispatch. So even a plain one-worker run made an
  empty `multi-agent` folder. This file was outside the file list for
  that item and was taken in by a ruling.
- The spec did not say that `plugins/cool-workflow/README.md` is made
  again from the root `README.md` by `scripts/sync-readme.js`.
- The closing brief pointed at a worktree rule "in the Iteration Loop"
  of `AGENTS.md` as the place to add the new process-stopping rule.
  There was no such rule anywhere in `AGENTS.md`. The line went to
  "Anti-Patterns (auto-reject your own work if detected)" instead, as
  its own bullet, in the shape of the bullets already there.

**Two fixes in this program met, and neither part of the spec saw it
coming**

- The `cw --resume --run <id>` redirect added by the resume fix would
  have been turned away by the new not-a-project check, because a resume
  takes the cwd-default repo path. The check now steps aside when
  `--run <id>` is given.

**Named results and growth**

- Fixing the status-setting line for the `retryable` flag also gives
  `worker-result-missing` a real second try. Ruled right: a worker that
  wrote no result file is the same kind of bad output as one that wrote a
  broken block, and `maxAttempts` 3 keeps a limit on it. The retry line
  names which of the two things went wrong.
- The spec grew once by ruling: outside this repo, the onramp `summary`
  must not talk about release gates.
- The smoke test size limit of +20 for the run-folder item was set
  before the multi-agent ruling. That ruling cost 6 lines. Taken at +26.
- The gate numbers put on the not-a-project PR were taken on a base
  without the retry fix. CI runs on the merged result and the files do
  not touch each other, so this was taken as-is rather than run again.

**How the work went (short and plain)**

- On one PR, the body was written after the code, not before.
- A worker stopped `node test/run-all.js` processes without checking
  whose they were; two of the three belonged to other workers. It said
  so itself, unasked. CI was not touched and is the real gate, so
  nothing that merged rests on a run that was cut short. An earlier
  guess that the gate is "slow to fail under load" was dropped: there
  is no clean proof for it.
- One PR sat with every check green while still missing a change that
  had been ruled in. Only reading the pushed diff caught it. A report
  that work is done is not proof; the pushed diff is.
- A stand-in worker and the first worker were both live on one branch
  for a short time. Both were stopped before either wrote over the
  other. When a worker goes quiet, check the remote before you decide
  the work is lost.

## Status ledger

| Item | State | PR |
|---|---|---|
| Intent + spec (this file) | merged | #625 fd3388a2 |
| A bad result block gets a second try | merged | #630 95802f17 |
| Resume works as the help says | merged | #627 adf0ccad |
| cw refuses to review a folder that is not a project | merged | #629 405dc112 |
| The run folder holds only what the run used | merged | #628 ef21862f |
| doctor --onramp speaks to the person in front of it | merged | #626 f4edf419 |
| Closing ledger | merged — acceptance receipt `plugins/cool-workflow/project/docs/audits/four-fixes-receipt-2026-09-02.json`, program verdict **FAIL**, bound to commit `ef21862f63689a32a28fb82dc1aefcc79ee59b10` | (this PR) |

The program's own acceptance re-run is **FAIL**, not a pass. Five of the
six checks pass (`A-retry`, `B-resume-flag`, `B-resume-repo`,
`C-refuse-non-git`, `D-onramp-user-words`); one fails
(`D-no-empty-dirs`: 33 empty directories still there after a real run).
Five out of six is not a pass. The receipt is the record; nothing in
this file softens that.

Two honest notes carried from the receipt's own `note` fields:

- `A-retry` passed, but the walkthrough's run finished in one pass with
  no worker failure, so the "goes on by itself after one worker fails"
  path was never actually tried in this re-run. The real proof for that
  fix is the smoke test added with it (PR #630), not the walkthrough.
- `B-resume-flag` works — "Unknown command: --resume" is gone — but run
  from outside the sample project with no `--repo`, it prints "Run not
  found", and the short help line does not say it needs the cwd inside
  the project or a `--repo`. Folded into the existing
  `agent-delegation-drive.7.md` row in `BACKLOG.md`, not a new row.
