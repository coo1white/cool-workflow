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
  (b) `src/**/*.ts` and `scripts/**/*.js`: every path token
  `(src|scripts|test|apps|docs)/...\.(ts|js|md)`, with or without a
  `:line` suffix, must exist in the tree;
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

## Acceptance

- Manager (per PR): CI green on all three platforms, CodeQL green,
  before/after numbers in the body, budget held, Chain line present.
  Arm auto-merge only after CodeQL is green (ruling from #584).
- Architect (program): re-run the rot scan on main. Expect: 0 dead
  onramp patterns, 0 bare-name misses in live docs, 0 `path:line`
  cites in src/scripts/test comments, 0 exported functions with no
  caller, `citation:check` green, `test:gate` green, program net lines
  negative.

## Status ledger

| Item | State | PR |
|---|---|---|
| Intent + spec (this file) | open | — |
| PR 1 hermetic gate + onramp table | open | — |
| PR 2 dead doors | open | — |
| PR 3 old addresses out of comments | open | — |
| PR 4 citation gate | open | — |
