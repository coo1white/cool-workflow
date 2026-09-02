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
- `BACKLOG.md` is 5 rows; the three closed ideas are recorded only in
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
