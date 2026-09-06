# Intent archive, 2026-09 (closed programs, text kept as is)

Closed intent files of one month, joined into one file so the .md count
stays inside the growth budget. Each part below is the whole original
file, word for word, with its status ledger. New programs start their
own file; a file joins this archive only after its closing PR merges.

---

# Six backlog rows: three closed for good, two shipped, one re-measured

Intent and spec in ONE file. Follows `2026-09-02-backlog-three-gates.md`
(same playbook, same roles). Operator's order: of the nine rows left in
`project/docs/BACKLOG.md`, clear the small ones fully automated; keep
the three big design rows (async lock, schedule/routine/sched, app code
containment) parked.

## Intent

Six of the nine rows are not design work. Three are ideas that fail
every North Star track and have been "parked" for months with no case
for them; they should be rejected for good, with the reason kept where
a reader can find it. Two are small fixes with a known shape: a dead
type field that a gate stops us from deleting, and a help line that will
break its width cap when the next vendor lands. One, the purity
baseline, was written down as "mechanical"; measuring it shows it is
not, and the row must say so.

## Design rules (same as the two programs before)

R1 files not lines in comments; R2 named paths exist; R3 net small,
header comments <= 15 lines, this file is the only new .md; R4 one PR
per item, Chain line + Plan + before/after in the body; R5 Basic
English. A PR that ships a row deletes that row from
`project/docs/BACKLOG.md`. Merge conflicts on that table are resolved
the way `AGENTS.md` "Resolving merge conflicts" says: rebase the work
branch onto `origin/main` (`--force-with-lease`, work branch only) and
keep both sides' deletions. That rule wins over the note in the
three-gates spec; the table rows are a docs list, which `AGENTS.md`
names as safe to resolve without asking. Before any push, run the full
`test:gate`, never the sampled `npm test`.

## Rows closed for good (docs PR)

Delete these three rows. The reason lives here from now on.

1. **`cw update` self-update verb** (logged 2026-07-07). Install care,
   not pipeline, recovery, or manifest work; it serves no track. The
   dead help lines are already gone and `cli-arg-parsing-smoke.js` keeps
   them out. Rejected: Homebrew and npm already own "update".
2. **Consolidate util look-alikes** (logged 2026-06-14). The bodies are
   not the same: `coordinator.ts` `compact` also drops empty arrays,
   `multi-agent.ts` `compact` returns `undefined` for a falsy input, and
   the four `truncate`s use four limits. Merging by name would change
   behavior with no test to say so. Local 2-3 line copies are cheaper
   than a shared module. Rejected.
3. **Adopt a code formatter** (logged 2026-07-07). One run would touch
   most of `src/` and cut `git blame` over 43k lines for no behavior
   value; it would also be the first framework dependency added for
   style. Rejected: no style drift has been seen since 2026-07-07.

The same PR rewrites the purity baseline row (see the last section).
Budget: `BACKLOG.md` only, net <= -2 lines.

## Delete-only type changes are a valid cycle (code PR)

Files: `src/shell/onramp.ts`, `scripts/onramp-check.js`,
`test/onramp-check-smoke.js`, `src/core/state/types.ts`,
`project/docs/ARCHITECTURE_PLAN.md`, `project/docs/BACKLOG.md`.

The row's blocker is stale in one way: the field
`PipelineContract.commitMessageTemplate` lives in
`src/core/state/types.ts`, which the onramp contract counts as RUNTIME
source, so today a delete of it fails `runtime-smoke-required`, not
`types-without-runtime`. Both rules ask for proof of a new behavior.
Deleting a declared field that nothing reads has no new behavior to
prove: `tsc` and the full gate are the proof. So:

1. Beside `isCommentOnlyPatch`, add an exported pure
   `isDeleteOnlyPatch(patchText)`: skip `+++`/`---` headers; read the
   `+` and `-` lines; every `+` line must be blank or a comment line
   (same start test as the comment function); at least one `-` line
   must be code. Otherwise false. Empty patch: false.
2. `resolveChangedFiles` gains `deleteOnly: string[]` next to
   `commentOnly`, from the same candidates and the same `git diff -U0`
   text; an untracked file is never delete-only.
3. A small `isTypeSource(file)`: `src/types/**/*.ts`, or a file under
   `src/` named `types.ts`. In `evaluateOnrampContract(files, { cwd,
   commentOnly, deleteOnly })` a file that is BOTH delete-only and a
   type source is left out of the runtime, app, and type sets. It stays
   in `changedFiles` and in the smoke recommendations. A delete-only
   file that is not a type source is classified as today. With no
   `deleteOnly` given, behavior is exactly today's.
4. `scripts/onramp-check.js` and `buildDoctorOnramp` pass `deleteOnly`
   through.
5. Smoke cases in `test/onramp-check-smoke.js`: (a)
   `src/core/state/types.ts` alone fails `runtime-smoke-required`; the
   same file in `deleteOnly` passes; (b) `src/types/run.ts` alone in
   `deleteOnly` passes (no `types-without-runtime`); (c)
   `src/shell/drive.ts` in `deleteOnly` with no test still fails
   `runtime-smoke-required`; (d) the pure function: `-` code lines only
   is true; one `+` code line makes it false; `+` lines that are only
   comments keep it true; `-` lines that are only comments is false;
   empty is false.
6. Delete the `commitMessageTemplate` field and its comment lines, if
   any. Update the one line in `project/docs/ARCHITECTURE_PLAN.md` that
   says it has no reader (say it was removed on this date). The rebuild
   SPEC captures under `project/docs/rebuild/` describe the old build
   and stay as they are.
7. This PR's own `onramp:check` must pass with `types.ts` reported in
   `deleteOnly`; quote that line in the PR body.

Budget: src net <= +40, smoke net <= +40. `onramp.ts` header comment
must not grow; the new function's doc comment <= 6 lines.

## The `-q` help line stops growing with the vendor count (code PR)

Files: `src/core/format/help.ts`,
`test/formatapps-help-toplevel-layout.test.js`,
`v2/conformance/cases/fixtures/cli-help/_root.txt`,
`project/docs/BACKLOG.md`.

Replace the vendor list in the first help row with one token, and put
the prose back to its old length:

```
  -q "question" [-<vendor>]                  Ask a question, get a report
```

The description column stays where the `--link` row puts it. The Flags
block right below already lists every `-claude`, `-codex`, `-gemini`,
`-opencode`, `-deepseek`, `-muse` flag, so nothing is lost, and a sixth
vendor adds one Flags row and never touches this line again. Update
the three byte pins named above to the same bytes (the worker greps
the whole repo for `-deepseek|-muse]` and fixes every hit that is not a
rebuild SPEC capture). `test/headline-commands-smoke.js` already holds
the 80-column cap; no new test file. The old-build capture
`project/docs/rebuild/SPEC/cli-help/_root.txt` and the block in
`SPEC/cli-surface.md` stay as they are.

Budget: net 0 in src and test (one line swapped in each).

## Rows that stay parked

The async lock, the schedule/routine/sched shape, and app code
containment stay as they are. The purity baseline row stays, but with
measured numbers in place of the word "mechanical":

- 14 sites in 8 core files; 13 are default-parameter fallbacks
  (`now || new Date()`, `env = process.env`); one is a real hidden
  read, `process.cwd()` in `core/state/migrations.ts`.
- Making `now`/`env` a needed parameter touches 26 src call sites in
  15 files and about 280 test call sites in about 60 files (counted
  2026-09-02 with a call-span scan).
- `PLAN.md` "Target shape" says every such input is a function
  parameter, so a gate rule that accepts the fallback form would be a
  policy change, not cleanup. It needs its own intent: one clock/env
  input at the shell edge, or a rule change agreed in writing.

## Roles and flow (the playbook)

Plan and Design: this file, one PR, merged first. Build: the manager
(Opus) sends one worker per PR; each worker writes its Plan section in
the PR body before it edits code, then builds. Test: the worker runs
`npm run build`, `npm run test:gate`, `npm run release:check`, and
`npm run onramp:check` in `plugins/cool-workflow` before push, and
quotes the pass lines. Deploy: CI on all platforms green, CodeQL green,
then auto-merge; the manager reviews each diff against this file
before it arms auto-merge. Maintain: the closing PR fills the ledger
below and the "what this spec got wrong" section; any new finding goes
to `BACKLOG.md` as a row, never into a worker's diff.

Order: the docs PR first (it edits four table rows); the two code PRs
run in parallel from the start and rebase once the docs PR lands. The
closing PR runs last.

## Acceptance

- Manager (per PR): CI green, CodeQL green, Plan + before/after in the
  body, budget held, Chain line, own BACKLOG row deleted, no internal
  labels in committed text, auto-merge armed only after CodeQL is
  green.
- Architect (program), on main: `BACKLOG.md` has exactly six rows
  (async lock, schedule shape, containment, purity with numbers, the
  onramp `typeFiles` retarget to `src/core/types/`, the stale
  `mcp-tool-call-coverage-smoke.js` header count); `grep -rn
  commitMessageTemplate src` is empty; `onramp:check` on a
  branch that only deletes one field from `src/core/state/types.ts`
  reports ok with the file in `deleteOnly`, and a branch that deletes
  one code line from `src/shell/drive.ts` still fails
  `runtime-smoke-required`; `cw help` first row is <= 80 columns and
  holds `[-<vendor>]`; `release:check` 18/18; `test:gate` 265/265;
  `growth:check` md 133/135.

## Measured facts (checked by command before design)

- Purity baseline: 14 sites in 8 core files; 13 are default-parameter
  fallbacks; a call-span scan counts 26 src call sites in 15 files and
  about 280 test call sites in about 60 files that omit `now`/`env`.
- `commitMessageTemplate` lives in `src/core/state/types.ts`;
  `src/types/` does not exist in the tree; the gate that blocks a
  delete is `runtime-smoke-required`, not `types-without-runtime` as
  the BACKLOG row said.
- `src/types/` has not existed since `bcb5db0d` (#334); the onramp
  `types-without-runtime` rule watches that dead path, so it can not
  fire on any real file today.
- The `-q` help row is 75 of 80 columns; three byte pins hold it
  (`help.ts`, the layout test, the `v2` fixture); the folded row is 73
  columns with the description at column 45, same as the `--link` row.
- The capability registry has 244 rows; at runtime none falls to
  `notYetImplemented`; three smokes still say in their header that
  they "stay red" and all three pass.

## Paths weighed (complexity / upkeep / cost / can it be undone)

- Purity: (1) thread `now`/`env` through every caller: low complexity,
  high cost (about 300 call sites), easy to undo; (2) teach the gate
  to accept the default-parameter form: low cost, but a policy change
  against `PLAN.md` "Target shape"; (3) keep the row parked with
  numbers: zero cost, fully undoable. Chosen: 3, until an intent
  decides between 1 and 2.
- Delete-only cycle: (1) any delete-only src file skips the smoke
  rule: simple, but a deleted safety check would pass with no new
  proof; (2) only type sources skip it: one more small function, no
  such hole. Chosen: 2.
- `-q` row: (1) wrap the vendor list onto a second line: grows with
  vendors, and a 2-space continuation reads as a command token to the
  help parity parser; (2) build the row from the vendor list: still
  grows; (3) one `[-<vendor>]` token: never grows, the Flags block
  keeps the list. Chosen: 3.

## Architecture snapshot diff (claims this round makes stale)

- The onramp contract now classes changed files by their diff
  (comment-only, delete-only), not by path alone. Any doc that
  describes the contract as path-only is stale; the rebuild capture
  `project/docs/rebuild/SPEC/scripts-runtime.md` stays as history.
- `project/docs/ARCHITECTURE_PLAN.md` no longer lists
  `commitMessageTemplate` as a field with no reader.
- `BACKLOG.md` is 6 rows; the three closed ideas are recorded only in
  this file.
- Checked `plugins/cool-workflow/docs/*.7.md` and
  `plugins/cool-workflow/README.md` for the word "onramp": the only
  hits are in `docs/doctor.7.md`, and they name the unrelated `cw
  doctor --onramp` quick-start flag, not the change-file contract this
  round touched. Nothing live is stale.

## What this spec got wrong (recorded at close)

1. The spec's `-q` help section names four files and says they are the
   files for that change; three sit under `plugins/cool-workflow/`, but
   `v2/conformance/cases/fixtures/cli-help/_root.txt` sits at the repo
   root, next to `plugins/`, not inside it.
2. The spec's acceptance asks that `onramp:check` "reports ok with the
   file in `deleteOnly`", but step 4 only asked to pass `deleteOnly`
   into `evaluateOnrampContract`. The printed report in
   `plugins/cool-workflow/scripts/onramp-check.js` had no `deleteOnly`
   field at all, so one more line was needed to print it.
3. The same spec section told the worker to grep for `-deepseek|-muse]`
   and skip the rebuild SPEC captures. The skip was never needed: those
   captures hold an older four-vendor form and never match that grep.
   The grep found exactly the three files the spec named, and no more.
4. The src budget of +40 was tight, not roomy. The first build of the
   delete-only change came in at +51 and had to be made smaller (two
   calls put on one line, comments cut) to land at +38.
5. The spec's order says the two code PRs "rebase once the docs PR
   lands" — one rebase. The delete-only change in fact needed two
   fetch-and-rebase rounds, because the spec PR itself and then two
   row-deleting PRs all landed while it was being built. The `-q`
   change needed none: its `BACKLOG.md` hunk did not touch the same
   rows.
6. What the spec got right and is worth saying: the claim that the
   blocker was stale (a delete of `commitMessageTemplate` fails
   `runtime-smoke-required`, not `types-without-runtime`) held up, and
   the smoke case proves it. Every gate number in the acceptance list
   was met.

No worker needed a fix round: all three build PRs passed review on the
first round.

## Status ledger

| Item | State | PR |
|---|---|---|
| Intent + spec (this file) | merged | #619 (`80d0eb78`) |
| Three rows closed for good + purity row re-measured | merged | #620 (`145d3fa6`) |
| Delete-only type changes are a valid cycle | merged | #622 (`9b4f785d`) |
| `-q` help line vendor fold | merged | #621 (`33f44fbf`) |
| onramp type source watches `src/core/types` | merged | #624 (`f5001c67`) |
| Closing ledger | merged | #623 |


---

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
| Closing ledger | merged — acceptance receipt `plugins/cool-workflow/project/docs/audits/four-fixes-receipt-2026-09-02.json`, program verdict **FAIL**, bound to commit `ef21862f63689a32a28fb82dc1aefcc79ee59b10` | #631 |

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

---

Archived from `2026-09-02-run-folder-empty-dirs.md`, closed by #637.

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
| Closing ledger | merged — acceptance receipt `plugins/cool-workflow/project/docs/audits/run-folder-receipt-2026-09-02.json`, program verdict **PASS**, bound to commit `e3e71554f6084dbf114f95978642480d253207f8` | #637 |

---

Archived from `2026-09-02-two-rows-readme-wiki.md`, closed by #646.

# Two parked rows, and the README and wiki say what the tree does

Intent and spec in ONE file, in the shape `AGENTS.md` "Intent files (the
playbook)" asks for. Source: the operator's order after the run-folder
program closed (receipt
`plugins/cool-workflow/project/docs/audits/run-folder-receipt-2026-09-02.json`,
PASS): write the two remaining small BACKLOG rows as the next intent,
and bring the GitHub README and wiki in line with the tree.

## Intent

Three things a person meets before they read code should be true: the
onramp gate names the type tree that exists, the test that counts MCP
tools says what it counts, and the README and wiki describe the tool as
it is after the last 57 merged PRs. Two BACKLOG rows from 2026-09-02
cover the first two. The third is measured below: the 14 wiki pages
kept in this repo all differ from what the public wiki shows, and the
public wiki has 39 more pages that nothing in the repo checks.

## Measured facts (checked by command before design)

- `src/shell/onramp.ts` filters `typeFiles` on the prefix
  `plugins/cool-workflow/src/types/` and excludes the same prefix from
  runtime files, while `isTypeSource` in the same file already accepts
  both `src/types/` and `src/core/types/` (PR #624). `src/types/` has
  been dead since commit bcb5db0d. `src/core/types/` holds three files
  (`boundary.ts`, `execution-backend.ts`, `observability.ts`) and none
  exports a `const`, `function`, `class`, `let`, or `enum`: they are
  type-only. The runtime value the BACKLOG row worried about,
  `APP_CODE_EXECUTION_MODE`, lives in `src/core/state/types.ts`, which
  is outside that directory.
- `test/mcp-tool-call-coverage-smoke.js` says in its header that 17
  tools it calls are deferred through `notYetImplemented`. A runtime
  walk of the 244 capability rows on 2026-09-02 found none that throw
  `CapabilityNotImplementedError`. In `src/`, `notYetImplemented` is
  defined in `src/core/capability-data.ts` and named in six comments;
  no code calls it.
- `plugins/cool-workflow/docs/agent-delegation-drive.7.md` shows
  `quickstart --resume` and `quickstart --run <id> --resume` in full but
  never the bare `cw --resume --run <id>` form PR #627 added, and does
  not say that form needs the cwd inside the project or `--repo`.
- The README `Troubleshooting` table already carries the two rows PRs
  #627 and #629 added. `plugins/cool-workflow/README.md` is made from
  the root `README.md` by `scripts/sync-readme.js`.
- The repo keeps 14 wiki pages under
  `plugins/cool-workflow/project/docs/wiki/` (last change 2026-09-01).
  The public wiki (`cool-workflow.wiki.git`, last commit 2026-08-25)
  holds 53 pages. All 14 shared pages differ, from 10 changed lines
  (`Trust-And-Audit.md`) to 147 (`Glossary.md`). The other 39 exist
  only on the public wiki: 12 `GitHub-Showcase-*` copies of the shared
  pages, and 27 deep pages (backends, topologies, registry, release
  tooling, stories). No script in the repo syncs the wiki;
  `scripts/sync-project-index.js` and `scripts/sync-readme.js` do other
  things. 57 PRs merged since the wiki's last commit.
- md count on main is 135/135. This spec PR merges the two historical
  verdict files under `project/docs/audits/` into one
  (`architecture-review-verdicts.md`, both texts kept word for word) so
  the count stays 135 with this file added. Nothing else linked to the
  two old names except the audits index, which now points at the one
  file.

## Paths weighed (complexity / upkeep / cost / can it be undone)

- Wiki source of truth: (1) copy all 53 public pages into the repo:
  +39 .md, far over the budget; (2) keep the 14 repo pages as the
  source, treat the 39 public-only pages as wiki-only, and check each
  of them once against the surfaces the 57 merges changed; (3) delete
  the 39: throws away deep pages people link to. Chosen: 2.
- The 12 `GitHub-Showcase-*` copies: (a) keep and update twice; (b) each
  becomes a three-line page that points at its live page. Chosen: b,
  since a copy that drifts is what this program is fixing.
- Wiki publish: (1) a new `scripts/sync-wiki.js`: a new file and a
  credential path in code; (2) a four-line runbook note in `AGENTS.md`
  (clone, copy the 14 pages, commit, push) done by hand at each release.
  Chosen: 2; the wiki changes a few times a month, a script is not
  earned yet.
- `notYetImplemented`: (a) leave it since a comment names it; (b) if no
  code or test calls it, delete it in the same PR as the header fix.
  Chosen: b, measured first.
- Effect framework: rejected for good (see the four-fixes intent).

## Rules for every PR in this program

Same as the last two programs: one worker per PR, own worktree first,
Plan in the PR body before code, all gates run in `plugins/cool-workflow`
before push with the pass lines quoted, CodeQL green before auto-merge,
max 3 rounds, the manager reads the pushed diff and never the report,
no worker stops a process it did not start. All English written into
the repo or the wiki is Basic English; command names and paths stay as
they are.

## The onramp type rule names the live type tree (code PR)

Files: `src/shell/onramp.ts`, `test/onramp-smoke.js` (or the smoke that
already asserts the type-only class).

1. Plan step, measured before code: run a one-line check that no file
   under `src/core/types/` has a runtime export, and put the output in
   the body.
2. The two prefix strings in `onramp.ts` that say
   `plugins/cool-workflow/src/types/` become
   `plugins/cool-workflow/src/core/types/`; the comment near
   `isTypeSource` stops naming `src/types/` as a live tree.
3. Smoke: a diff touching only `src/core/types/boundary.ts` is classed
   as a type-only change; a diff touching `src/core/state/types.ts` is
   not.

Budget: src net 0 (edits in place), smoke net <= +12. No new files.

## The coverage smoke header says what it counts (test PR)

Files: `test/mcp-tool-call-coverage-smoke.js`, `src/core/capability-data.ts`
only if step 2 finds no caller.

1. Plan step, measured before code: count how many tools this smoke
   skips or defers today, by the smoke's own logic, and count callers
   of `notYetImplemented` in `src/` and `test/` with `grep -rn`. Both
   numbers go in the body.
2. Fix the header comment to the true count and the true reason. Do not
   change what the smoke asserts. If step 1 found zero callers, delete
   the `notYetImplemented` function and the comment lines that name it
   as live; if it found one, leave the function and say where.

Budget: test net between -3 and +3, src net between -12 and 0. No new
files. Haiku may take this PR; the measurement commands are fixed.

## The docs name the shortest resume form (docs PR)

Files: root `README.md` (then `npm run sync:readme`),
`plugins/cool-workflow/docs/agent-delegation-drive.7.md`.

1. The man page gets one line for `cw --resume --run <id>` beside the
   two forms it shows, and one sentence: it needs the cwd inside the
   project, or `--repo <path>`.
2. README `Troubleshooting`: the "Run stopped before the end" row is cut
   to the one command a user types, with the note that it needs the cwd
   inside the project or `--repo`; the other two forms move out of the
   row. No other README row changes unless step 3 finds it wrong.
3. Plan step, measured before code: read every README claim about the
   run folder, `doctor`, `--resume`, and what `cw -q` does in a folder
   that is not a project, against the tree at HEAD; list each claim and
   "true" or "fix" in the body. Fix only the ones marked "fix".

Budget: README net <= +2, man page net <= +3, no new files.

## The 14 wiki source pages match the tree (docs PR)

Files: `plugins/cool-workflow/project/docs/wiki/*.md` (14 files).

1. Plan step, measured before code: for each page, list every claim
   that names one of the changed surfaces: `--resume` forms,
   `run resume` with `--repo`, `doctor --onramp` sections, what `cw -q`
   does outside a project, the run folder's directory list, the `-q`
   help line, `src/types/`. Mark each "true" or "fix". Put the table in
   the body.
2. Fix the "fix" lines. `Recovery-And-Restore.md`, `Quickstart.md` and
   `Commands-or-API.md` get the bare `cw --resume --run <id>` form.
   `Glossary.md` says the blackboard directory is made on first write.
3. No page grows by more than 10 lines; no page is added or removed.

Budget: net <= +40 across the 14 files. No new files.

## Closing ledger, wiki publish, receipt (docs PR, last)

1. Clone `https://github.com/coo1white/cool-workflow.wiki.git` into the
   scratch area. Copy the 14 repo pages over their public twins. For
   each of the 12 `GitHub-Showcase-*` pages, replace the body with three
   lines: the title, "This page moved; the live page is", and a link to
   the shared page. For each of the 27 deep pages, run the same claim
   check as the wiki PR's step 1 and fix only "fix" lines, at most 10
   lines per page. Commit with a message that names the repo commit
   the pages match. Push to the wiki's `master`. The push is the one
   public action in this program; it is done once, after the four PRs
   above are merged, and its commit sha goes into the receipt.
2. `AGENTS.md`, in the release runbook: four lines, "After a release,
   publish the wiki: clone the wiki repo, copy the 14 pages from
   `plugins/cool-workflow/project/docs/wiki/`, commit naming the release
   commit, push."
3. Receipt at
   `plugins/cool-workflow/project/docs/audits/readme-wiki-receipt-<date>.json`,
   same shape as the run-folder receipt: `commit` (repo), `wikiCommit`,
   `version`, `startedAt`, `finishedAt`, checks: `wiki-14-pages-equal`
   (`diff -rq` of the 14 pages against the fresh wiki clone prints
   nothing), `showcase-pointers` (12 pages are three lines each),
   `backlog-rows-gone` (the two 2026-09-02 rows and the
   `agent-delegation-drive.7.md` row are absent), `onramp-type-only`
   (the new smoke case passes on main), `citations-resolve`
   (`citation:check` all resolve), `md-count` (135/135). `verdict` is
   "pass" only if all pass. Written from what was seen.
4. Delete the three BACKLOG rows (typeFiles retarget, coverage-smoke
   header, `agent-delegation-drive.7.md` gap). On a failed check, the
   row for that check stays and gains the receipt path.
5. Fill the three sections below and the ledger.

Budget: docs only in the repo, no src; md count stays 135/135.

## Acceptance

- Manager (per PR): CI green, CodeQL green, Plan + before/after in the
  body, budget held, Chain line, no internal labels in committed text,
  Basic English in every changed doc line.
- Architect (program): the receipt's six checks pass; the public wiki's
  14 shared pages are byte-equal to the repo; a new user reading the
  README `Troubleshooting` row types one command and it works from
  inside the project; `test:gate` all green with no new test file;
  `growth:check` md 135/135; BACKLOG is down to the four design rows.

## Architecture snapshot diff (claims this program makes stale)

Measured by `grep -rn` across the 53 files under
`plugins/cool-workflow/docs/*.7.md`, both README files, `AGENTS.md`, and
`plugins/cool-workflow/project/docs/wiki/*.md`, for the strings this
program's four merges touched: `src/types/`, `17 deferred`/`17 tools`,
`notYetImplemented`/`CapabilityNotImplementedError`, `14 wiki`/`14 pages`,
and the bare `cw --resume --run <id>` form.

- No live doc outside the files those four PRs themselves changed still
  carries a stale claim. `test/mcp-tool-call-coverage-smoke.js` now reads
  "All 65 tool calls execute successfully" with no deferred-tool count.
  `plugins/cool-workflow/docs/agent-delegation-drive.7.md` names the bare
  `cw --resume --run <id>` form and its cwd/`--repo` rule (line naming the
  bare form). `README.md`'s `Troubleshooting` row does the same. No doc
  names `src/types/` as a live tree; `src/shell/onramp.ts` and
  `test/onramp-smoke.js` are the only files that named it, and both were
  fixed in the onramp PR.
- Nothing measured stale and unfixed. No BACKLOG row is added for this
  check.

## What this spec got wrong (recorded at close)

- This spec told the worker to delete `notYetImplemented` since it read as
  having no callers. It has one live caller, in
  `src/wiring/capability-table/registry-core.ts`, as the fallback for every
  tool row with no real handler. Deleting it would have broken that
  fallback. Root cause: the measuring grep that fed this spec was cut short
  with `| head -8`, so the caller line never came up. The section's own
  rule — one or more callers means keep it and say where — is what saved
  it.
- The onramp smoke's old type-only case used `src/types/run.ts`. After the
  retarget to `src/core/types/`, that same case would have gone on passing
  while testing nothing at all. A test that passes for the wrong reason is
  worse than one that fails. The case was moved to
  `src/core/types/boundary.ts`, and a negative case was added for
  `src/core/state/types.ts`.
- This spec called the wiki source set "14 pages". That set also holds
  `Home.md` and `_Sidebar.md`, which the separate `User-Guide.md` page had
  to touch too. The set is now 15.
- The coverage smoke's test budget of "-3 to +3" was set before anyone
  measured the stale header. The stale text ran 13 lines; the change was
  net -10. Taken as is.
- The coverage smoke header was stale in three ways at once: it claimed 17
  deferred tools (true count 0), it claimed the smoke "stays red" while the
  gate was green, and it named a line number in the wrong file.
- This spec's closing section said "12 `GitHub-Showcase-*` pages" and "27
  deep pages" for the wiki-only set. A fresh clone of the public wiki
  measured **10** `GitHub-Showcase-*` pages and **28** deep pages (52
  `.md` files total, minus the 14 that already matched a repo page name).
  The spec's counts were wrong; the closing PR worked the true numbers,
  not the stated ones.
- Of the 28 deep pages the closing PR checked against the claim topics
  (`--resume` forms, `run resume --repo`, `doctor --onramp`, `cw -q`
  outside a project, the run folder's directory list, the `-q` help
  line, `src/types/`), only one, `Runtime-Contract.md`, needed a fix
  (+2 lines: `audit/` and `nodes/` were missing from its run-folder
  directory list). The other 27 either did not mention any of the
  claim topics, or their mentions were already accurate. This is a
  good result stated plainly: the deep pages had drifted far less than
  the spec feared, and the small diff means the check was run and came
  back nearly clean, not that it was skipped.

## How the work went (process notes, recorded at close)

- `agent-*` worktrees were reclaimed from disk under three workers while
  still running mid-task. Each of the three refused to fall back to a
  shared checkout and reported the loss instead of guessing.
  Correction to an earlier version of this note: "make your own worktree
  first" is the right rule ONLY for an agent that inherits a shared
  working directory. A worktree-isolated subagent cannot switch to a
  worktree it makes itself — its Bash/Read/Edit/Write tools stay locked
  to the one the harness handed it — so for that kind of agent the
  auto-made `agent-*` worktree IS the right one to work in, and trying
  `git worktree add` plus a switch is a dead end. Recorded so the next
  worker brief tells the two cases apart instead of sending an
  isolated subagent down that dead end.
- A fresh worktree has no `node_modules`, so `npm run build` dies with
  "tsc: command not found". Run `npm ci` first.
- A two-dot `git diff origin/main <branch>` on a branch that is behind
  main reads as if it reverts other people's merged work. Use `gh pr diff`
  or the three-dot `git diff origin/main...<branch>` instead.
- The package install (`npm ci`, `npm install`) was refused by the
  permission system for the coverage-smoke PR. Nobody retried it and
  nobody asked another agent to run it in their place. That PR's local
  gate ran with node directly and reported 263/265 plus release-check 15
  of 18, with the cause named plainly as "tsc: command not found, package
  install refused in this sandbox". CI on GitHub, which does install the
  packages, was the full gate and was green on all eight checks before the
  merge.
- The manager twice stated a guess as if it were a measurement: once
  reporting how many workers had lost their worktree, from a listing cut
  short by `tail -20`; once claiming every gate script was plain node with
  no need of the install, which was false for `test:gate` and
  `release:check`. A worker's own measurement corrected both times. This
  is the same fault as the `| head -8` grep above: a cut-short command
  read as a full one.
- A worker that had been stood down woke up on its own, pushed an old
  commit back to a branch whose work was already merged, and opened a
  duplicate PR. The duplicate was closed and the stale branch deleted;
  main was never touched. Lesson: a stand-down must be the last message
  that worker ever gets, since any later message can wake it and it may
  act on stale state.
- The wiki push was not done by the closing worker. It refused a
  relayed yes for a public action, which was right. The architect, who
  had the user's own word in their session, pushed 5d9dd3f from the
  prepared clone as a fast-forward on e5ac7bb after checking the remote
  had not moved. Rule from this: a public step goes to the agent that
  holds the user's word, never to a subagent through a relay.

## Status ledger

| Item | State | PR |
|---|---|---|
| Intent + spec (this file) | merged | #638 fc4a8c23 |
| The onramp type rule names the live type tree | merged | #640 94068071 |
| The coverage smoke header says what it counts | merged | #643 e3917a0e |
| The docs name the shortest resume form | merged | #642 23e1a300 |
| The 14 wiki source pages match the tree | merged | #641 f174a971 |
| Closing ledger, wiki publish, receipt | open | #646 |

A new wiki page, `User-Guide.md`, landed on its own as #639 9e97a426. That
took the wiki source set from 14 pages to 15. Every "14" in this file's
older sections is the count at spec time; the true count from this point
on is 15.


---

## Program: The core path is named, the rest is frozen (closed by #653)

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

Checked: `plugins/cool-workflow/project/docs/wiki/Architecture.md`,
`Workflow-Apps.md`, `Operations.md`, `Trust-And-Audit.md`,
`MCP-And-Manifests.md`, `project/docs/benchmark.md`, and
`project/docs/ARCHITECTURE_PLAN.md`, for the surface names this program
freezes.

- `project/docs/wiki/Architecture.md` is stale and not fixed in this
  PR. Its opening diagram puts `multi-agent host -> topology ->
  blackboard/coordinator -> fanout/fanin -> candidate score/select`
  right beside the proved `workflow app -> runner -> dispatch ->
  isolated workers` line, with no mark that the first line is a frozen
  surface. Its "Core Boundary" table lists `orchestrator` as one of the
  seven runtime areas "the runtime... provides", the same weight as
  `state`, `dispatch`, `verifier`, `capability-registry`, and
  `run-registry` — but `orchestrator` (`src/shell/orchestrator.ts`) is
  a frozen surface in the new North Star, not on the `cw -q` import
  path. This page was not in the file list of either code PR in this
  program, so fixing it is out of this PR's scope. This closing PR's
  own budget is docs-only with the BACKLOG row count held fixed, so
  the fix is recorded here, not queued as a new row; the next program
  that touches `Architecture.md` should give `orchestrator` and the
  multi-agent line the same freeze mark the North Star now carries.
- `Workflow-Apps.md`, `Operations.md`, and `MCP-And-Manifests.md` each
  name a frozen command in passing (`pdca-blackboard-loop`, `cw
  workbench serve`, `cw workbench view`). None claims the surface is
  proved or core; they only say the command exists. Not stale.
- `Trust-And-Audit.md` names `docs/multi-agent-trust-policy-audit.7.md`
  as a further-reading link, making no claim about the surface's
  status. Not stale.
- `benchmark.md` and `ARCHITECTURE_PLAN.md` name `workbench` only as a
  load-test target and a further-reading link. Not stale.
- The README "What You Can Run" part already put multi-agent under
  "when you need it" before this program (measured fact in this
  file's own spec section), so it needed no fix beyond the one
  sentence the North Star PR (#650) added.

## What this spec got wrong (recorded at close)

- The spec's "Rules for every PR in this program" repeated the
  `git worktree add` line from the two programs before it: "own
  worktree first (`git worktree add` to a named path, then `npm ci`)."
  That rule is a dead end for a worktree-isolated subagent — its
  Bash/Read/Edit/Write tools stay locked to the one worktree the
  harness gave it, so `git worktree add` plus a switch cannot be
  followed. The rule is right only for an agent that inherits a shared
  working directory. The two-rows program (now in
  `2026-09-archive.md`) already recorded this correction once; this
  spec was written before that correction landed and repeated the
  stale form. The closing worker used the harness-given worktree
  directly, per the corrected rule.
- The spec's measured facts gave no line count for
  `src/core/state/state-explosion/`, only for `src/core/multi-agent/`
  (4,251) and named groups. The freeze-gate worker (PR #651) measured
  it: 1,653 lines across 5 files, now the `maxLines` for that
  frozen-path entry in `manifest/growth-budget.json`.
- The spec's measured facts said the tool has "ten apps" from `cw app
  list`. Measured at close: `cw app list` prints 10 entries, but only
  8 are `app-directory` entries with a folder under
  `plugins/cool-workflow/apps/`; the other 2
  (`legacy-architecture-review`, `legacy-research-synthesis`) are
  `workflow-file` compatibility wrappers around two of the 8. `ls
  plugins/cool-workflow/apps` lists 8 directories. The root README's
  "eight installed apps" line was lower than what the command itself
  prints (10), so this closing PR changed it to "ten installed apps"
  to match the command's own number, per the spec's rule to change the
  line only when the command's number differs from eight.
- `citation-check` on the tree after this PR's own archive move (the
  run-folder and two-rows programs joined into `2026-09-archive.md`)
  found a repo-path-shaped fake filename inside a test comment in the
  freeze-gate PR (#651): the smoke fixture used a name that reads as a
  real repo path but is not one. `citation-check` caught it before
  merge; it is not a stale reference left behind by this program.
- A worker held so its PR would land in the right order lost its
  own worktree (the one the harness made for it) once its session
  ended; the lesson recorded here is that held work is done by
  starting a new worker later, not by pausing a live one and hoping
  its worktree is still there when it wakes.
- The manager session that ran PRs #650 and #651 ended on an API 403
  error right after #651 merged. The architect accepted this closing
  PR in the manager's place, reading the merged diffs directly rather
  than a manager's report.
- `git add -A` in a shared checkout swept another branch's uncommitted
  edits into a commit, so the first push of this closing work carried
  work from a different program. The rule from it: never `git add -A`
  in a shared checkout; add files by name. And start every worker with
  its own worktree, not a shared one.

## Status ledger

| Item | State | PR |
|---|---|---|
| Intent + spec (this file) | merged | #644 fce52d1c |
| The North Star names the core path | merged | #650 9e6f1e2a |
| growth:check freezes the platform surfaces | merged | #651 98e33a3c |
| Closing ledger and receipt | this PR | |


---

## Program: The README is one page (closed by #659)

# The README is one page

Intent and spec in ONE file, in the shape `AGENTS.md` "Intent files (the
playbook)" asks for. Source: the operator, on 2026-09-03, after reading
the README as its own founder: "太杂太乱，容易吓走用户", and "特别重要的可以
挪到 wiki 里". Two more orders the same hour: "然后拿掉这个视频演示" (drop the terminal
recording GIF), and "要让用户决定容易上手，然后把支持的模型列个清单出来打勾：
哪些已支持，哪些还没适配" (a person must be able to decide in one
screen that this is easy to start, and see a checked list of which
agents are supported and which are not yet). Then: "给用户提供简单的打开 report 的方式", "用了我们的工具，生成了报告，怎么打开",
and "如果用户不会找文件的相对/绝对路径，怎么样能傻瓜式的让用户像打开 excel 一样简单"
(a person who has a report needs to see it with no path and no id,
the way a spreadsheet opens itself). Rule
already given the same day: anything a user reads is one page,
Jobs-simple.

## Intent

A person who lands on the repo should know in one screen what `cw` is,
type three commands, and get a report. Everything else lives one click
away in the wiki. Nothing is thrown away: every cut section moves to
the wiki page that already covers its subject, or to one new page.

## Measured facts (checked by command before design)

- Root `README.md` is 360 lines with 12 parts: hero and badges (1-21),
  What is this (22-47), Install (48-72), Quick Start (73-131, three
  steps), Why Cool Workflow (132-153), How It Works (154-168), What You
  Can Run (169-197), Can You Trust the Report (198-215), Use It From
  Your Editor (216-310, 95 lines, the largest), Troubleshooting
  (311-323), Repo Map (324-342), Docs & Wiki (343-357), License.
- Six of those parts have no twin sentence anywhere under
  `plugins/cool-workflow/project/docs/wiki/`: Why, How It Works, What
  You Can Run, Can You Trust, Editor, Repo Map (checked by grepping the
  first line of each part across the 15 wiki pages: no hit). The wiki
  pages that cover the same subjects exist: `Mental-Model.md` (127
  lines), `Architecture.md` (105), `Workflow-Apps.md` (113),
  `Trust-And-Audit.md` (90), `MCP-And-Manifests.md` (111). There is no
  wiki page for the repo map.
- Tests that read the root README's text: `test/readme-trust-claim-smoke.js`
  needs a "## Can You Trust the Report?" part that says the agent signs
  its findings, names `verify-bundle`, says the signed findings are
  present unaltered, says CW holds no private key, keeps the honest
  limit sentence, and does not overclaim; `test/claude-p-agent-wrapper-smoke.js`
  needs the string `builtin:claude` somewhere in the README (today in
  the Troubleshooting table); `test/readme-sync-smoke.js` needs
  `plugins/cool-workflow/README.md` to equal the output of
  `scripts/sync-readme.js` and to carry no repo-relative image or link.
  `scripts/release-check.js` needs the file present and its path
  citations to resolve (`citation:check`).
- Agents, measured from `src/shell/agent-config.ts` (known list: claude,
  codex, gemini, opencode, muse), the wrapper scripts under
  `plugins/cool-workflow/scripts/agents/` (claude-p, codex, muse,
  opencode, gemini-opencode, deepseek), and the README's own words:
  Claude Code, Codex CLI, Muse Code and OpenCode run natively and are
  found on `PATH` by `cw doctor`; Gemini and DeepSeek reach their models
  through `opencode` (DeepSeek also through an HTTP endpoint,
  `CW_AGENT_ENDPOINT`), and DeepSeek has no auto-detect. No wrapper
  exists for Cursor, GitHub Copilot CLI, Aider, Qwen Code, or Kimi.
- The README's second image (line 19) is a GIF of `cw demo tamper`'s
  terminal output; the operator asked for it to go. The hero image, the
  pipeline image and the topologies image are the other three.
- Opening a report today: the end-of-run line says `Next: cw report
  <run-id> --show` (`src/shell/reporter.ts`), which prints the report in
  the terminal; README step 3 says `cat .cw/runs/<run-id>/report.md`.
  The `report` binding in `src/wiring/capability-table/reporting.ts`
  requires the run id (`required(optionalArg(args.positionals[0]), "run
  id")`); there is no "newest run" default and no way to open the file
  in the system viewer. Run ids carry a UTC timestamp
  (`architecture-review-20260902T183411Z-4fcc79`), so the newest run of
  a repo is the largest id under `.cw/runs/`.
- `plugins/cool-workflow/README.md` is the npm page, made from the root
  by `npm run sync:readme`; edits go to the root only.
- md count on main after the freeze closing PR: 133/135 (two closed
  intents archived). This program adds this file and one wiki page:
  135/135.
- The first new-user walkthrough (2026-09-02) said the README was clear
  but the tester read only Install, Quick Start and Troubleshooting;
  none of the four stuck points came from the six parts this program
  moves.

## Paths weighed (complexity / upkeep / cost / can it be undone)

- (1) Cut the README to one page and drop the rest: loses text people
  link to; (2) move each cut part to its wiki twin page, then cut, and
  leave one link per moved part in a short "Learn more" list: nothing
  lost, one move each, undone by revert; (3) keep the README and add a
  short summary at the top: the wall of text is still there and still
  the first thing a person sees. Chosen: 2.
- The trust part: (a) move it whole and move the test to the wiki page:
  the test guards the README against overclaiming, so it must stay on
  the README; (b) keep a five-line trust part on the README that holds
  the sentences the test needs, and move the rest. Chosen: b.
- The repo map: (a) into `Architecture.md`: mixes a contributor list
  into a user page; (b) one new wiki page `Repo-Map.md`: +1 md, inside
  the budget. Chosen: b.
- Effect framework: rejected for good (see the archive).

## Rules for every PR in this program

Same as the last programs: auto worktree for an isolated subagent,
`npm ci` first, Plan in the PR body before edits, all gates before push
with the pass lines quoted, three-dot diffs, CodeQL green before
auto-merge, max 3 rounds, the manager reads the pushed diff, a
stand-down is the last message a worker gets, hold work by spawning
later. Every changed doc line is Basic English and one-page simple: one
line that says what it is, at most six bullets, one link to start.

## The wiki takes the six parts (docs PR, first)

Files: `plugins/cool-workflow/project/docs/wiki/Mental-Model.md`,
`Architecture.md`, `Workflow-Apps.md`, `Trust-And-Audit.md`,
`MCP-And-Manifests.md`, new `Repo-Map.md`, `_Sidebar.md`, `Home.md`.

1. Plan step, measured before edits: for each of the six README parts,
   name the wiki page and the heading it goes under, and list any
   sentence the page already has that says the same thing (so it is not
   said twice). Table in the PR body.
2. Move the text, kept as is except: cut duplicates found in step 1,
   change repo-relative links to full GitHub links, and cut any word
   that only makes sense on the README ("above", "below"). The Editor
   part goes under a new heading "From your editor" in
   `MCP-And-Manifests.md`. The Repo Map becomes `Repo-Map.md` with one
   line of intro. `_Sidebar.md` gets "Repo Map" under "Go deeper";
   `Home.md` gets one row for it.
3. Nothing on the README changes in this PR.

Budget: net across the five existing pages <= +260 (the six parts total
about 250 lines); `Repo-Map.md` <= 30 lines; no other new file.

## Open the report in one step (code PR, may run beside the first)

Files: `src/core/format/report-html.ts` (new, pure), `src/shell/report-view-cli.ts`,
`src/wiring/capability-table/reporting.ts`, `src/shell/reporter.ts`,
`src/shell/pipeline-cli.ts` (the end-of-run hook), `src/core/format/help.ts`
(one help line), one new smoke `test/report-open-smoke.js`.

1. Plan step, measured before code: list every caller of the `report`
   binding and of `reportWriteCli`; show how run ids sort under
   `.cw/runs/` and that the largest id is the newest by `createdAt` in
   `state.json` (check three runs); list the markdown forms the report
   writer uses (headings, lists, tables, fenced code, links, bold), by
   reading `src/shell/report.ts`. Tables in the PR body.
2. `report-html.ts`: a small pure function that turns the report's own
   markdown forms (only those from step 1) into one HTML page with a
   little inline CSS, readable in any browser. Text is escaped. No
   dependency. At most 110 lines.
3. `cw report` with no run id uses the newest run under this repo's
   `.cw/runs/`; with no run at all it prints one line: `No run yet. Try:
   cw -q "<question>"`. The MCP handler keeps requiring `runId`.
4. `cw report --open` (with or without a run id) writes `report.html`
   beside `report.md` if it is missing or older, then opens it with the
   system opener: `open` on macOS, `xdg-open` on Linux, `start` on
   Windows, spawned argv-style with `shell: false`, and prints the path
   it opened. If the opener is missing, it prints the path and exits 0.
5. The foolproof step: when `cw -q` (and `cw quickstart`) ends with a
   report on an interactive terminal, and not in `--json` mode, CW does
   what step 4 does by itself, so the report opens in the browser with
   no path and no id typed. `--no-open` or `CW_NO_OPEN=1` turns it off.
   Never on a non-TTY (Rule of Silence).
6. The end-of-run line becomes `Report opened. Again later: cw report
   --open` (and `cw report --show` stays as the second hint). `cw help`
   shows `report [run-id] [--show|--open]`.
7. Smoke `test/report-open-smoke.js`: the converter on a sample report
   (headings, table, code, link, bold present in the HTML, text
   escaped); no id picks the newest of two fixture runs; `--open` with
   `CW_OPENER` set to a stub script records the path it was given (the
   stub is how the smoke avoids opening a real viewer); no run prints
   the one line; the end-of-run hook does not fire on a non-TTY.

Budget: src net <= +190 (converter <= 110, the rest <= 80), smoke
<= +70, one new test file (the program's one). This PR merges before
the README PR, whose step 3 says the report opens by itself and shows
`cw report --open` for later.

## The README is one page (docs PR, second, after the first two merge)

Files: root `README.md`, then `npm run sync:readme`.

1. The README keeps, in this order: hero image and one line under it;
   one badge row; What is this, cut to three bullets and the one quoted
   line; Install (npm, with Homebrew in the folded `<details>`); Quick
   Start with its three steps, each cut to the command and one line of
   what you see, step 3 being "the report opens in your browser by itself" with
   `cw report --open` as the one command for later; "Can You Trust the Report?" cut to five lines that
   keep every sentence `test/readme-trust-claim-smoke.js` needs;
   Troubleshooting with at most seven rows, one of them still naming
   `builtin:claude`; "Works with your agent": one table, one row per
   agent, three columns (agent, flag, status), status is a check mark
   with one short note for the six supported (Claude Code `-claude`,
   Codex CLI `-codex`, Muse Code `-muse`, OpenCode `-opencode`, Gemini
   `-gemini` "through opencode", DeepSeek `-deepseek` "through opencode
   or an HTTP endpoint") and an empty box with "not yet" for Cursor,
   GitHub Copilot CLI, Aider, Qwen Code, Kimi; this table sits right
   under Install so a person decides in one screen; "Learn more": one
   link per moved part (User Guide
   first, then Why, How it works, What you can run, From your editor,
   Trust, Repo map, and the wiki home); License.
2. Plan step, measured before edits: the line count of the draft, and
   the output of `node test/readme-trust-claim-smoke.js`,
   `node test/claude-p-agent-wrapper-smoke.js`, `node test/readme-sync-smoke.js`
   and `node scripts/citation-check.js` on the draft. All four must pass
   before the PR opens.
3. The `cw demo tamper` GIF is removed from the README (the command and
   its one line of what you see stay in Quick Start step 1). The hero
   image stays. The pipeline image stays only if the page is still
   under the cap with it; the topologies image goes to
   `Workflow-Apps.md`. The GIF file itself stays in the assets folder
   until nothing links to it, then a later cleanup removes it.

Budget: README <= 120 lines after the cut (from 360). No new files.

## Closing ledger, wiki publish, receipt (docs PR, last)

1. Wiki publish, the one public step: the architect, holding the
   operator's word, pushes the 16 source pages (the 15 of today plus
   `Repo-Map.md`; `_Sidebar.md` and `Home.md` are among them) to
   `cool-workflow.wiki.git` as a fast-forward, after the
   closing worker has prepared the commit in a scratch clone and
   stopped. The worker never pushes.
2. Receipt at
   `plugins/cool-workflow/project/docs/audits/readme-one-page-receipt-<date>.json`,
   same shape as the earlier receipts: `commit`, `wikiCommit`,
   `version`, `startedAt`, `finishedAt`, checks: `readme-under-cap`
   (`wc -l README.md` <= 120), `readme-tests-pass` (the three README
   tests), `citations-resolve`, `six-parts-in-wiki` (the first line of
   each moved part is found in its wiki page), `wiki-pages-equal`
   (`diff -rq` of the 16 pages against a fresh wiki clone prints
   nothing), `md-count` (135/135), `agent-table` (the README holds one table with
   the six supported agents checked and the not-yet list, and no
   `demo.gif` reference). `verdict` pass only if all pass.
3. Fill the three sections below and the ledger. Archive nothing (the
   two-rows and run-folder files are already archived).

Budget: docs only, no src. The receipt gains one check, `report-open`
(`cw report --open` with no id on the walkthrough sample, with
`CW_OPENER` set to a stub, writes `report.html` and hands the stub its
path).

## Acceptance

- Manager (per PR): CI green, CodeQL green, Plan + before/after in the
  body, budget held, Chain line, no internal labels in committed text.
- Architect (program): the receipt's eight checks pass; then the new-user
  walkthrough is run again with the README on main as the only entry
  point (brief `newuser/rerun-brief-2026-09-03.md`), and its report
  says in one line whether the README made the tester want to try the
  tool or made them leave. That walkthrough is the operator's own order
  and is the last step of this program.

## Architecture snapshot diff (claims this program makes stale)

Checked the man pages under `plugins/cool-workflow/docs/*.7.md` that name
`cw report`, the end-of-run hint, or the run folder, plus the wiki page
`Getting-Started.md`, for claims this program's code change (open the
report in one step) or its doc moves made false.

- `project/docs/wiki/Getting-Started.md` showed the old end-of-run block
  — `Findings: 3 — 2×P1, 1×P2` then `Next: cw report <run-id> --show` —
  and told the reader to open the report by hand (`cw report <run-id>
  --show # or: cat .cw/runs/<run-id>/report.md`). Neither line matches
  the real build: a real terminal now opens the report by itself and
  prints `✓ Report opened. Again later: cw report --open`. Fixed in this
  PR: the block now shows the true printed lines, the read-it-again step
  points at `cw report --open`/`--show`, and a note covers the piped/
  `--json` case, where nothing changes.
- `project/docs/wiki/User-Guide.md` said a run ends with "a short
  findings table" and told the reader to run `cat
  .cw/runs/<run-id>/report.md`. Checked against
  `src/shell/pipeline-cli.ts`'s `formatQuickstartSummary` (the function
  this program wired in): it prints the report path, status, and the
  open/show hints — no findings table, and the report is already open
  by then. Fixed in this PR: the page now shows the true printed lines.
- `project/docs/wiki/Quickstart.md` said `cw quickstart architecture-
  review ...` "prints JSON". Before this program that was always true —
  `quickstart` had no human view at all. Now, on a real terminal with no
  `--json`, it opens the report and prints the short summary instead;
  JSON only comes back under `--json` or a pipe. Fixed in this PR: the
  page now shows both paths and adds `--json` to the example command.
- The man pages under `docs/*.7.md` that name `cw report` (`operator-
  ux.7.md`, `coordinator-blackboard.7.md`, `end-to-end-golden-path.7.md`,
  `multi-agent-operator-ux.7.md`, and others) all show `cw report <run-
  id> --show` with an explicit run id. That form still works exactly as
  shown — the run id became optional, it was never made wrong — so none
  of these needed a change. `cli-mcp-parity.7.md`'s `report` row (marked
  `identical`) is machine-written by `scripts/gen-parity-doc.js` and
  checked by `test/parity-doc-sync-smoke.js`; its `identical` label is
  about the `--json`/MCP payload shape with a run id given, which this
  program did not touch, so it still holds.
- Not fixed here: `formatFindingsSummary` (`src/shell/term.ts`), the
  function behind the findings table the wiki pages used to show, has
  no caller anywhere in the real build — its one caller,
  `Reporter.runSummary` in `src/shell/reporter.ts`, is itself never
  called. This is a source gap, out of the docs-only budget of this PR,
  so it is one row in `BACKLOG.md` instead of a source change here.

## What this spec got wrong (recorded at close)

- The spec said the end-of-run "Next:" hint was live. It was not. The
  hint sat in both `src/shell/reporter.ts` and `src/shell/term.ts`,
  neither called from production, and `quickstart` had no human render
  at all — so `cw -q` printed raw JSON even on a real terminal. The fix
  wired `reporter.ts` into `quickstart` for the TTY, non-JSON case,
  leaving the JSON path byte for byte as it was.
- Because of that, the README's promise of "a clean findings table at
  the end" was false when the spec was written. The report PR made the
  end-of-run summary real by wiring it in, rather than by softening the
  words — though, as the architecture snapshot diff above found, the
  findings table part of that old promise is still not wired to any
  caller; only the report path, status, and open/show hints print.
- The spec did not know the runtime source-context guard would block
  the feature. That guard covers all of `src` and sat at 49,967 of
  50,000 — 33 lines of room — while the feature needed 214. A sweep
  checked 1,091 exports and found only 8 dead, worth 13 lines, so the
  codebase was not padded; the guard was simply full. The user decided
  on 2026-09-03 to raise it to 50,250, with the measured numbers written
  into the commit message.
- `release:check`'s own "tests" step is a sampled run that never reaches
  `test/source-context-profile-smoke.js`, so that guard is only ever
  seen in a full `test:gate`. That is how it reached 33 lines of
  headroom unnoticed.
- A zero-caller export can still be a contract. The sweep first removed
  five `SCHEMA_VERSION` constants that no code calls; `scripts/schema-
  version-inventory.json` pins them and `validate-run-state-schema`
  fails closed when a listed domain has no definition. Counting callers
  in `src` and `test` was not enough — the inventory was a third place
  to check, and the five were restored.
- Two genuinely dead exports under `src/wiring/capability-table/` could
  not be removed at all, because `onramp:check` demands a public-docs
  update for any change in that directory, and the worker would not
  fake one. Separately, `version-sync-check` requires the literal text
  `ExecutionBackend` in `registry.ts`, pinning text rather than
  behaviour.
- Cutting the README to one page twice removed something another part
  of the system depended on: the resume row lost its "inside the
  project, or add `--repo`" condition, which an earlier receipt had
  measured as the difference between working and "Run not found"; and
  the "dogfood" sentence went, which `scripts/dogfood-release.js` reads
  from the README at HEAD and fails closed without. The first was
  caught by review, the second by the full gate. Both read correctly on
  `README.md` as it stands now.
- Process: a worker's Plan round is read-only by design, so it leaves no
  tracked change and its worktree gets cleaned up as unchanged. One
  worker lost its worktree that way between rounds. The rule now: a
  Plan-gated worker commits its Plan and opens its PR as a draft before
  it stops.
- Process: the manager named four `term.ts` exports as dead. Three were
  not: `sectionHeader` is called by `phaseProgressLine`, which
  `drive.ts` calls; and `stripAnsi`, `visibleWidth`, and
  `printSuccessSummary` all have test callers, the last being a byte-
  parity contract. Only `cyan` was dead. The worker's own measurement
  corrected the manager's list rather than following it.
- The one-page cut removed a sentence another program's receipt depends
  on. Nothing in the gates catches that: `readme-sentence` lives in a
  receipt, not in a test. The walkthrough caught it, and this closing PR
  put the sentence back under Quick Start step 3: "These three steps are
  the core path. Everything else is kept working, not grown."
- The walkthrough harness has no TTY, so TTY-only behaviour cannot be
  checked by it. A brief that asks for TTY-only behaviour must say to
  use a pseudo-terminal.
- The receipt's own `six-parts-in-wiki` check asked for a byte-for-byte
  first-line match, but the spec's own method for moving the six parts
  told the worker to do the opposite in two cases: cut a duplicate
  sentence when the wiki page already said the same thing, and give
  `Repo-Map.md` a fresh "one line of intro" instead of the README's own
  sentence, since it was designed as a new page, not a moved one. A
  check written against a first-line match and a method written to
  reword or replace that same first line cannot both be followed at
  once — work that did exactly what the spec's move method asked could
  never pass the spec's own first-line check. Reworded the check to
  what the spec meant: each of the six parts is present in its wiki
  page, where a twin sentence the page already had, or a designed new
  page, counts. The evidence did not change, only the yardstick.

A dead-export sweep merged separately as a source cleanup, trying to pay
for the report feature's runtime lines: #656 538f6e70.

## Status ledger

| Item | State | PR |
|---|---|---|
| Intent + spec (this file) | merged | #652 6a8f9182 |
| The wiki takes the six parts | merged | #654 e1fbf070 |
| Open the report in one step | merged | #655 963409b1 |
| The README is one page | merged | #658 827715ba |
| Closing ledger, wiki publish, receipt | open | #659 |

# Three gate fixes from the rot cleanup backlog

Intent and spec in ONE file. Closes the three BACKLOG rows the rot
cleanup program (`2026-09-02-rot-cleanup.md`) left behind. Operator's
order: clear all three, fully automated, same playbook.

## Intent

Three gates lie a little today. The onramp contract calls a comment
edit a code change. A release rehearsal installs without the lockfile
that every other install uses. The dist drift check trusts a build
cache that can skip the very files it should rebuild. Each is a gate
that can say "ok" for the wrong reason or "stop" for no reason.

## Design rules (same as the rot program)

R1 files not lines in comments; R2 named paths exist; R3 net small,
header comments <= 15 lines, this file is the only new .md; R4 one PR
per item, Chain line + before/after in the body; R5 Basic English.
Each PR deletes its own BACKLOG row in `project/docs/BACKLOG.md` —
that is what "the row ships" means. The three PRs touch different
files and may run in parallel.

## PR A — the onramp contract reads the diff, not the file list

Files: `src/shell/onramp.ts`, `scripts/onramp-check.js`,
`src/shell/doctor.ts` (the `--onramp` call path),
`test/onramp-check-smoke.js`.

1. `resolveChangedFiles` gains a second output, `commentOnly:
   string[]`: every changed `.ts`/`.js`/`.mjs` file whose diff lines
   (`git diff -U0 <base> -- <file>`, the `+`/`-` lines, not the
   `+++`/`---` headers) are ALL comment or blank. A comment line is
   one whose trimmed text starts with `//`, `/*`, `*` or `*/`. An
   untracked file is never comment-only. Any other file kind is never
   comment-only. Put the line test in one small exported pure
   function that takes the patch text, so the smoke can feed it a
   string.
2. `evaluateOnrampContract(files, { cwd, commentOnly })`: a file in
   `commentOnly` is left out of the runtime, app, type, script and
   surface sets. It stays in `changedFiles` and in the smoke
   recommendations. No rule changes otherwise.
3. `scripts/onramp-check.js` and the doctor path pass `commentOnly`
   through. With no `commentOnly` given, behavior is exactly today's.
4. Smoke cases: (a) a `src/shell/*.ts` change with no test change
   fails `runtime-smoke-required`, and the same file in `commentOnly`
   passes; (b) a surface file in `commentOnly` with no doc change
   passes; (c) the pure function: a patch of `//` lines is comment
   only; a patch with one code line is not; a line `"http://x"`
   inside a string is code, not a comment; a `/* ... */` block edit
   is comment only; a patch that removes a code line is not.
5. If a man page describes the contract's rules today, add one
   sentence there; if none does, add none.

Budget: src net <= +60, smoke net <= +45. The header comment on
`onramp.ts` must not grow.

## PR B — the bump rehearsal installs from the lockfile

File: `scripts/verify-bump-reproduction.js`. The scratch worktree is
a checkout of a commit, and `package-lock.json` is tracked, so the
lockfile is there. Change the install step to `npm ci
--ignore-scripts`. Before it, fail closed with one clear line if the
scratch worktree has no `package-lock.json`. The proof is the
existing `test/verify-bump-reproduction-smoke.js`, which runs the
real script end to end — quote its pass in the PR body, and also
quote one run of the script by hand. No new assertion on the script's
text. Budget: net <= +6.

## PR C — the dist drift check builds from nothing

Files: `scripts/dist-drift-check.js`, one new
`test/dist-drift-check-smoke.js`. Today `tsc` is incremental
(`tsBuildInfoFile: .cache/tsconfig.tsbuildinfo`): with a warm cache
and unchanged src, the build emits nothing, so a `dist/` file edited
by hand is not rebuilt and the check says "matches". Fix: delete
`.cache/tsconfig.tsbuildinfo` before the rebuild (only that file),
and say so in one stdout line. Smoke: in a copy of the package (or
the package itself with the file put back after — the existing
smokes show both ways), append one comment line to one `dist/*.js`
file, run the check, assert exit 1 and that the file is named as
`changed:`; then restore and assert exit 0. Update the header comment
in three lines at most, no growth past 15. Budget: script net <= +12,
smoke <= +50.

## Acceptance

- Manager (per PR): CI green on all platforms, CodeQL green,
  before/after in the body, budget held, Chain line, own BACKLOG row
  deleted, arm auto-merge only after CodeQL is green.
- Architect (program): on main, `release:check` 18/18 and
  `onramp:check` on a comment-only branch reports ok; `dist:check`
  fails on a hand-edited dist file; `verify-bump-reproduction` passes
  on the real 0.2.2 pair; BACKLOG has none of the three rows; md count
  132/135.

The half of the first BACKLOG row about test strings stays as it was:
`citation-check` rule (c) reads `//` lines only in `test/`, by design,
because fixture strings use fake paths. That fact lives here now, not
in BACKLOG.

## What this spec got wrong (recorded at close)

1. PR A listed `src/shell/doctor.ts` as a file to change. The
   `--onramp` call path is `buildDoctorOnramp` inside `onramp.ts`, so
   `doctor.ts` needed no edit.
2. PR C's 15-line header cap pushed out one true sentence: the check
   is git-independent on purpose, and committed-vs-built drift is
   held by the porcelain step in `.github/workflows/ci.yml`. That
   pointer is now nowhere in the script. R3's cap is for growth; it
   should not cut a sentence that explains a design choice.
3. R4 said each PR deletes its own BACKLOG row, and three PRs did, on
   three ADJACENT lines of one table. The second and third merges
   conflicted on context. Rule from it: merge `origin/main` into the
   open PR branch, never rebase or force-push it; or land such rows
   one PR at a time.
4. The spec did not say "run `test:gate`, not the sampled `npm
   test`, before push". PR B's `npm ci` broke an existing fixture in
   `test/verdict-signing-workflow-smoke.js` (it wrote no lockfile) and
   the 35-smoke sample missed it; the worker found it on a direct run
   and fixed the fixture without weakening the assertion. CI runs the
   full gate, so it would have been caught there — but a round later.
   Third such case in two programs: the rule now goes in every brief.

## Status ledger

Program COMPLETE 2026-09-02. Main `d1d683d0` after PR A.

| Item | State | PR |
|---|---|---|
| Intent + spec (this file) | merged | #614 c9098b1a |
| PR A onramp contract reads the diff | merged | #617 d1d683d0 |
| PR B bump rehearsal installs from the lockfile | merged | #615 867ad21e |
| PR C dist drift check builds from nothing | merged | #616 5f754017 |

Closing numbers, measured by the architect on `d1d683d0` and by the
manager on each head: BACKLOG 12 rows -> 9, the three program rows
gone; `onramp:check` on a comment-only edit to `src/shell/drive.ts`
reports ok with the file in `commentOnly`, and the same file with one
code line still fails `runtime-smoke-required`; `dist:check` on a
hand-edited `dist/cli.js` reports `changed: cli.js` (before: "matches");
`verify-bump-reproduction` smoke passes on the real 0.2.2 pair;
`release:check` 18/18; `test:gate` 265/265 (one new smoke);
`growth:check` md 132/135, src-comments 7177 -> 7188. Budgets: A src
+47/60, smoke +28/45; B +4/6; C +2/12, smoke 45/50. Rounds 1, 1, 1.
PR A was opened by the operator by hand: the `gh pr create` step was
refused by the permission classifier in two agent sessions, and no
agent routed around it. Nothing pushed to main; every PR merged on
green CI with CodeQL.

# Rot cleanup: doors that are not there

Intent and spec in ONE file (size discipline: one .md for the chain).

## Intent

The 0.2.7 release gate was rejected by a test that still waited for a
check that was taken out long ago (#598). The operator asked: how much
more code "knocks on doors that are not there", and how much is rot?
An audit on 2026-09-02 (main `dbcc635e`, read-only scan + two agents)
gave the numbers below. Ruling from the operator: clean ALL of it, in
the four PRs below, then put a gate on it so it cannot come back.

## Findings (measured, main dbcc635e)

- `src/shell/onramp.ts` `CURATED_SMOKE_MAP`: 19 of 33 path patterns
  name files that are not in the tree (old flat names from before the
  v2 rebuild: `src/drive.ts`, `src/capability-core.ts`,
  `src/scheduler.ts`, `src/multi-agent`, ...). `cw doctor --onramp`
  routes changed files to smokes by this table, so those rows never
  fire. The header comment says the table was "fixed"; two rows were.
  No test checks the table against the tree.
- `test/run-all.js` `AGENT_ENV_KEYS` strips agent env from every smoke
  child, but not `CW_RELEASE_VERDICT_PRIVKEY`. 78 of 80 smokes pass
  `process.env` through. The same event happened before with
  `CW_AGENT_COMMAND` (see the comment at the list); the list is the one
  place to close it.
- Live docs name 7 source files that are not in the tree, as bare
  names with no directory (`capability-core.ts`,
  `capability-dispatcher.ts`, `capability-registry.ts`,
  `command-surface.ts`, `gc.ts`, `orphans.ts`, `run-registry.ts`).
  `citation-check` only reads tokens that have a "/", so these pass.
- 3 exported functions have no caller anywhere: `topologyRunShowCli`
  (`src/shell/multi-agent-cli.ts`), `writeTrustAuditIndexPlaceholder`
  (`src/shell/trust-audit.ts`), `declaredMcpToolsList`
  (`src/wiring/capability-table/parity.ts`). 7 more are exported but
  used only in their own file: `completionWords`, `mcpToolAuthority`,
  `startToolProcessWorker`, `contentDigest`, `reconstructArtifact`,
  `leaseComplete`, `leaseRelease`.
- `test/multi-agent-eval-replay-harness-smoke.js` is 4 lines that
  `require` another smoke: one test, run twice in the gate.
- Cites of the form `path:line`: 86 in `src/`, 162 in `test/`. Most
  name old-build files (`src/orchestrator.ts` 15, `src/drive.ts` 9,
  `src/cli/command-surface.ts` 9, `src/capability-core.ts` 7, ...).
  About 66 comment lines in src/scripts and 27 in test name a file that
  is gone. 301 "old build" notes sit in 114 src files.
- Clean, checked, no work: 0 orphan scripts (56), 0 skipped tests
  (459), 0 doc/CLI drift over 232 capability rows, 0 documented env
  vars that nothing reads, and the "one dead regex branch" class of
  #598 has exactly one instance (now fixed).

## Design rules (bind all four PRs)

- R1. A path in a comment names a FILE, never a line. Line numbers rot
  first; a file name or a symbol name is enough.
- R2. Every path that code or a live doc names must exist in the tree,
  and a gate must say so.
- R3. Net lines for the program: negative. New .md: zero past this
  file. Header comments <= 15 lines.
- R4. One PR per item, no bundling. Each PR body carries the Chain
  line and the measured before/after numbers.
- R5. Basic English in all committed prose (the ballast rule).

## PR 1 — hermetic gate + live onramp table

Files: `test/run-all.js`, `src/shell/onramp.ts`,
`test/onramp-check-smoke.js`. Runs in parallel with PR 2.

- Add `CW_RELEASE_VERDICT_PRIVKEY` to the strip list in `run-all.js`;
  update the comment above it so it names both events. Keep the
  per-test scrub from #598 (it guards a standalone `node test/x.js`).
- In `CURATED_SMOKE_MAP`, put each dead pattern at the file's true
  current place (find each with `ls`/`grep`; list the old -> new map in
  the PR body). Drop a pattern only when nothing took the old file's
  place. Fix the header comment that says "fixed".
- Export `CURATED_SMOKE_MAP`. In `test/onramp-check-smoke.js` assert:
  every pattern is an existing file, or a prefix of at least one
  existing file; every named smoke exists under `test/`. No new test
  file.
- Budget: net <= +40 lines.

## PR 2 — dead doors: docs, dead exports, doubled smoke

- Put each of the 7 bare names in live docs at the true file, WITH its
  directory, in backticks — so `citation-check` reads it from now on.
  Read the sentence around each to find the file that holds that code
  now. `docs/release-history.md` and `project/docs/**` stay as they
  are (history).
- Delete the 3 functions with no caller. Take `export` off the 7 used
  only in-file. Do NOT touch the 210 exported types (named shapes; out
  of scope).
- Delete `test/multi-agent-eval-replay-harness-smoke.js`; fix any doc
  that names it (`docs/multi-agent-eval-replay-harness.7.md` may).
- Run `build`, `check`, `test`, and the doc gates that `release:check`
  runs (`gen:manifests --check`, `parity:check`, `citation:check`);
  `sync:readme` if the README changed.
- Budget: net negative.

## PR 3 — old addresses out of comments

After PR 1 and PR 2 merge. Comments only; no code change.

- Every `path:line` cite in `src/` (86) and every cite on a COMMENT
  line in `test/` (fixture trees in strings use fake paths like
  `src/a.ts` — leave strings alone): drop the `:line` part. If the file
  is gone, name the file that holds the code now, or the symbol, or
  drop the cite when the sentence stands without it.
- "old build" / "byte-exact port" wording may stay where it states a
  constraint; the dead path and the line number go.
- Budget: net <= 0.

## PR 4 — the gate

After PR 3 merges. Files: `scripts/citation-check.js`,
`test/citation-check-smoke.js`.

- Extend `citation-check` with four rules:
  (a) live docs: a bare backtick name ending `.ts`/`.js` must match a
  file basename under `src/`, `scripts/`, `test/`, or `apps/`;
  (b) `src/**/*.ts` and `scripts/**/*.js`: every repo path token, with
  or without a `:line` suffix, must exist in the tree. Token shape
  (corrected 2026-09-02 — the first form, `(src|...|docs)/...`, matched
  INSIDE `project/docs/rebuild/PLAN.md` and so flagged a true path):
  take the whole path run — the longest `[A-Za-z0-9_./-]+` run that
  ends in `.ts`, `.js`, `.mjs`, `.json` or `.md` and is not preceded by
  a word character, `/`, `.` or `-`. It is a repo path when its first
  segment is one of `src`, `scripts`, `test`, `apps`, `docs`,
  `project`, `v2`, `plugins`, `.github`. Resolve it against the plugin
  root, then the repo root (the two roots `citation-check` uses now).
  `project/docs/rebuild/PLAN.md` is one token and resolves;
  `docs/rebuild/PLAN.md` is one token and does not;
  (c) `test/**/*.js`: same as (b), but only on lines that start with
  `//`;
  (d) a `:line` suffix in (b) or (c) is a failure by itself (R1).
  Placeholders (`<>`, `*`), `project/docs/**`, and `release-history.md`
  stay excluded as now.
- One smoke case per rule, hermetic through `CW_CITATION_DOCS` /
  `CW_CITATION_ROOT` (add one more override for a fake source tree if
  needed).
- It runs where `citation:check` runs now (`release:check`, and `npm
  test` through the smoke). Run it first on main after PR 3; fix any
  leftover in this same PR (should be small).
- Header <= 15 lines. Budget: net <= +70.

## PR 5 — TypeScript 7 install path in CI (added 2026-09-02)

Operator's order: "the whole project on TS7". Checked on main: the
package is already on TypeScript 7.0.2 (npm latest; bumped in #533),
tsconfig is NodeNext/ES2022, the lockfile holds all 20
`@typescript/typescript-<platform>` packages, `tsc --version` says
7.0.2, `npm run check` is clean with no deprecation notes, no script
uses the TypeScript JS API, and no live doc names TS 5. One thing is
NOT on TS7 terms: TS7's compiler is a native binary picked per
platform, but `ci.yml` (3 jobs) and `bench.yml` still install with
`npm install --no-package-lock --ignore-scripts`, so each run asks npm
to pick the platform package fresh. PR #601's macOS job failed in 15s
that way ("Unable to resolve @typescript/typescript-darwin-arm64").
`release-gate.yml` and `npm-publish.yml` already use `npm ci` and say
in a comment not to go back.

- Files: `.github/workflows/ci.yml` (lines 34, 92, 129),
  `.github/workflows/bench.yml` (line 35) — at the REPO root, not
  under the package.
- Change: each `npm install --no-package-lock --ignore-scripts` becomes
  `npm ci --ignore-scripts`. The jobs already run with
  `working-directory: plugins/cool-workflow`, so no `--prefix`.
- Keep `npm audit --audit-level=high` as it is.
- Proof in the PR body: `npm ci --ignore-scripts` clean on the
  executor's machine from a fresh `node_modules`; the CI run of the PR
  itself green on Node 18, 22, 24 and macOS.
- No .md, no code. May run in parallel with PR 3 / PR 4 (disjoint).

## PR 6a / 6b — dead paths with no line number (added 2026-09-02)

Two corrections to this spec, found by the manager while running the
PR 4 rules as a script against the PR 3 branch:

1. The PR 4 line "fix any leftover in this same PR (should be small)"
   was wrong. PR 3 removed every `path:line` cite (86 -> 16, the 15 in
   four surface files plus one sample string), but rules (b) and (c)
   also flag paths with NO line number that name a file that is gone:
   386 sites (src 280, scripts 9, test comment lines 97). 70 of them
   are `docs/rebuild/PLAN.md`, which exists at
   `project/docs/rebuild/PLAN.md`; most of the rest are old-build
   provenance notes ("byte-exact port of src/drive.ts" — top:
   `src/capability-core.ts` 16, `src/drive.ts` 10, `src/state.ts` 9,
   `src/dispatch.ts` 9); a few are sample paths in test comments.
   The audit's "about 66 + 27" only counted a short list of old names.
2. The onramp contract (`release:check`, `evaluateOnrampContract`)
   counts a comment-only edit to a surface file as a surface change
   and demands a doc change. PR 3 hit it on four files with no honest
   doc change to make. Ruling: no exemption door, no diff-aware
   rewrite in this program; the surface files move to PR 4, which has
   a true doc line of its own. The contract's limit (path strings
   only) goes to BACKLOG at close.

Ruling on the 386: the operator's order is "clean ALL of it", so all
of them go, split by directory so that three PRs never touch the same
file and no comment-only PR touches a surface file (the split follows
`isSurfaceFile` in `src/shell/onramp.ts`). Gate lands last, as the
proof of zero.

- PR 6a: every dead path token in `src/**/*.ts` EXCEPT the surface
  files (`src/cli/*`, `src/mcp/*`, `src/core/capability-table.ts`,
  `src/core/capability-data.ts`, `src/wiring/capability-table/*`,
  `src/shell/orchestrator.ts`). Comments only.
- PR 6b: every dead path token in `scripts/**/*.js` (except
  `scripts/parity-check.js`) and on `//` comment lines in
  `test/**/*.js`. Comments only.
- PR 4 (after 6a and 6b): the gate + all surface files' comment edits
  (the 15 `path:line` cites and any dead no-line paths, plus
  `scripts/parity-check.js`) + the `telemetry-demo.ts` sample string
  (`src/server.js:18` -> `app/server.js:18`, with its two fixtures) +
  one true doc line in the man page that describes `citation:check`,
  saying what the gate checks now. The gate must be green on the PR's
  own head.

Rewrite rules (bind 6a, 6b, and PR 4's comment edits):

1. A path whose file exists at a new place names the new place
   (`docs/rebuild/PLAN.md` -> `project/docs/rebuild/PLAN.md`).
2. A provenance note that names a file that is gone keeps its meaning
   and loses the path: the module as a plain word, no directory, no
   extension ("the old build's drive module"). No line numbers (R1).
3. A sample path in a test comment must not look like a repo path:
   use a root that is not src/scripts/test/apps/docs (`app/` is fine),
   or reword.
4. Comment lines only. A dead path in a code string is reported, not
   changed; PR 4 owns code strings.
5. Before push: the manager's rule script reports 0 on the partition;
   `build`, `check`, `test` green; `growth:check` src-comments does not
   go up. The PR body gives the count per rewrite rule and the
   before/after totals.

Budget: net <= 0 for 6a and 6b. PR 4 budget stays net <= +70 for the
gate itself; its comment edits are net <= 0.

Third correction (2026-09-02, from the manager's run of 6a): the
onramp contract has a second path-only rule, `runtime-smoke-required`
— a change under `src/` with no change under `test/` fails
`release:check`. So 6a (src only) can never pass on its own, the same
way PR 3 could not pass `surface-docs-required`. Ruling: 6a and 6b
become ONE PR, "PR 6" (src non-surface + scripts + test comment
lines): the test/ comment edits satisfy `runtime-smoke-required`, and
the surface files stay out so `surface-docs-required` stays quiet.
Same rewrite rules, one body with the counts per partition. The
contract's two path-only rules go to BACKLOG at close as one row.
Also: rule 1 is to be applied in its natural form
(`project/docs/rebuild/PLAN.md`), not as a workaround phrasing — the
corrected token shape in PR 4 makes that form resolve.

## PR 7 — stale cut-over claims in test and src comments (added 2026-09-02)

Found by the 6b worker in `test/remote-link-git-smoke.js`: a header
says v2 "DROPPED the entire runtime", that every remote-source symbol
"is ABSENT", and "leave it RED until Phase B re-lands the feature".
Measured on main 08ba5400: `src/shell/remote-source.ts` exports all
of them, `src/shell/pipeline-cli.ts` wires `--link` and the `-dir
<url>` auto-detect, and the smoke passes 6/6 sections. The feature
came back in the same cut-over commit (#334) that kept the old
header. The assertions were right the whole time; only the words
were wrong.

The class is wider than one file. Markers `REAL-GAP`, `CUTOVER
AUDIT`, `CUTOVER STATUS`, `CUTOVER NOTE`, `Phase B`, `left failing`,
`leave it RED`, `do NOT weaken`, `not ported` sit on 120 lines in 60
files (58 smokes, `src/shell/audit-cli.ts`, `src/wiring/
capability-table/parity.ts`), plus one site the grep misses because
the marker breaks across two lines (`src/shell/pipeline-cli.ts`,
`quickstartCheck` note) — and `test:gate` is 265/265 green. So every "this test is RED on purpose"
claim is false today. A reader who trusts them stops looking for the
feature that is there. Also in scope: rule 4 of PR 6 was written for
paths; a claim is not a path, so this class needs its own PR.

Scope (one PR, comments plus the dead scaffolding around them):

1. In `test/remote-link-git-smoke.js`: header block goes down to the
   contract lines it already carries at the top; the try/catch and
   `_remoteSourceLoadError` go, replaced by a plain `require` of
   `dist/shell/remote-source.js`; the section-0 assertion message
   says what it checks, not what was missing. Sections 1–5 keep every
   assertion as is.
2. In every other file on the list: drop the marker paragraph. When
   the paragraph also says what the test proves, keep that sentence.
   When a "Phase B:" line is provenance for real code (the two src
   sites), keep the meaning and drop the label ("the audit verbs the
   old build had, ported as thin wrappers").
3. In `src/shell/pipeline-cli.ts`: the `quickstartCheck` note "the
   --link/remote preflight variant is not ported" goes; the function
   handles a remote candidate a few lines down.
4. No assertion becomes weaker. No assertion is added. A smoke whose
   body truly still fails is reported, not edited — expected count 0,
   since the gate is green.
5. Proof: a grep for the nine markers over `src/ scripts/ test/`
   reports 0 after; `build`, `check`, `test:gate` green;
   `growth:check` src-comments goes down. The PR body gives the
   before/after count of marker lines and files.

Gate: the PR 4 gate gets rule (e): the nine markers are forbidden in
`src/ scripts/ test/` comment or string text. One list, one regex, no
new script file. PR 7 lands after PR 4, so rule (e) is red on main
for the gap between them only if PR 4 lands first — the manager runs
PR 4 with rule (e) present but checked against PR 7's branch, or
lands PR 7 first and adds rule (e) in PR 4. Either order; the ledger
says which.

Budget: net negative (about -100 lines). Zero new files. Touches
src and test together, so both onramp rules stay quiet.

## Acceptance

- Manager (per PR): CI green on all three platforms, CodeQL green,
  before/after numbers in the body, budget held, Chain line present.
  Arm auto-merge only after CodeQL is green (ruling from #584).
- Architect (program): re-run the rot scan on main. Expect: 0 dead
  onramp patterns, 0 bare-name misses in live docs, 0 `path:line`
  cites in src/scripts/test comments, 0 exported functions with no
  caller, `citation:check` green, `test:gate` green, program net lines
  negative.

## PR 8 — six more export-only-internal functions (added 2026-09-02)

The architect's closing scan on main aaaf238d found six functions
still exported but used only in their own file: `requireRunTask`,
`findRunNode`, `resolveReviewPolicy`, `sha256OfFile`,
`isBundledSandboxProfileId`, `listWorkflowAppRecords`. PR 2's audit
missed them because a comment or test line in another file still
named them; PR 3, 6 and 7 rewrote those lines. Scope: take `export`
off each (in-file callers stay), and list the six as `dead` in
`test/dead-export-removal-guard-smoke.js` beside a live sibling, so
the guard holds them down. Net <= 0 for src. This section landed
AFTER #612 merged (same closing PR as the ledger): PR 8 took its
scope from the manager's brief, and its body says so. It is the one
PR in this chain whose authority was the brief, not this file.

## What this spec got wrong (recorded at close)

1. PR 2 did not say the doubled smoke was also the `eval:replay` npm
   entry and a `version-sync-check` row; deleting it broke both and
   cost a round. Rule from it: grep the whole repo (package.json,
   scripts/, .github/, docs/, test/) before a delete or rename.
2. PR 4 said the leftovers "should be small". They were 386, then 401
   after PR 3 narrowed. Became PR 6.
3. The first token shape matched inside `project/docs/rebuild/PLAN.md`,
   so rule 1's natural form could never pass. Fixed in #607.
4. The manager's counting script had a second bug — `(?:ts|js|md)`
   with no trailing guard read `package.json` as `package.js` — and
   my own PR 3 count command counted grep's `file:line:` prefix. Both
   fixed before any number was written down.
5. The marker baseline for PR 7 was case-sensitive: 120 lines / 60
   files instead of the true 142 / 67. "Leave it RED" hid behind a
   capital L in the very file that started PR 7.
6. Two onramp rules read paths, not diffs, and blocked two
   comment-only PRs (PR 3, PR 6a). Ruling: no exemption door; PR 3
   narrowed, 6a and 6b became one PR. BACKLOG row at close.
7. Finding "7 bare names" was 7 sites over 6 names;
   `capability-dispatcher.ts` names code deleted in v0.1.81, so that
   site lost its `.ts` instead of getting a made-up path.

## Status ledger

Program COMPLETE 2026-09-02. Main `b7487a6b` after PR 8.

| Item | State | PR |
|---|---|---|
| Intent + spec (this file) | merged | #599, amended #602 #605 #607 #609 |
| PR 1 hermetic gate + onramp table | merged | #600 fcbdec87 |
| PR 2 dead doors | merged | #601 fdd6d9fd |
| PR 3 old addresses out of comments | merged | #604 833887b6 |
| PR 4 citation gate | merged | #610 917db2d9 |
| PR 5 TS7 install path in CI | merged | #603 fc8ab073 |
| PR 6 dead paths in src (non-surface) + scripts + test comments | merged | #606 5876f6da |
| PR 7 stale cut-over claims in test and src comments | merged | #611 aaaf238d |
| PR 8 six export-only-internal functions | merged | #612 b7487a6b |

Closing numbers, re-measured by the architect on `aaaf238d` and by
the manager on `b7487a6b`: dead onramp patterns 19/33 -> 0/35;
bare-name doc misses 7 -> 0; `path:line` cites in src/scripts/test
comments 248 -> 0; dead no-line paths 386 -> 0; stale cut-over
markers 142 lines / 67 files -> 0; exported functions with no caller
3 -> 0, exported-but-file-only 13 -> 0; `citation-check` 62 docs, 664
source files, all resolve; `growth:check` md 130 -> 131 (this file
only), src-comments 7210 -> 7177; `release:check` 18/18; `test:gate`
264/264 (one local run gave 263/264 with the failing name lost to a
short log; the re-run and CI gave 264/264 — recorded, not explained).
Program net: 418 files, +1727 / -2343 = -616 lines (R3 held). Rounds:
1, 2, 1, 3, 3, 1, 1, 1. Nothing pushed to main; every PR merged on
green CI with CodeQL.
