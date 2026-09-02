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
