# Refactor the whole tree: test helpers, one command folder, no dead doors

Intent and spec in ONE file (the shape of `2026-09-02-backlog-six-rows.md`).

## Intent

After slim-and-esm, `src/` is lean (35,934 lines, 134 files, zero runtime
dependencies, one layer break). The cost now sits around the code: a test
tree with no shared helpers (1.7 times the size of `src/`), a flat
`src/shell/` of 60 files with the CLI command handlers mixed in, and the
tail of the removed multi-agent family. This program pays that cost down
without changing one byte of CW's output: no CLI, JSON, exit code, `.cw/`
layout, MCP tool, or `CW_*` variable changes, so no POLA exception is
needed. It serves Track A and B: every new proof needs a smoke, and a
cheaper smoke means more proofs; every failure-recovery change goes
through `src/shell/drive.ts`.

The plan was drafted read-only by a second model (Fable) and put to the
operator with seven questions, each with its recommendation and evidence.
The operator's answer, word for word (2026-11-03): "都按 Fable 建议"
("Do all of it as Fable recommends"). The recommendations so approved:

- Q1: keep `rates.candidateAcceptance` and `collaboration` in `cw
  metrics` (text and JSON; the v2 case `report-metrics` pins them); only
  drop the `export` of the two functions behind them.
- Q2: no outside user imports `dist/shell/*-cli.js` (`package.json` has no
  `exports` or `main`; no doc, wiki page, formula, vendor manifest or
  wrapper names one), so the 16 `*-cli.ts` files may move.
- Q3: do not split `drive.ts` or raise the `drive.modules` ceiling (92).
- Q4: dropping an unused `export` in a frozen file counts as a deletion.
- Q5: add `test/helpers/` for shared test set-up, and let
  `test-layout-smoke` allow it.
- Q6: do not short-cut `cw version` now; put it in `BACKLOG.md`.
- Q7: phases in order 0, 1, 2, 3, 4, 5, 7; phase 3 may run beside 1 and 2,
  not beside 4 and 5.

Release name. The operator, word for word (2026-11-03): "然后重构的第一个版本就叫v0.4.0"
("Then the first release of the refactor is called v0.4.0"). So the
first release cut after this program's PRs land is 0.4.0, not a patch
step, by the operator's choice (the 0.x patch-step rule of 2026-10-17 is
the default; this names the exception). The program changes no output,
so 0.4.0 needs no POLA exception of its own.

## Measured facts (2026-11-03, `main` at `75d11c5b`)

Run in `plugins/cool-workflow/`.

1. `src/`: 134 `.ts` files, 35,934 lines (`cat $(find src -name '*.ts') |
   wc -l`). `shell/` is 70 files, 22,982 lines; 60 sit flat at its top.
2. Import graph: 534 edges, one going from `core` out
   (`core/capability-table.ts -> wiring/capability-table/index.ts`, a
   re-export kept "for old imports"; 41 files still import it).
3. 16 `src/shell/*-cli.ts` files, 2,499 lines, are CLI handlers; the
   wiring slices load them with `createRequire` (29 uses in 14 files).
4. `src/shell/drive.ts`: 1,484 lines, fan-out 29; 11 of its 37 functions
   (187 lines) touch no fs, process or await.
5. 41 runtime exports have no importer outside their own file; 12 are
   `*_SCHEMA_VERSION` (kept on purpose). Most of the other 29 are still
   called inside their own file, so they need only the `export` dropped.
6. Tests: 286 smokes and 145 unit tests, 61,069 lines; 271 files call
   `mkdtempSync` on their own (`grep -rl mkdtempSync test | wc -l`);
   `run` is defined 37 times, `writeStub` 34, `cw` 17; shared helper
   modules: 0.
7. `test/smoke-durations.json` lacks 111 of the 286 smokes and has 2 dead
   keys.
8. `scripts/bench/perf-ceilings.json`: `drive.modules` 92, `version.modules`
   27. `manifest/growth-budget.json`: md 123/123, src comment lines
   5,544/5,544.

## Paths weighed (complexity / upkeep / cost / can it be undone)

- **Chosen: delete first, then move a little, then share test set-up.**
  Ten or so small PRs, each byte-neutral and proven by the tests that are
  there; each is one revert.
- **Turned down: split `src/shell/` into many folders.** 225 shell-to-shell
  edges change, nine frozen files would move, every `dist/` path changes;
  the gain is a tidier tree and no North Star track.
- **Turned down: split `drive.ts` into modules.** Each new module raises
  `drive.modules` and turns the perf ratchet red; phase 5 gets half the
  gain with no new module.
- **Turned down: tests in family folders.** `run-all.mjs`,
  `sync-project-index`, `onramp.ts` and two layout gates would change,
  and the duplication would stay.

## Spec (phases)

0. Facts into this file; regenerate `test/smoke-durations.json` from a
   real `node test/run-all.mjs --json-summary` run.
1. 1a: drop unused `export`s and delete what has no caller at all
   (`*_SCHEMA_VERSION` untouched). 1c: delete `core/capability-table.ts`,
   point its 41 importers at `wiring/capability-table/index.js`, and add a
   unit test that `core` imports no other layer. (1b is dropped by Q1.)
2. Merge a helper only where the bodies are byte-identical, at most 20
   lines, and needed by 3 or more files (`core/hash.ts` for `sha256Local`).
3. `test/helpers/` (workspace, cw, stub-agent, env), then move each test
   family to them; a migration diff only removes a local helper, adds an
   import, and renames calls; no assertion changes.
4. `git mv` the 16 `*-cli.ts` files into `src/shell/commands/`; paths only.
5. Move the 11 pure `drive.ts` functions into the existing
   `core/pipeline/drive-decide.ts`, with a direct unit test for each.
7. Close: fill the snapshot diff and what this spec got wrong, write a
   receipt under `project/docs/audits/`, archive this file.

### Phase 1c as built (2026-11-03)

The shim was not only a core-to-wiring edge: purity-gate.mjs let cli, mcp
and shell import core but not wiring, so the shim was how all three
reached the table. Done under the operator's standing instruction
("别问我了，都按照你的推荐迭代"): cli and mcp may import wiring (the gate's
rule now says entry layers sit above wiring); `core/format/help.ts` takes
the CLI rows as a parameter from cli/, so core imports only core
(`test/core/layer-direction.test.mjs`); and the one real shell-to-wiring
use, `shell/workbench.ts` (frozen), is the one layer entry left in
`scripts/purity-baseline.json`. Every verb loads one module fewer
(`perf-ceilings.json` lowered, e.g. `drive.modules` 92 -> 91).

## Acceptance

Every PR: smoke, unit and v2 conformance pass counts the same before and
after; `growth:check` and the perf ratchet green; no fixture or man page
byte changes unless the PR says why. At close: src at most 35,500 lines,
test at most 59,500, `mkdtempSync` files at most 40, no `core` edge out.

## Architecture snapshot diff (claims this program makes stale)

(filled by the closing PR)

## What this spec got wrong (recorded at close)

(filled by the closing PR)

## Status ledger

| Phase | State | PR |
|---|---|---|
| 0 Facts, smoke-durations (286 entries from one full run: +111, -2 dead keys) | done | #839 |
| 1a Unused exports (29 lost `export`; `compactCheckpoint` and `deferredPayloadProbeCapabilities` kept, see the smoke) | done | #840 |
| 1c Capability-table shim, layer test | done | #844 |
| 2 Byte-identical helpers (sha256Local, fingerprintStrings, errMessage, formatCounts x3; frozen files untouched) | done | #845 |
| 3 Test helpers and migrations | 3a (#847), 3b env and 3d stub-agent (#851), 3c part 1 (#852) and part 2 (#853, 164 -> 5 files with `mkdtempSync`) done; 3e next | |
| 4 `shell/commands/` (16 files moved; imports, lazy requires, docs, tests and dist follow) | in this PR | |
| 5 `drive.ts` pure functions | | |
| 7 Close and archive | | |
