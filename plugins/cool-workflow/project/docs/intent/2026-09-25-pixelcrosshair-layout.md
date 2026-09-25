# File layout after pixelcrosshair: tests by folder, one docs tree, a tidy root

Intent and spec in ONE file, in the shape `AGENTS.md` "Intent files (the
playbook)" asks for. Source: the operator, 2026-09-25: "请根据项目
pixelcrosshair 的文件组织方式，进行 cool-workflow 项目的改进", and on the
same day the choice "三项都做，分多个 PR" (all three parts, one PR each).

## Intent

pixelcrosshair (the operator's newer project, on the self-hosted Gitea host)
keeps its files in a shape a reader takes in at one look: each test sits
next to the code it tests, all docs live under one `docs/` with an index,
numbered records and one to-do list, and tests hold that shape. CW has grown
three places where the shape is not like that. This program moves CW to the
same ideas where they fit CW, one PR per part, without changing any command
output, file a user sees, or release step.

## Measured facts (checked by command before design)

- pixelcrosshair tree (`git ls-files`, pasted by the operator, 2026-09-25):
  unit tests next to code (`core/codec.ts` + `core/codec.test.ts`, the same
  in `functions/`, `shared/`, `src/`, `scripts/`); `docs/` holds
  `README.md`, `decisions.md`, `todo.md`, `records/01..46-<topic>.md`,
  `design/`, `images/`; layout tests `scripts/docs-layout.test.ts`,
  `scripts/workflows.test.ts`, `scripts/toolchain.test.ts`; root files
  `.editorconfig`, `.gitleaks.toml`, `.npmrc`, `.oxlintrc.json`.
- CW `test/` before this program: 451 tracked files, all in one flat
  folder but the fixtures; 266 `*-smoke.js`, 180 `*.test.js`. The unit
  tests put the folder in the name: `statecore-*` 32, `pipelinecore-*` 27,
  `maruntime-*` 21, `macollab-*` 19, `stateexplosion-*` 19,
  `trustcore-*` 15 (`ls test/*.test.js | sed 's/-.*//' | sort | uniq -c`).
- Each unit test loads one `dist/` folder: 39 `core/multi-agent`, 32
  `core/state`, 16 `core/pipeline`, 11 `core/state/state-explosion`,
  11 `shell`, 8 `core/trust` (grep of `require("../dist/...")`).
- Smokes are named in 79 files outside `test/` (man pages, `AGENTS.md`,
  CI, scripts); unit test file names in 8 (`git grep`).
- `run-all.js` reads `test/*-smoke.js` only; `run-unit.js` read
  `test/*.test.js` only; `onramp.ts` takes any `test/.+\.test\.js`.
- CW docs today are in 8 places: root `sdlc/` (3 plan.md),
  `project/docs/intent/` (2 open + 1 archive), `project/docs/`
  (`ARCHITECTURE_PLAN.md`, `BACKLOG.md`, `benchmark.md`,
  `publishing-audits.md`), `project/docs/rebuild/` (95 files),
  `project/docs/audits/`, `project/docs/wiki/`, `project/examples/`, and
  the shipped man pages in `docs/`.
- Root: no `.editorconfig`; gitleaks runs from its workflow with no
  `.gitleaks.toml`.
- md count: 133/135 before this file; this file makes 134.

## Paths weighed (complexity / upkeep / cost / can it be undone)

- Tests: (a) move unit tests into `src/` next to the code, as in
  pixelcrosshair: `tsc` would build them into `dist/`, the `core` source
  profile would take them in, and `src/` comment budgets would count them,
  so no; (b) folders under `test/` that mirror `src/`, file name without
  the folder part, smokes kept flat since 79 files name them and the
  runner reads the top only: chosen; a `git mv` undoes it; (c) also put
  smokes in folders: 79 files to change and a runner change, for tests
  that are black-box runs of the CLI with no one module to mirror: no.
- Package at the root, as in pixelcrosshair: the plugin marketplace
  files point at `plugins/cool-workflow/`; moving it breaks installs: no.
- Lint config (`.oxlintrc.json`): a new dev dependency against the
  zero-dependency line: no.

## PR 1: tests by folder (this PR)

1. `git mv` the 180 `test/*.test.js` into `test/<src folder>/`, dropping
   the folder part of the name (`statecore-x` -> `core/state/x`); fix the
   relative paths inside (one more `../` per level).
2. `run-unit.js` walks `test/` (skips `fixtures/`).
3. New `test/test-layout-smoke.js`: no unit test at the top, no smoke in
   a sub folder, every sub folder has a `src/` twin; teeth on a throwaway
   tree. It fails on the old tree and passes on the new one.
4. Fix the 12 lines that named an old path; `test/README.md` and
   `AGENTS.md` say the rule.

Gates: `build`, `test:unit` (180), the new smoke, full `run-all`,
`index:check`, `growth:check`, `dist:check`.

## PR 2: one docs tree (spec, next)

Take pixelcrosshair's docs shape where it fits: one index page, one to-do
list, records by number. Keep the two-tree rule (`docs/` ships, and
`project/docs/` does not). Details, file moves, and the `AGENTS.md` /
`REVIEW.md` lines to change are set in that PR, after its own measured
facts, since `sdlc/` follows the operator's `~/Developer/sdlc/` pattern.

## PR 3: a tidy root (spec, next)

`.editorconfig` for the code styles CW has now, and one smoke that holds
the list of root entries, so a new root file is a choice, not a leak.

## Architecture snapshot diff (claims this program makes stale)

(filled by the closing PR)

## What this spec got wrong (recorded at close)

(filled at close)

## Status ledger

| Item | State | PR |
|---|---|---|
| Intent + spec (this file) | open | |
| PR 1: tests by folder | open | |
| PR 2: one docs tree | | |
| PR 3: a tidy root | | |
