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

### Platform scope (owner, 2026-11-03)

The owner, word for word (2026-11-03): "cool-workflow要和yokoten一样做到跨平台全兼容"
("cool-workflow must be fully cross-platform, like yokoten"). The target
is yokoten's list: it works with Claude Code, Codex, Copilot,
Antigravity, Muse Code, OpenCode, Grok and DeepSeek, and it runs on
Linux, macOS, Windows (WSL) and native Windows (beta).

A read-only review of this program against that target (2026-11-03)
found the refactor neutral to it. In its favour: `src` has no
`shell: true`, path checks use `path.sep`, and the PATH lookup knows
PATHEXT. Against it:

- there is no Windows CI;
- the vendor wrappers start `claude`, `codex` and the rest by bare
  name, and on native Windows that is a `.cmd` shim, which Node will not
  start without a shell;
- `report --open` calls `start`;
- about 24 test files would fail on Windows.

Three of the eight vendors (Copilot, Antigravity, Grok) have no preset,
though `CW_AGENT_COMMAND` covers any of them today.

So, under the standing instruction ("别问我了，都按照你的推荐迭代"),
v0.4.0 keeps its scope and is not held for Windows. Three things land
before the tag:

- a not-required Windows CI leg that measures the gap (`ci.yml`,
  `cool-workflow-windows`);
- one PATH lookup in `core/util/cli-args.ts` in place of three;
- a README that names Linux, macOS and WSL as supported and native
  Windows as not yet tested.

The remaining phases keep two rules: test helpers start children with
`process.execPath` and join PATH with `path.delimiter`, and nothing
moved into `core` reads `process.platform`.

Full platform support is its own program after v0.4.0:

1. a known-failures list that can only get shorter;
2. test fixes;
3. a kernel seam that starts a `.cmd` shim's JS entry with `node`, never
   through a shell (security-sensitive, so it needs the owner's yes);
4. the three missing vendor wrappers (the owner checks each one on a
   real machine);
5. a platform row in `cw doctor`.

## Acceptance

Every PR: smoke, unit and v2 conformance pass counts the same before and
after; `growth:check` and the perf ratchet green; no fixture or man page
byte changes unless the PR says why. At close: src at most 35,500 lines,
test at most 59,500, `mkdtempSync` files at most 40, no `core` edge out.

## Architecture snapshot diff (claims this program makes stale)

- AGENTS.md's core path named `src/shell/pipeline-cli.ts`; it is
  `src/shell/commands/pipeline-cli.ts` now. Fixed in #854, together with
  `docs/cli-mcp-parity.7.md`, `docs/project-index.md`, the rebuild SPEC's
  `cli-surface.md`, `manifest/source-context-profiles.json` and one v2
  conformance case.
- AGENTS.md said the shared pure helpers live in `cli-args.ts`. Now
  `collate.ts` holds `compareBytes` and `formatCounts` too, and
  `cli-args.ts` holds `findProgram`, the one PATH walk. Fixed in this PR.
- `core/capability-table.ts` is gone (#844). `rebuild/PLAN.md` and
  `rebuild/CUTOVER.md` still name it; they are the plan of a closed
  program, kept as written, like the closed intent archive.
- The README said nothing about platforms. It now names Linux, macOS and
  WSL, and says native Windows is not yet supported (#858). The CI
  history in AGENTS.md has the `cool-workflow-windows` leg (#855).
- `test/README.md` gained "Shared Helpers" (#847). `test-layout-smoke`
  allows `test/helpers/`, which mirrors no `src/` folder.

## What this spec got wrong (recorded at close)

- The size targets were wrong. The plan said src at most 35,500 lines and
  test at most 59,500. At close, src is 35,885 and test is 61,420. Moving
  a test onto a helper took out a local copy but added an import, and
  most local copies were 3 to 6 lines, so the migrations saved few lines.
  New guard tests added lines. The file-count targets were met:
  `mkdtempSync` is in 5 test files (target 40), and `core` imports no
  other layer.
- "11 pure functions" in `drive.ts` was a grep for fs, process and
  await. It did not check imports. Six of the 11 call a `shell` module,
  so only 5 moved (ledger row 5).
- 3e ("`cw` 17 times") counted every local `cw()`. Most run
  `scripts/cw.js`, a different entry point, or use `execFileSync`, which
  throws on a non-zero exit. Only 4 could move without changing what they
  test.
- The plan said nothing about other platforms. The owner's
  cross-platform ask came mid-program ("Platform scope" above). The
  first Windows run (#855) passed 133/287 smokes, 41/88 conformance
  cases and 134/147 unit tests, far from the review's guess of about 24
  failing files. That is the next program's starting number.

## Status ledger

| Phase | State | PR |
|---|---|---|
| 0 Facts, smoke-durations (286 entries from one full run: +111, -2 dead keys) | done | #839 |
| 1a Unused exports (29 lost `export`; `compactCheckpoint` and `deferredPayloadProbeCapabilities` kept, see the smoke) | done | #840 |
| 1c Capability-table shim, layer test | done | #844 |
| 2 Byte-identical helpers (sha256Local, fingerprintStrings, errMessage, formatCounts x3; frozen files untouched) | done | #845 |
| 3 Test helpers and migrations: 3a helpers, 3b env (30 tests), 3c workspace (271 -> 5 files with `mkdtempSync`), 3d stub-agent (8 tests), 3e cw (4 tests) | done | #847, #851, #852, #853, #858 |
| 4 `shell/commands/` (16 files moved; imports, lazy requires, docs, tests and dist follow) | done | #854 |
| 5 `drive.ts` pure functions: 5 of the 11 moved (`agentConfigured`, `spawningAgentLine`, `renderSubInputs`, `roundPhaseLabel` to `drive-decide.ts`; `compareBytes` to `core/util/collate.ts`, with the `run-registry-io.ts` copy). The other 6 stay: `recordedTokenTotal` and `tokenBudgetUsage` read `shell/observability.ts`, `stillOwnedTask` throws a `shell/run-store.ts` error, `resultCachePath` reads files, `assertResultWritable` calls `shell/sandbox-profile.ts`, and `buildDriveContext` resolves the agent config | done | #857 |
| 7 Close: snapshot diff, what the spec got wrong, receipt; the file joins `2026-11-archive.md` after this PR merges | in this PR | |
