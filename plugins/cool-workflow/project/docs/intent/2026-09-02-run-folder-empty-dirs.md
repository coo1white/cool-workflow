# The run folder holds only what the run used, part two

Intent and spec in ONE file, in the shape `AGENTS.md` "Intent files (the
playbook)" asks for. Source: the acceptance re-run of the four-fixes
program (receipt
`plugins/cool-workflow/project/docs/audits/four-fixes-receipt-2026-09-02.json`,
commit `ef21862f`), where the one check that failed was
`D-no-empty-dirs`: a full run left 33 empty directories. Operator's
order: take the BACKLOG row for it and run it as the next program.

## Intent

A person who opens `.cw/runs/<id>/` after one run should see only what
that run made. Today they see 33 empty directories. Part one (PR #628)
stopped `ensureRunDirs` from making four of them up front, but the
spec tested the folder right after plan, and a person looks after the
run ends. Between plan and end, five read paths make directories as a
side effect of reading, and every worker gets two empty directories
it never uses. This program removes every such site, so a directory
exists only when a file was written into it.

## Measured facts (checked by command before design)

- Receipt check `D-no-empty-dirs` at `ef21862f`: 33 empty directories
  after a real 14-worker run: `candidates`, `artifacts`, `feedback`,
  `topologies/runs`, `blackboard/{artifacts,contexts,snapshots,
  decisions,topics}`, and `artifacts` plus `logs` under each of the 14
  workers.
- Every JSON writer in the shell goes through `writeJson` in
  `src/shell/fs-atomic.ts`, whose `writeBytesAtomic` makes the parent
  directory first (`fs.mkdirSync(path.dirname(file), { recursive:
  true })`). `durableAppendFileSync` in the same file does the same.
  The one raw text writer in the five files, the correction task in
  `src/shell/error-feedback-io.ts`, makes its parent directory itself.
  So no writer needs a directory made ahead of time.
- The directory-making lines are: `ensureBlackboardState` in
  `src/shell/coordinator-io.ts` (two `mkdirSync` lines, root plus five
  sub-directories); `ensureTopologyState` in `src/shell/topology-io.ts`
  (two lines); `ensureCandidateState` in
  `src/shell/candidate-scoring-io.ts` (one line); `ensureFeedbackState`
  in `src/shell/error-feedback-io.ts` (one line); `allocateWorkerScope`
  in `src/shell/worker-isolation.ts` (two lines, `artifactsDir` and
  `logsDir`); and `ensureRunDirs` in `src/shell/run-store.ts` still
  lists `paths.artifactsDir`.
- Who calls the ensure functions from a read: `summarizeBlackboard`,
  `listBlackboardMessages`, `listBlackboardArtifacts`,
  `buildBlackboardGraph` (from `src/shell/report.ts` and
  `src/shell/operator-ux.ts`); `summarizeTopologies`,
  `buildTopologyGraph`, `showTopologyRun`; `listCandidates`,
  `getCandidate`; `listFeedback`, `getFeedback`. The write paths
  (`persistBlackboardState`, `persistTopologyState`,
  `registerCandidate`, `recordFeedback`) call the same ensure, then
  write through `writeJson`.
- Readers that touch the disk under these directories all guard:
  `candidate-scoring-io.ts` checks `existsSync` before `readdirSync`
  (two sites); `coordinator-io.ts` and `topology-io.ts` keep their
  state in memory (`run.blackboard`, `run.topologies`) and read no
  directory; `run-export.ts` `walkFiles` returns `[]` when the root is
  missing.
- The worker's `artifactsDir` and `logsDir`: no host code reads or
  writes under them. `src/shell/sandbox-profile.ts` only puts the two
  strings into the allowed write paths (`effectiveSandboxWritePaths`)
  and resolves them with `path.resolve`, not `realpathSync`, so a
  missing directory is fine there. The worker's `input.md` names both
  paths ("- Artifacts: ...", "- Logs: ...") so the agent knows where to
  write.
- Tests that assert these directories exist with nothing in them:
  `test/worker-isolation-smoke.js` (two `existsSync` lines for
  `artifactsDir` and `logsDir`). Three smokes write a raw text file
  straight into the run-level `artifacts` directory with no `mkdirSync`
  of their own: `test/run-export-import-smoke.js`,
  `test/run-export-cross-machine-smoke.js`,
  `test/run-import-path-traversal-smoke.js`. This is why PR #628 kept
  `artifacts`.
- Budget: md files 134/135 on main; this file makes 135/135, at the
  cap. The next program must delete or merge a .md before it adds one.

## Paths weighed (complexity / upkeep / cost / can it be undone)

- Directories: (1) make them only when a file is written: the writers
  already do this, so the fix is to delete the making lines from the
  read paths: smallest change, no new code, undone by revert;
  (2) keep making them and sweep empty ones away when the run ends: a
  second mechanism to hide the first, races with running workers, and
  a run that stops early still leaves them; (3) one "run layout"
  module that owns every directory with a manifest: a policy change to
  `SPEC/state-core.md`, too big for the size of the defect. Chosen: 1.
- Worker `artifacts` and `logs`: (a) keep them, since the agent is told
  to write there: costs 28 empty directories per run and no host code
  needs them; (b) stop making them and tell the agent in the same
  `input.md` line to make the directory if it needs it: the sandbox
  already allows writes under the path. Chosen: b.
- Run-level `artifacts`: (a) keep it for the three smokes: a test
  shape driving a product shape; (b) drop it and give each smoke one
  `mkdirSync` line before its raw write. Chosen: b.
- Effect framework: rejected for good (see the four-fixes intent).

## Rules for every PR in this program

Same as the four-fixes program: one worker per PR, Plan in the PR body
before code, all gates run in `plugins/cool-workflow` before push with
the pass lines quoted, CodeQL green before auto-merge, max 3 rounds.
Two more, from the last program's ledger: the manager reads the pushed
diff, never the report, before it arms a merge; and a worker never
stops a process it did not start.

## Reads do not make directories (code PR)

Files: `src/shell/coordinator-io.ts`, `src/shell/topology-io.ts`,
`src/shell/candidate-scoring-io.ts`, `src/shell/error-feedback-io.ts`,
`test/run-retention-reclamation-smoke.js`.

1. Delete the `mkdirSync` lines from the four ensure functions (six
   lines). Keep the path-setting and in-memory state lines.
2. Plan step, measured before code: for each of the four files, list
   every `writeFileSync` / `appendFileSync` / `openSync` write that does
   not go through `fs-atomic.ts`, and show it makes its own parent. Put
   the list in the PR body. If one does not, add one `mkdirSync` line
   at that write, not in the ensure function.
3. Smoke, in the case PR #628 added: after the plan and the real
   dispatch, call `summarizeBlackboard`, `summarizeTopologies`,
   `listCandidates`, and `listFeedback` on the run, then assert that
   none of `blackboard`, `topologies`, `candidates`, `feedback` exists
   under the run folder. Then write one record of one kind
   (`recordFeedback` is the simplest) and assert its file exists, so
   the writer's own `mkdirSync` is shown.

Budget: src net between -6 and -2, smoke net <= +14. No new files.

## A worker's folder holds only what the worker wrote (code PR)

Files: `src/shell/worker-isolation.ts`, `test/worker-isolation-smoke.js`.

1. Delete the two `mkdirSync` lines for `artifactsDir` and `logsDir`
   in `allocateWorkerScope`.
2. In the same file, the two `input.md` lines "- Artifacts: <path>" and
   "- Logs: <path>" get the words "(make it if you need it)" at the
   end. Nothing else in `input.md` changes.
3. Smoke: the two `existsSync` asserts become "does not exist". Add
   one assert that the worker folder after `allocateWorkerScope` holds
   no empty directory.

Budget: src net between -2 and 0, smoke net <= +4. No new files.

## The run-level artifacts directory goes too (code PR)

Files: `src/shell/run-store.ts`, `test/run-export-import-smoke.js`,
`test/run-export-cross-machine-smoke.js`,
`test/run-import-path-traversal-smoke.js`,
`test/run-paths-shell-boundary-smoke.js` only if it lists `artifacts`.

1. Remove `paths.artifactsDir` from the list in `ensureRunDirs`.
2. Each of the three smokes gets one `fs.mkdirSync(paths.artifactsDir,
   { recursive: true })` line before its raw write.
3. Plan step, measured before code: run `test:gate` once with only
   step 1 applied and put the names of the failing files in the PR
   body; they must be exactly the three (or a listed fourth), no other.

Budget: src net -1, test net <= +4. No new files.

## Closing ledger (docs PR, last)

1. Acceptance re-run: build a tarball from `origin/main` after the
   three code PRs merge, install it into a private prefix, copy the
   same sample project the four-fixes receipt used, run the same `cw -q`
   question with the Claude agent, wait for `"status": "complete"`, and
   run `find .cw/runs/<id> -type d -empty`. Write the result as
   `plugins/cool-workflow/project/docs/audits/run-folder-receipt-<date>.json`
   with the same shape as the four-fixes receipt: `commit`, `version`,
   `startedAt`, `finishedAt`, one check `D-no-empty-dirs` with
   `command`, `seen`, `pass`, and `verdict`. Write what was seen, never
   what was expected; a fail is a valid result and is recorded as is.
2. Delete the "Five read paths" row from
   `plugins/cool-workflow/project/docs/BACKLOG.md`. If the receipt says
   fail, the row stays and gets the receipt path added instead.
3. Fill the three sections below and the ledger.

Budget: docs only, no src. md count stays 135/135.

## Acceptance

- Manager (per PR): CI green, CodeQL green, Plan + before/after in the
  body, budget held, Chain line, no internal labels in committed text.
- Architect (program): the receipt's `D-no-empty-dirs` check passes
  (`find` prints nothing) on a real completed run; `test:gate` all
  green with no new test file; `release:check` 18/18; `growth:check`
  md 135/135; the BACKLOG row is gone.

## Architecture snapshot diff (claims this program makes stale)

Checked: the man pages under `plugins/cool-workflow/docs/*.7.md` that name
the run folder layout or the worker folder, or list the directories a run
holds — `worker-isolation.7.md`, `candidate-scoring.7.md`,
`sandbox-profiles.7.md`, `error-feedback.7.md`,
`coordinator-blackboard.7.md`, `multi-agent-topologies.7.md`,
`multi-agent-operator-ux.7.md`, `run-retention-reclamation.7.md`,
`dogfood-one-real-repo.7.md`, `end-to-end-golden-path.7.md`,
`pipeline-runner.7.md`, and `run-registry-control-plane.7.md`.

- `plugins/cool-workflow/docs/worker-isolation.7.md`'s FILES list named
  `workers/<worker-id>/artifacts/`, `workers/<worker-id>/logs/`, and the
  run-level `feedback/` as standing paths, each with no file inside it —
  true before this program, when `allocateWorkerScope` made `artifacts/`
  and `logs/` up front and `ensureFeedbackState` made `feedback/` on any
  read. Both are lazy now. Fixed: each of the three lines now ends with
  "(made only if the worker writes into it)" or "(made only if a
  feedback record is written)".
- `plugins/cool-workflow/docs/candidate-scoring.7.md` and
  `plugins/cool-workflow/docs/sandbox-profiles.7.md` each had the same
  bare `.cw/runs/<run-id>/feedback/` line in their own FILES list. Same
  words added, same fix.
- `plugins/cool-workflow/docs/coordinator-blackboard.7.md`'s Storage
  Layout tree, `plugins/cool-workflow/docs/multi-agent-topologies.7.md`'s
  topology-run-record paths, and
  `plugins/cool-workflow/docs/error-feedback.7.md`'s own FILES list were
  checked and left as they are. Each names a file with an id in place of
  a name (`topics/<topic-id>.json`, `feedback/<feedback-id>.json`), never
  a bare directory standing empty from the start, so none went stale.
  `plugins/cool-workflow/docs/run-retention-reclamation.7.md`'s mention
  of `ensureRunDirs` talks about the window before the first checkpoint,
  not what the directory list holds, so it stayed true as written.
- `plugins/cool-workflow/docs/dogfood-one-real-repo.7.md` says a worker's
  command log is "written under the worker `logs/` directory" — true
  only when a log is written, which is what that page's dry run always
  does. Not stale.
- The new words on the `- Artifacts:` and `- Logs:` lines in a worker's
  `input.md` ("(make it if you need it)") are not quoted anywhere else
  in the doc set, so no second fix was needed for them.

## What this spec got wrong (recorded at close)

- The spec's step to delete the two `mkdirSync` lines for the worker's
  `artifactsDir` and `logsDir` in `allocateWorkerScope` also took away
  the only thing making their shared parent, `workerDir` — those two
  lines, through `recursive: true`, were doing double duty.
  `writeWorkerInput` then wrote `input.md` with a plain
  `fs.writeFileSync`, which makes no parent on its own, so every worker
  allocation broke with `ENOENT`. The spec's measured facts looked at
  reads under the two directories and missed this side effect on their
  parent. Fixed by making `writeWorkerInput` make its own parent
  directory at the point of write, right before the write.
- The spec's measured facts said `ensureRunDirs` in
  `src/shell/run-store.ts` "still lists `paths.artifactsDir`". It also
  still listed `paths.feedbackDir`, and the file's own header comment
  was wrong about both. Both lines were removed and the comment
  rewritten.
- The spec put `test/run-retention-reclamation-smoke.js` under the reads
  section only. The worker-folder change broke that file too, since it
  writes into `scope.artifactsDir` and `scope.logsDir` with no
  `mkdirSync` of its own. Because of this, the merge order had to be
  serialised so one worker touched the file at a time.
- The spec allowed "exactly the three (or a listed fourth)" failing
  smokes for the run-level artifacts removal. It was four:
  `test/run-paths-shell-boundary-smoke.js` asserts both `artifacts` and
  `feedback` exist right after `ensureRunDirs`. This sits inside what
  the spec allowed, and is written down here so the count stays honest.
- Process: a subagent inherits the parent's working directory, so a
  worker with no worktree of its own made its branch inside the
  architect's checkout, and three agents ended up sharing one checkout.
  Every worker's brief must now say "make your own worktree first", and
  the manager must check work through `git show origin/...` and
  `gh pr diff`, not a local file read.
- Two workers stopped and reported back instead of working around the
  spec — the `ENOENT` finding and the `feedbackDir` finding above. Both
  stops were right, and both found a real fault in the spec.

## Status ledger

| Item | State | PR |
|---|---|---|
| Intent + spec (this file) | merged | #632 3335d3d3 |
| Reads do not make directories | merged | #636 e3e71554 |
| A worker's folder holds only what the worker wrote | merged | #634 b23b72ea |
| The run-level artifacts directory goes too | merged | #633 fe1d4e38 |
| Closing ledger | merged — acceptance receipt `plugins/cool-workflow/project/docs/audits/run-folder-receipt-2026-09-02.json`, program verdict **PASS**, bound to commit `e3e71554f6084dbf114f95978642480d253207f8` | (this PR) |
