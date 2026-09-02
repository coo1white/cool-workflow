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
| PR 5 TS7 install path in CI | open | — |
| PR 6 dead paths in src (non-surface) + scripts + test comments | open | — |
