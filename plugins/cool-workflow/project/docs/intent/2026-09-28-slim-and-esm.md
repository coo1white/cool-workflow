# A smaller tree, then one module form: cut the multi-agent family, go ESM

Intent and spec in ONE file, in the shape `AGENTS.md` "Intent files (the
playbook)" asks for. Source: the operator on 2026-09-28: "利用TS和.mjs重构
项目，目前太臃肿了"; asked for the depth, the answers were "我想全面ESM，
值得吗" and "同时删冻结面". This file answers the question (see "Is full
ESM worth it") and puts every choice that breaks a public surface in the
decision table for a yes or no, block by block.

## Intent

The tree gets much smaller, and then has one module form. First, the
frozen multi-agent family (multi-agent runtime, coordinator and
topology, candidates and eval, collaboration, evidence reasoning,
orchestrator, state explosion) goes, with its CLI verbs, MCP tools,
tests and man pages. Next, the comment and helper sweep already specified
in `2026-09-04-compress-src.md` runs on the smaller tree. Last, with the
Node floor raised to a supported line, the source compiles to ES modules
and the scripts, tests and conformance suite move to `.mjs`, one layer
per PR. The core path (`cw -q`, resume, report, doctor, demo tamper,
app list/run, export/restore, the 12 core MCP tools) keeps working at
every step.

## Measured facts (checked by command, 2026-09-28, on `b6e1478`)

Size:

- `src/` is 50,282 lines in 158 `.ts` files: shell 29,833, core
  14,583, wiring 4,340, mcp 785, cli 697. Comment lines (first
  non-space `//`, `*` or `/*`): 8,249. `growth:check`: md 133/135,
  src comments 7,344/7,571 by its own count, 23 frozen paths within
  ceiling.
- `dist/` is 158 `.js` files, 44,621 lines, 2,429,727 bytes, committed.
- `scripts/`: 63 files, 11,763 lines. `test/`: 470 files, 68,211 lines
  (278 smokes, 189 unit tests). `v2/conformance/`: 115 files, 9,946
  lines. Man pages: 59 files, 13,540 lines; `project/docs/`: 50 `.md`
  files, 17,935 lines.
- Largest source files: `shell/reclamation-io.ts` 1,728,
  `shell/run-registry-io.ts` 1,408, `shell/drive.ts` 1,392,
  `core/multi-agent/runtime.ts` 1,273, `shell/worker-isolation.ts`
  1,156, `shell/trust-audit.ts` 1,058.
- The capability table has 241 capabilities: 198 MCP tools, 241 CLI
  bindings, 43 CLI-only.
- `2026-09-04-compress-src.md` is specified but not started: no commit
  on `main` carries its work.

The frozen paths named in `AGENTS.md` (the 23 in `growth-budget.json`)
come to 16,028 lines in 33 files. By block, with the files outside the
frozen set that import each block:

| Block | Lines | Files | Imported from (non-frozen) |
|---|---|---|---|
| multi-agent | 6,927 | 11 | `shell/dispatch.ts`, `shell/worker-isolation.ts`, `shell/commit.ts`, `shell/report.ts`, `shell/operator-ux.ts`, `shell/operator-ux-text.ts`, `shell/trust-policy-io.ts`, `core/state/validation.ts`, `wiring/capability-table/multi-agent.ts` |
| state explosion | 1,852 | 6 | `shell/report.ts`, `core/format/state-explosion-text.ts`, three wiring slices |
| reclamation | 1,729 | 1 | `shell/registry-cli.ts`, wiring scheduling slice |
| candidates + eval | 1,121 | 3 | `shell/report.ts`, `shell/operator-ux.ts`, wiring multi-agent slice |
| scheduling | 1,061 | 2 | `shell/registry-cli.ts`, wiring scheduling slice |
| coordinator + topology | 1,008 | 2 | `shell/report.ts`, `shell/operator-ux.ts`, wiring multi-agent slice |
| collaboration + workbench | 890 | 4 | `shell/commit.ts` (review gate), two wiring slices |
| evidence reasoning | 749 | 1 | only frozen files (`multi-agent-cli.ts` and others) |
| telemetry demo | 411 | 1 | `shell/demo-cli.ts` (`cw demo tamper`), `shell/telemetry-cli.ts` |
| orchestrator | 230 | 1 | only frozen files |
| observability intake | 83 | 1 | `shell/observability.ts` (re-export) |

- In that table, `collaboration-io.ts` is 259 lines and the three
  Workbench files are 627. The wiring multi-agent slice is 709 lines.
- Four files on the `cw -q` path call into the multi-agent family:
  `dispatch.ts` (`attachDispatchToMultiAgent`), `worker-isolation.ts`
  (`recordMultiAgentWorkerOutput`, `getAgentMembership`), `commit.ts`
  (`reviewGateErrors`, `commitReviewProvenance`,
  `selfActorIdsForCandidate`), `report.ts` (state-explosion, candidate,
  multi-agent, blackboard and operator-digest summaries).
- Grouped by tool-name prefix (a rough split; each PR's plan step gives
  the exact rows), about 107 of the 198 MCP tools belong to frozen
  families: multi-agent and blackboard 39, scheduling, routines and
  queue 26, candidates and eval 14, collaboration and workbench 13,
  coordinator and topology 8, reclamation 3, evidence 2, state
  explosion 1, telemetry 1. None of the 12 core MCP tools is among them.
- 48 file names in `test/` and 17 man pages are named after frozen
  families.
- Release tooling reads this family: `scripts/dogfood-release.js`
  registers and scores a candidate (`registerCandidate`,
  `scoreCandidate`); `scripts/release-check.js`, `release-gate.js` and
  `release-flow.js` name multi-agent, candidate, blackboard or judge
  items. The "Required manual review" steps 5 to 10 in `AGENTS.md` ask
  for the multi-agent docs and smokes and `npm run eval:replay`.
- Other earlier decisions touch it: the Workbench stays (owner,
  2026-09-07, `sdlc/unify-js-architecture/`);
  `scripts/architecture-review-fast.js --schedule-full` uses a schedule;
  `cw demo tamper` (core path) runs `telemetry-demo.ts`.

Module form:

- `package.json` has `"type": "commonjs"`, `engines.node >=18`. tsconfig
  has `module` and `moduleResolution` `NodeNext`, `target` `ES2022`.
  CI runs Node 18, 22 (both required) and 24 (not required).
- In `src/`: 67 `require(` calls in 21 files, most of them the lazy
  loads that keep a command or MCP call to the modules it needs (for
  example `wiring/capability-table/registry-core.ts` and
  `exec-backend.ts`; `mcp/server.ts` loads `./resources` only on a
  resources request, which `perf-ratchet-smoke` holds); `__dirname` 17
  in 11 files; `require.main === module` once
  (`mcp/tool-process.ts`); 791 relative imports with no file extension
  in 133 files.
- `workflow-app-loader.ts` writes app scaffolds as `module.exports =
  (...) => ...`: the app file form is a user-facing contract.
- Outside `src/`: 412 of 470 test files, 26 of 63 scripts and all 115
  conformance files load `dist/` with `require`. Two scripts use
  `import` (`scripts/bench/bench-k6.js`, `workbench-k6-deep.js`, k6
  scripts). One `.mjs` file exists (`ui/workbench/postcss.config.mjs`).
- On the Node 22.22 in the sandbox: `require()` of an ES module works
  (`require(esm) ok`); `node file.mts` runs with type stripping and
  writes 0 bytes to stderr; an `enum` is refused; a `.mts` file under
  `node_modules/` is refused with
  `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. `scripts/` is in the
  npm `files` list, so a shipped script cannot be `.mts`.
- Node 18 reached end of life on 2025-04-30 and Node 20 on 2026-04-30
  (Node release schedule); Node 22 is supported to 2027-04-30.

## Is full ESM worth it

Short answer: not for size, yes for form, and only in the cheap way,
last.

- It makes the tree no smaller. A `require` becomes an `import` line for
  line; the 791 extension fixes and the `createRequire` lines add a
  little. Every gain in size in this program comes from the deletions
  and the sweep, not from ESM.
- It is cheap only on a Node floor of 22 (the exact minor is pinned by
  measurement in the floor PR). There, a lazy load stays synchronous
  (`createRequire(import.meta.url)` plus `require(esm)`), so no handler
  turns async and the perf ratchet's module counts hold, and CJS tests
  can go on loading an ESM `dist/` while they wait for their own turn.
  On a Node 18 floor none of that is possible (see below).
- It touches about 806 files (158 src, 63 scripts, 470 tests, 115
  conformance). Doing it after the deletions cuts that by the files
  deleted, so ESM goes last.
- What it buys: one module form across the repo, `import.meta` in place
  of `__dirname`, top-level `await` in tests and scripts, and the end of
  support for two Node lines that no longer get security fixes.

## Paths weighed (complexity / upkeep / cost / can it be undone)

- ESM: (1) stay CommonJS: no work, no risk, but the form stays mixed and
  the Node 18 leg stays on a dead runtime; (2) full ESM on the Node 18
  floor: `require(esm)` does not exist there, so every lazy load becomes
  an async `import()` (the whole CLI and MCP dispatch path turns async)
  or an eager load (the perf ratchet goes red), and all 552 files that
  `require` `dist/` must change in the same PR; very hard, can not be
  undone in parts: turned down; (3) raise the floor to Node 22 first,
  then move one layer per PR, `dist/` first with CJS callers still
  working through `require(esm)`: each PR can be reverted alone until
  the last: chosen, if the operator says yes to D5.
- TS for scripts: (a) `.mts` run by Node's type stripping: refused under
  `node_modules/`, so the shipped bin, MCP server and agent wrappers
  would break for npm users: turned down for shipped files; (b) compile
  scripts with `tsc` as well: a second build output to ship and keep in
  step with `dist/`: turned down; (c) `.mjs` with JSDoc types where they
  help, checked by the same `tsc` with `checkJs` only if a PR shows it
  finds real faults: chosen. `src/` stays TS.
- Deletion: (i) keep the frozen paths as they are: the 16,028 lines and
  about 107 tools stay; (ii) delete every frozen path: breaks
  `cw demo tamper`, the Workbench decision of 2026-09-07 and
  `--schedule-full`; (iii) delete the multi-agent family, keep the
  blocks on the core path or kept by an earlier decision, and cut the
  four core-path hooks first: chosen.

## Decisions for the operator (a yes or no each, before the code PRs)

| # | Decision | Proposed |
|---|---|---|
| D1 | Delete the multi-agent family: multi-agent (6,927), coordinator + topology (1,008), candidates + eval (1,121), `collaboration-io.ts` (259), evidence reasoning (749), orchestrator (230), state explosion (1,852), the wiring multi-agent slice (709). About 12,855 src lines; the exact tool count per block is in each PR's plan. `report.md` loses its multi-agent, blackboard, candidate and state-explosion parts; `cw commit` loses the review gate. | yes, block by block (a no on one block keeps it and its hooks) |
| D2 | Keep: Workbench files (owner decision of 2026-09-07), scheduling and routines (`--schedule-full`), reclamation (disk bound for `.cw/runs/`), telemetry demo (`cw demo tamper`), observability intake (core path). | keep; the operator can flip any one to delete |
| D3 | Release tooling: `dogfood-release.js` stops making a candidate and score; `release-check.js`, `release-gate.js`, `release-flow.js` drop multi-agent, candidate and judge items; `AGENTS.md` "Required manual review" steps 5 to 10 and `eval:replay` go. This is release code, so it needs its own yes. | yes, in step 1, its own PR |
| D4 | Raise `engines.node` from `>=18` to `>=22.x` (minor pinned by measurement); CI matrix 22 and 24; branch protection's required checks change from `check (18)` + `check (22)` to `check (22)` + `check (24)` (a GitHub settings step only the operator can do); Homebrew formula and docs say the new floor. | yes |
| D5 | Full ESM, in the order below. | yes, after D4 |
| D6 | App files keep the `module.exports` form (user contract); the loader reads them through `createRequire`; `apps/` gets a one-line `package.json` with `"type": "commonjs"`. | keep |

Answered by the operator on 2026-09-28: yes to all six, D1 to D6.

## Rules for every PR in this program

Same as the last programs: one PR per step below, a Plan with measured
numbers in the draft PR before any code, all gates before push with the
pass lines quoted (`npm run build`, `test:gate`, `test:unit`,
conformance, `citation:check`, `growth:check`, `release:check` from the
floor PR on), `dist/` rebuilt after the last `src/` edit and committed in
the same commit. A deletion PR lowers every number it touches in
`growth-budget.json` and `perf-ceilings.json`, removes the frozen rows
it empties in `AGENTS.md`, regenerates `cli-mcp-parity.7.md`, and syncs
the project index. No behavior of a kept command changes, except the
report and commit changes D1 names. A PR that finds a fact here wrong
records it in "What this spec got wrong" in the same commit.

## Steps (one PR each, in this order)

The D1 blocks are one import cycle (see "What this spec got wrong"), so
they go in one PR, and each hook is cut in that same PR. Release
tooling is cut loose first, in its own PR, since it is release code.

1. **Release tooling off the family** (D3; release code). 
   `dogfood-release.js` stops registering, scoring and selecting a
   candidate and still ends with `ready-dry-run`; `release-check.js`,
   `release-gate.js` and `release-flow.js` drop the multi-agent,
   candidate, judge and `eval:replay` items; `AGENTS.md` "Required
   manual review" steps 5 to 10 go. The D1 code is still there and still
   works; only the release path stops needing it. Proof: `release:check`
   and `dogfood:release` pass; `release-flow` and `release-oneclick`
   smokes pass.
2. **Delete the D1 family and cut its hooks** (code). One PR: the files
   in D1, the wiring multi-agent slice, their capability rows, tests and
   man pages; the hooks in `dispatch.ts`, `worker-isolation.ts`,
   `commit.ts`, `report.ts`, `operator-ux.ts`, `operator-ux-text.ts`,
   `trust-policy-io.ts` and `core/state/validation.ts`; `contract.show`
   moved out of `multi-agent-cli.ts` first; the `pdca-blackboard-loop`
   app deleted or rewritten, as the plan step shows. A state file written
   by an older version, with multi-agent, blackboard or candidate fields,
   still loads (a saved-state test). `AGENTS.md`: the frozen rows D1
   empties go, and "Product Direction & Moat" stops naming the
   blackboard as an asset to use more, saying it was removed and why.
   Proof: the core-path receipts' commands still pass; parity doc and
   project index regenerated; every number in `growth-budget.json` and
   `perf-ceilings.json` it touches goes down.
3. **Comment and helper sweep** (code): `2026-09-04-compress-src.md` as
   written, its numbers re-measured on the smaller tree first. Its file
   stays the spec for this step.
4. **Node floor** (config, docs, CI; D4). Measure and pin the lowest
   22.x minor where `require(esm)` is on by default and a test loads an
   ES module `dist/` with no warning on stderr.
5. **ESM `src/` and `dist/`** (code). `"type": "module"`; `.js` on every
   relative import (codemod, then read); one `createRequire` per file
   that lazy-loads; `import.meta.dirname` for `__dirname`;
   `tool-process.ts` main check by URL; `test/`, `scripts/` and
   `v2/conformance/` each get a one-line `{"type": "commonjs"}`
   `package.json` until their own step removes it. Proof: perf ratchet
   counts unchanged; `cw version` wall time before and after in the PR.
6. **Scripts to `.mjs`** (code). 63 files; `bin` paths and the
   Homebrew formula follow; `scripts/package.json` goes.
7. **Tests to `.mjs`** (code). 470 files less the deleted ones;
   `run-all.js` and `run-unit.js` discover `.mjs`;
   `test-layout-smoke.js` follows; `test/package.json` goes.
8. **Conformance to `.mjs`** (code). Still shares no code with the
   package; `v2/conformance/package.json` goes.
9. **Closing ledger and receipt** (docs). Receipt at
   `project/docs/audits/slim-and-esm-receipt-<date>.json` with checks:
   `src-lines-down` (before 50,282; after), `mcp-tools-down` (before
   198; after), `core-path-green` (the two 2026-09-02 receipts' commands
   re-run), `one-module-form` (no `require(` outside `createRequire`
   lines and app loading, no CJS file outside `apps/`),
   `node-floor` (engines, CI matrix, required checks),
   `frozen-tightened-only`. `verdict` pass only if all pass. Then this
   file and `2026-09-04-compress-src.md` join `2026-09-archive.md`.

Budget (whole program, to check at close): src at or under 36,000
lines (50,282 less about 12,855 from D1 and about 1,750 from step 3);
MCP tools at or under 130; test files at or under 440; man pages at or
under 48; new files only the three temporary `package.json`s
(each removed by its step), `apps/package.json`, and the receipt.

## Acceptance

- Manager (per PR): CI green on the required checks, CodeQL green, Plan
  and before/after numbers in the body, budget held, no kept command's
  output changed except as D1 names.
- Architect (program): the receipt's checks pass; a new reader finds one
  module form, one Node floor, and no frozen multi-agent code in the
  tree.

## Architecture snapshot diff (claims this program makes stale)

(filled by the closing PR)

## What this spec got wrong (recorded at close)

Found before step 1, by reading the capability table's wiring:

- D1 removes 75 capabilities and 75 MCP tools (198 to 123), not "about
  107": the prefix split counted scheduling, routines, queue and
  reclamation tools, which D2 keeps. None of the 12 core tools goes.
- `contract.show` (`cw_contract_show`, "Show a run's pipeline
  contract") is wired through `multi-agent-cli.ts` but reads the run's
  own contract. It stays; the step that deletes `multi-agent-cli.ts`
  moves it first.
- D1 also takes: `handoff` (run and task owner change, in the
  collaboration part of `multi-agent-cli.ts`) and five multi-agent audit
  views: `audit.multi-agent`, `audit.policy`, `audit.role`,
  `audit.judge`, `audit.blackboard`. `cw ledger` (the cross-agent
  ledger) is a different surface and stays.
- `commit` keeps its evidence check (`core/trust/evidence-grounding`)
  and its verifier gate; it loses the review gate and the candidate and
  selection gate options (step 2).
- The first plan had "cut the core-path hooks" as its own step before
  six block-by-block deletions. That does not work: each hook is how a
  D1 feature is joined to the run (dispatch attaches to the multi-agent
  run, worker output is recorded into it, the commit review gate is the
  collaboration feature, report and operator-ux sum up each block), so
  cutting them first leaves every D1 command half broken for five PRs.
  And the D1 blocks are one import cycle: `multi-agent-cli.ts` wires all
  of them, and `core/multi-agent/` holds candidate scoring,
  collaboration, coordinator, topology and eval replay; every other
  block imports the multi-agent block back. So D1 goes in one PR with
  its hooks, after the release tooling is cut loose. Fourteen steps
  became nine.

(the rest filled at close)

## Status ledger

| Item | State | PR |
|---|---|---|
| Intent + spec (this file) | open | |
| D1-D6 answered | yes, all six (operator, 2026-09-28) | #751 |
| 1 Release tooling off the family (D3) | | |
| 2 Delete the D1 family and cut its hooks | | |
| 3 Comment and helper sweep (compress-src) | | |
| 4 Node floor (D4) | | |
| 5 ESM src + dist | | |
| 6 Scripts to .mjs | | |
| 7 Tests to .mjs | | |
| 8 Conformance to .mjs | | |
| 9 Closing ledger and receipt | | |
