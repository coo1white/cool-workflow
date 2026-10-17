# Less code, same behaviour: comments and shared helpers

Intent and spec in ONE file, in the shape `AGENTS.md` "Intent files (the
playbook)" asks for. Source: the operator on 2026-09-04, after raising
the runtime source-context guard to 50,250 for the report feature:
"我担心的是代码过于膨胀 ... 帮我看看整体压缩的办法", then "先做路一加路二，
写成规格排在 README 之后". Path one is comment history; path two is
duplicate helpers. Path three (deleting unused platform surfaces) is a
product decision the operator will take block by block, not here.

## Intent

The tree gets smaller with no change in what it does. Comments that
tell where code came from, when, or what an older version did go;
comments that say what the code does now, why, or what must not change
stay. Small helper functions copied into many files become one shared
copy each. After this program the runtime guard sits well under its
50,250 ceiling again, and the comment ceiling is tightened to the new
measured number so the gain cannot leak back.

## Measured facts (checked by command before design)

- `src/` is 49,848 lines: shell 29,408, core 14,603, wiring 4,408, cli
  699, mcp 686. Comment lines (first non-space `//` or `*`): 7,205, with
  the growth ceiling at 7,571. Tests are 66,874 lines in 459 files and
  are outside the runtime guard.
- Comment lines that match history words: 683 in all, by pattern:
  "old build / old flat / pre-rebuild / rebuild" 418; "MILESTONE" 267;
  "cut-over / port of / ported from / extracted with sed" 182;
  "byte-for-byte / byte-exact / byte-compat" 126; "audit / reviewer
  found" 122; version tags 14 (patterns overlap). A matching line is
  usually one line of a longer block, so the whole block is the real
  size; a first read of `src/shell/drive.ts` (319 comment lines) puts
  the history share near half.
- Files with the most comment lines: `shell/drive.ts` 319,
  `shell/trust-audit.ts` 234, `shell/fs-atomic.ts` 205,
  `shell/pipeline-cli.ts` 189, `shell/worker-isolation.ts` 170,
  `mcp/server.ts` 165, `shell/execution-backend/agent.ts` 160,
  `core/capability-data.ts` 158.
- Duplicate helpers, defined as a function of the same name in three or
  more files: `unique` 11, `optionalString` 9, `invocationCwd` 8, `now`
  7, `messageOf` 7, `isRecord` 7, `countBy` 7, `compact` 7,
  `safeFileName` 6, `truncate` 5, `sha` 5. Eight file headers say the
  copy is kept "as a local copy" on purpose. `src/core/util/` exists
  with three files (107 lines). The one-way rule (`test/one-way-boundary-smoke.js`)
  lets shell import core, never the other way; `purity:check` keeps
  clock, env and fs out of core, so `now` and `invocationCwd` (they read
  the clock and `process.cwd`) can only be shared inside shell.
- Rules that bind every edit: comments cite files, never line numbers
  (`citation:check`); the frozen-path ceilings in
  `manifest/growth-budget.json` may go down, never up; the sweep of
  2026-09-03 showed a zero-caller export can still be a contract
  (schema inventory, version-sync literal pins), so nothing is deleted
  by name alone.
- md count: 135/135 when this file was written; it lands after the
  README program's closing PR archives the closed freeze intent.

## Paths weighed (complexity / upkeep / cost / can it be undone)

- Comments: (1) delete every comment: throws away real "why" notes;
  (2) delete only comments that tell history (where from, when, what
  an older build did), keep "what" and "why", one rule applied file by
  file with the diff read by the manager: chosen; (3) a script that
  strips comments by pattern: blind, would cut live notes that happen
  to say "rebuild". Chosen: 2, with the patterns above as the finding
  aid, not the rule.
- Helpers: (a) leave the copies, as eight headers ask: 400 lines of
  the same code in eleven shapes, and each copy drifts; (b) one shared
  pure module in `core/util/` for the pure ones and one shell module
  for the two that touch the clock or cwd, merging only bodies that are
  the same or differ in a way the body table shows is harmless: chosen;
  (c) a big shared utility module for everything: the thing the eight
  headers rightly feared. Chosen: b; the "local copy" headers go with
  the copies, and `AGENTS.md` gets one line that names the new rule.
- Effect framework: rejected for good (see the archive).

## Rules for every PR in this program

Same as the last programs: isolated worktree, `npm ci` first, Plan
committed and a draft PR opened before any stop, all gates before push
with the pass lines quoted, three-dot diffs, CodeQL green before
auto-merge, max 3 rounds, the manager reads the pushed diff, a
stand-down is the last message a worker gets. No behaviour change: the
full gate and `release:check` must pass with no test edited except
where a test asserts on a comment or on a helper's module path.

## History goes, "what" and "why" stay (code PR, comments only)

Files: any file under `src/`; `manifest/growth-budget.json` (tighten
only).

1. Plan step, measured before edits: for each of the twelve files with
   the most comment lines, count the comment lines and mark each block
   H (history: where from, when, older build, milestone, audit that
   found it, byte-for-byte port) or K (keep: what it does, why, a
   contract, a gotcha, a file citation). Put the counts in the draft
   PR. Then do the same for every other file with ten or more comment
   lines, in the same table.
2. Delete the H blocks. A block that mixes H and K keeps its K
   sentences. No code line changes. No comment gains a line number.
3. After the sweep, set `srcCommentLines.maxCount` in
   `growth-budget.json` to the new measured count plus 50, and lower
   any frozen path's `measured` and `maxLines` to its new count. Never
   raise a number.
4. Smoke: none new; `growth:check`, `citation:check` and the full gate
   are the proof. The PR body quotes comment lines before and after
   and src lines before and after.

Budget: src net <= -1,500 (the aim is -2,000 or more), zero non-comment
lines changed, no new files.

## One copy of each small helper (code PR, after the first merges)

Files: new `src/core/util/common.ts` (pure helpers), new
`src/shell/cli-common.ts` (`now`, `invocationCwd`), the files that
hold the copies, `test/util-common-smoke.js` (new, the program's one
new test file), `AGENTS.md` (one line).

1. Plan step, measured before code: a table with one row per helper
   name: every file that defines it, the body length, and whether the
   bodies are the same. Helpers whose bodies differ in meaning (not
   only in names or spacing) stay where they are and are listed as
   kept, with the reason.
2. Move each same-body helper once into the shared module, delete the
   copies, add the import lines. `truncate` in `shell/term.ts` is
   width-aware and is expected to stay; the plain string `truncate` is
   the one that merges. Nothing else in any file changes.
3. Delete the eight "kept as a local copy" header sentences that no
   longer hold. `AGENTS.md`, in "# FreeBSD Engineering Discipline" or the
   nearest rules part, gets one line: "A pure helper of twenty lines or
   less that three files need lives once in `src/core/util/`; a copy is
   a bug."
4. Smoke: `test/util-common-smoke.js` calls each shared helper with the
   inputs the old copies' own tests used, and asserts
   `test/one-way-boundary-smoke.js` and `purity:check` stay green.
5. Frozen paths that lose a copy: lower their numbers in
   `growth-budget.json` in the same PR.

Budget: src net <= -250 (the aim is -350), new files: 2 src, 1 test,
smoke <= +80.

## Closing ledger and receipt (docs PR, last)

1. Receipt at
   `plugins/cool-workflow/project/docs/audits/compress-src-receipt-<date>.json`,
   same shape as the earlier receipts: `commit`, `version`, checks:
   `src-lines-down` (src total before and after, after < before by at
   least 1,750), `comment-lines-down` (before, after, new ceiling),
   `runtime-guard-room` (the profile smoke's runtime count and the
   50,250 ceiling, room >= 1,500), `no-behaviour-change` (full gate
   green, release:check 18/18, no test changed except the two kinds
   named above), `frozen-tightened-only` (every frozen number in the
   manifest is <= its value on the day the program started),
   `helpers-once` (each merged helper name is defined in exactly one
   file under src). `verdict` pass only if all pass.
2. Fill the three sections below and the ledger. Archive nothing new.

Budget: docs only.

## Acceptance

- Manager (per PR): CI green, CodeQL green, Plan + before/after in the
  body, budget held, Chain line, no internal labels in committed text.
- Architect (program): the receipt's six checks pass; a reader opening
  `src/shell/drive.ts` sees comments that say what and why and no
  comment that says where the code came from.

## Architecture snapshot diff (claims this program makes stale)

(filled by the closing PR)

## What this spec got wrong (recorded at close)

Found in the comment PR (run as step 3 of `2026-09-28-slim-and-esm.md`,
numbers measured again on `b73733d2`, after the D1 delete):

- The tree it measured is gone. `src/` was 36,053 lines in 131 files
  (shell 23,002, core 8,212, wiring 3,328, mcp 776 + 35, cli 691 + 9),
  not 49,848. Comment lines by the `growth:check` count were 6,167 (the
  manifest said 5,999 as of 2026-10-16; the five refactors #793 to #797
  had put 168 back, leaving only 60 lines of room under 6,227). With
  `/*` lines counted too, as the slim-and-esm file counts them: 6,947.
- History lines were 536, not 683, by the same patterns ("rebuild" 309,
  "milestone" 186, "port of" 146, "byte-for-byte" 192, audit 2, version
  tags 9). Step 2 took many history blocks with the files they were in.
- The budget of src net -1,500 (aim -2,000) does not hold on this tree.
  Taking out every H block, and keeping the K sentences of mixed blocks,
  gave src 36,053 to 35,355 (-698) and comment lines 6,167 to 5,481
  (-686). History-pattern lines went 536 to 65; what is left is file
  citations (`project/docs/rebuild/PLAN.md`, the SPEC "Rebuild risks"
  items) and pinned byte contracts, which are K. A larger cut would need
  K comments to go, which this spec rules out.
- `src/shell/drive.ts` was 378 comment lines, and its history share was
  near a tenth (-37), not near half.
- Some comments were not history but out of date, and would mislead a
  reader, so they were made true in the same pass (no code changed):
  `help.ts` called the run-export family not yet built; `cli/dispatch.ts`
  and `workflow-apps.ts` named switch arms and a `next` placeholder that
  are gone; `doctor.ts` said `--onramp` was not wired; `registry-core.ts`
  and `capability-data.ts` said 196 tools; `trust-audit.ts` named
  multi-agent callers; `app-run-cli.ts` said both tools are MCP-only.
- "No test edited except where a test asserts on a comment" missed a
  pin outside `test/`: `scripts/version-sync-check.js` asks
  `src/shell/pipeline-cli.ts` to hold the word `planSummary`, and the
  only place it was is a history comment. The comment that took its
  place keeps the word and names the pin; `dogfood-release-smoke` found
  it.
- The proof that no code line changed is stronger than reading the diff:
  `tsc --removeComments` of `src/` before and after gives the same bytes
  for all 131 output files.
- The duplicate-helper table is out of date: `invocationCwd`, `now`,
  `sha`, `safeFileName` and `truncate` no longer have three copies
  (#795 put the cwd and flag readers in `core/util/cli-args.ts`). Three
  or more copies now: `optionalString` 8 (7 the same), `messageOf` 7
  (all the same), `isRecord` 7 (4 spellings, one meaning), `countBy` 4
  (3 bodies), `stringOption` 3, `req` 3 (the same), `compactMetadata` 3
  (3 bodies). A new shared module is one more module load on every
  command that loads a copy, and `test/perf-ratchet-smoke.js` lets no
  module count go up, so the helper PR has to keep the count or put the
  helpers in a module those paths already load.
- md count: 124/124 at this PR, not 135/135.

Found in the helper PR (measured again on `9201eaef`, after #799):

- The plan names two new modules, `core/util/common.ts` and
  `shell/cli-common.ts`. Neither was made. `now` and `invocationCwd` had
  no copies left (#795), and a new pure module would be one more load on
  `doctor`, `app list` and `drive`, which load copies today. The shared
  helpers went into `core/util/cli-args.ts`, which every command and the
  MCP server already load. The perf counts did not move: version 27, help
  27, status 27, doctor 42, app list 42, MCP initialize 24, drive 92.
- `optionalString` needed no new home: `cli-args.ts` already had
  `optionalArg` with the same body. The copies were nine, not eight:
  `state-cli.ts` had it as `optionalStringArg`, and `ledger-cli.ts` as
  `stringOption`. Seven became `optionalArg`. Two of them were exported
  with no caller (`optionalString` from `report-view-cli.ts`,
  `optionalStringArg` from `state-cli.ts`); they stay as names for
  `optionalArg`, since a zero-caller export can still be a contract.
- Merged into `cli-args.ts`: `isRecord` (7 copies, 4 spellings with one
  answer for every input), `messageOf` (7), `countBy` (4; the
  `operator-ux.ts` copy runs the key function twice, which gives the same
  counts for the plain field reads its callers pass), and `req` (3), now
  `requireArg`, since `required` there has a different message.
  `compactMetadata` had two copies with the same body
  (`core/pipeline/error-feedback.ts` and `shell/error-feedback-io.ts`); the
  shell one now imports the core one.
- Kept, with reason: `optionalString` in `audit-cli.ts` (it also takes an
  array's first string); `optionalString` in
  `wiring/capability-table/registry-core.ts` and `stringOption` in
  `orchestrator.ts` (capability surface files: an edit there needs a
  shipped-docs edit by the onramp rule, and there is nothing to say);
  `stringOption` in the frozen `scheduler-io.ts` (its one twin is the
  `orchestrator.ts` copy, so no third user); `compactMetadata` in
  `sandbox-profile.ts` (its home is not loaded by `cw app list`, which
  loads `sandbox-profile.ts`, and its `Object.fromEntries` body differs
  from the loop on a `__proto__` key). `errMessage` in `drive.ts` has the
  `messageOf` body but was not in the table, and was left.
- No "kept as a local copy" header sentences were left to delete; they
  had gone with the files and comments of the steps before.
- The budget of src net -250 (aim -350) does not hold: src 35,355 to
  35,263 (-92), comment lines 5,481 to 5,488 (+7, one doc line per shared
  helper and a header note on why they sit in `cli-args.ts`). No new src
  file. The planned smoke became a unit test,
  `test/core/util/cli-args-sharedhelpers.test.js` (so the project index
  does not change): it runs each shared helper against the old bodies and
  fails if a merged helper gets a second definition in `src/`.

## Status ledger

| Item | State | PR |
|---|---|---|
| Intent + spec (this file) | open | |
| History goes, "what" and "why" stay | done | #799 |
| One copy of each small helper | done on its branch, PR to come | |
| Closing ledger and receipt | | |
