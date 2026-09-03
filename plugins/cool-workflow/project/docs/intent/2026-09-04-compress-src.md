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

(filled at close)

## Status ledger

| Item | State | PR |
|---|---|---|
| Intent + spec (this file) | open | |
| History goes, "what" and "why" stay | | |
| One copy of each small helper | | |
| Closing ledger and receipt | | |
