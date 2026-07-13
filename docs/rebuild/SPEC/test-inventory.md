# test-inventory

## Scope

This spec covers the test harness (`test/run-all.js`, `test/README.md`, `test/assert-diff.js`, `test/topology-smoke-helper.js`, `test/fixtures/`) and gives one line for every one of the 173 `test/*-smoke.js` files: what behavior each one pins, grouped by subsystem.

## Public surface

### How the suite is found and run

- The runner is `node test/run-all.js`. It finds every file in `test/` whose name ends with `-smoke.js`, sorted by name. Nothing is hand-listed; a new file is picked up on the next run (test/run-all.js:164-167).
- Every smoke is a standalone Node script. Its contract: print exactly one ok line to stdout on success (form `<name>-smoke: ok`), use only `node:assert/strict`, be fully hermetic — no network, no live agent binary, no shared state (test/README.md:9-14).
- Each smoke runs in its own child process, in its own private sandbox (see "Files on disk").

### Flags of `test/run-all.js`

| Flag | What it takes | What it does |
|---|---|---|
| `--concurrency <n\|auto>` (also `--concurrency=<v>`) | number or `auto` | Sets the worker pool size. Order of force: flag > `CW_TEST_CONCURRENCY` env > auto default. `auto` = `Math.min(16, Math.max(2, cores - 1))` where cores comes from `os.availableParallelism()` with fallback to `os.cpus().length` then 4. An explicit number is floored to 1: `Math.max(1, Number(raw) \|\| 1)` (test/run-all.js:60-82). |
| `--json-summary <path>` | file path | After the run, writes a JSON summary file at the path (dirs made as needed) (test/run-all.js:83,434-465,470-474). |
| `--filter <regex>` | JS regex source | Runs only smokes whose FILE NAME matches. Zero matches is an error, exit 1 (test/run-all.js:86-87,175-182). |
| `--retry <n>` | number | Retries a FAILED smoke up to n more times, each retry in a fresh sandbox. A timed-out smoke is never retried. The LAST failure's output is kept (test/run-all.js:89-91,308-319). |
| `--bail` | none | Stops starting new smokes after the first failure (test/run-all.js:96-97,352,360,368,375). |
| `--sample <n>` | number | Runs a deterministic subset of n smokes. Selection ranks file names by a stable FNV-1a hash (seed `0x811c9dc5`), takes the lowest n, then runs them in name order. Same file set → same subset, every time (test/run-all.js:99-101,143-162,189-191). |
| `--fast` | none | Skips smokes tagged slow (`// @cw-smoke: tags slow` in the first 20 lines) (test/run-all.js:103-104,203-206). |

### Env vars read by `test/run-all.js`

| Env var | Effect |
|---|---|
| `CW_TEST_CONCURRENCY` | Pool size when the flag is absent. `1` forces sequential (used by `release-gate.js`) (test/run-all.js:75). |
| `CW_TEST_FILTER` | Same as `--filter` (test/run-all.js:86). |
| `CW_TEST_RETRY` | Same as `--retry` (test/run-all.js:90). |
| `CW_TEST_TIMEOUT_MS` | Per-test timeout in ms. Default `120000`, floor `1000` (test/run-all.js:94). |
| `CW_TEST_BAIL=1` | Same as `--bail` (test/run-all.js:97). |
| `CW_TEST_FAST=1` | Same as `--fast` (test/run-all.js:104). |
| `CW_TEST_SERIAL_ONLY` | Comma list of smoke file names kept OUT of the parallel pool; they run one by one AFTER the pool ends. The hardcoded set is empty (test/run-all.js:215-218,367-376). |
| `CI` | When set, a failure report adds a `[git log]` line with the last commit that touched the failing smoke (test/run-all.js:409-420). |

### Env vars SET or STRIPPED for every smoke child

Set: `CW_HOME`, `XDG_STATE_HOME`, `HOME` all point at a private `home/` dir; `TMPDIR` at a private `tmp/` dir; `CW_NO_AUTO_AGENT=1`; `CW_REQUIRE_RESOLVABLE_EVIDENCE=0` (test/run-all.js:254).

Stripped (deleted from the child env so ambient operator config can never leak in): `CW_AGENT_COMMAND`, `CW_AGENT_ENDPOINT`, `CW_AGENT_MODEL`, `CW_AGENT_TIMEOUT_MS`, `CW_AGENT_ATTEST_PUBKEY`, `CW_AGENT_ATTEST_PRIVKEY`, `CW_REQUIRE_ATTESTED_TELEMETRY`, `CW_BACKEND` (test/run-all.js:232-241,255).

### In-file annotations read from each smoke

- `// CW_SKIP: <reason>` in the FIRST 10 lines: the smoke does not run; the reason is printed. No file has this at present (test/run-all.js:131-136).
- `// @cw-smoke: tags <a,b>` in the FIRST 20 lines: tags. Only the `slow` tag has effect (skipped under `--fast`). Tagged slow today: `concurrent-workflow-dsl`, `incremental-resume`, `multi-agent-cli-mcp-surface`, `remote-link-git`, `remote-link-archive`, `telemetry-attestation`, `telemetry-attest-wrap`, `token-budget-enforcement` (test/run-all.js:106-127; tag lines in those files' heads).
- `// @cw-smoke: timeout <seconds>` is PARSED into `meta.timeoutMs` but NEVER APPLIED — every smoke gets the one global `CW_TEST_TIMEOUT_MS` value. Same for `@cw-smoke: inline` — parsed, never read (test/run-all.js:108-127; `parseMetadata` is only called at line 203 and only `.tags` is used).

### npm scripts that call the runner (package.json)

| Script | Command |
|---|---|
| `test` | `node dist/cli.js version > /dev/null && node test/run-all.js --fast --sample 35` (package.json:65) |
| `test:full` | `... node test/run-all.js --sample 55` (package.json:66) |
| `test:gate` | `... node test/run-all.js` — the full suite, used by the release gate (package.json:67) |
| `test:fast` | `npm run build --if-present && ... node test/run-all.js --concurrency auto` (package.json:68) |
| `test:ci` | `npm run build && ... node test/run-all.js --sample 55` (package.json:69) |
| `test:coverage` | `... node scripts/coverage-gate.js --concurrency auto` (package.json:70) |
| `eval:replay` | `tsc -p tsconfig.json && node test/multi-agent-eval-replay-harness-smoke.js` (package.json:71) |
| `fixture-compat` | `node test/run-fixture-compat-smoke.js` (package.json:49) |
| `manifest:load-check` | `node test/vendor-manifest-load-smoke.js` (package.json:60) |

Every test script first runs `node dist/cli.js version > /dev/null` — a check that the build exists before any smoke starts.

### Helpers

- `test/assert-diff.js` — exports one function `diff(expected, actual, label)`. Returns `undefined` when the two JSON-stringified values are the same, or a multi-line human-readable diff string when not (test/assert-diff.js:23-48).
- `test/topology-smoke-helper.js` — shared helper for the three topology smokes: `createContext(prefix)`, `planArchitecture(ctx, question)`, `dispatchAndOutput(...)`, `runJson`, `runText`, `readTopologyMcp` (test/topology-smoke-helper.js:15-60).

## Exact outputs

### Runner stdout

Header (one line, then a blank line). Notes only appear when their feature is on, in this order (test/run-all.js:324-344):

```text
Running <N> smoke(s) — concurrency <C> (filter: <regex>) (max-retries: <n>) (<k> skipped) (--sample <n>) (<k> fast-skipped) (--bail) (sequential; set CW_TEST_CONCURRENCY to parallelize)
```

When concurrency > 1 and a serial-only set exists, the tail note is instead ` (<p> pooled + <s> serial-only)`.

Per-smoke result line (two leading spaces, two spaces between fields) (test/run-all.js:356-359,371-374):

```text
  PASS  <file>  (<ms>ms)
  FAIL  <file>  (<ms>ms) [TIMEOUT] [retry <n>/<max>]
  PASS  <file>  (<ms>ms) [serial-only]
```

Skipped block, printed before failures when any smoke had `CW_SKIP` (test/run-all.js:382-387):

```text

======================================================================
Skipped (CW_SKIP):
  SKIP  <file>  — <reason>
```

Fast-skipped block (test/run-all.js:388-393):

```text

Fast-skipped (tags slow; remove @cw-smoke: tags slow or unset CW_TEST_FAST to include):
  <file>
```

Failures block (the `=` bar is 70 chars) (test/run-all.js:395-422):

```text

======================================================================
Failures: [BAIL]

--- <file> (exit <code>) (TIMEOUT after <ms>ms) [after <n> retries] ---
[stderr]
<captured stderr>
[stdout]
<captured stdout>
[git log] <last one-line commit for the file, CI only>
```

Final summary line (test/run-all.js:424-432):

```text

======================================================================
<passed>/<total> passed, <failed> failed (bailed) (<k> skipped) — <ms>ms total
```

`(bailed)` and `(<k> skipped)` only appear when true; the ms number is the SUM of child times, not wall time.

### Runner stderr and exit codes

- All smokes pass → exit `0`; any failure → exit `1` (test/run-all.js:467).
- No `*-smoke.js` files found → exit `1` with stderr: `run-all.js: no test/*-smoke.js files found — refusing to pass vacuously.` (test/run-all.js:169-172).
- Filter matches nothing → exit `1` with stderr: `run-all.js: filter "<regex>" matched no smoke files (had <N> total).` (test/run-all.js:178-181).
- Runner crash → exit `1` with stderr: `run-all.js: runner crashed: <stack>` (test/run-all.js:476-479).

### `--json-summary` file shape

```json
{
  "schemaVersion": 1,
  "concurrency": 7,
  "wallElapsedMs": 12345,
  "sumChildElapsedMs": 45678,
  "maxRetries": 0,
  "perTestTimeoutMs": 120000,
  "filter": "export",
  "bail": true,
  "skipped": [{ "file": "x-smoke.js", "reason": "waiting on fix" }],
  "results": [{ "file": "a-smoke.js", "ok": true, "code": 0, "elapsedMs": 250, "retries": 1, "timedOut": true }],
  "slowest": [{ "file": "a-smoke.js", "ok": true, "code": 0, "elapsedMs": 250 }]
}
```

`filter`, `bail`, `skipped` are absent when off/empty; `retries` and `timedOut` per result are absent when 0/false; `slowest` is the top 10 by `elapsedMs`; the file ends with a newline; JSON is 2-space pretty (test/run-all.js:434-465,470-474).

## Files on disk

- Per-smoke sandbox: `mkdtemp(os.tmpdir()/cw-smoke-)` root with three dirs made inside — `cwd/` (the child's working dir), `home/` (`CW_HOME`/`XDG_STATE_HOME`/`HOME`), `tmp/` (`TMPDIR`). Torn down after each attempt with `rmSync(..., { recursive: true, force: true })`; a teardown error never fails the smoke (test/run-all.js:248-257,283-291).
- `--json-summary <path>`: the only file the runner itself writes outside sandboxes; parent dirs are made first (test/run-all.js:470-474).
- `test/fixtures/runs/<name>/state.json`: six frozen run-state fixtures — `golden-path`, `mcp-app-surface`, `operator-ux`, `pre-app-simple-run`, `sandbox-profiles`, `workflow-app-framework`. `run-fixture-compat-smoke.js` reads each one, runs `migrateRunState`, and loads it through the CLI, so an old on-disk state must keep loading (test/run-fixture-compat-smoke.js:12-18).
- Each smoke makes its own tmp dir with the pattern `fs.mkdtempSync(path.join(os.tmpdir(), "cw-<unique>-"))` and removes it in `finally` (test/README.md:46-49).

## Invariants and error behavior

- Fail closed on empty suite: zero discovered smokes is exit 1, never a green pass (test/run-all.js:169-172).
- Fail closed on empty filter match: exit 1 (test/run-all.js:178-181).
- One failing smoke fails the whole run (exit 1), but by default every other smoke still runs and all failures are reported together (test/run-all.js:4-9,467).
- Isolation is total by construction: private cwd + private `CW_HOME`/`HOME`/`TMPDIR` per child, so no two smokes can share `.cw/`, the home registry, or a file lock (test/run-all.js:20-26,248-257).
- Ambient agent config can never leak into a child: the 8 `CW_AGENT_*`/`CW_BACKEND` keys are deleted from the child env (test/run-all.js:222-241). This is itself pinned by `run-all-agent-env-hermetic-smoke.js`.
- Timeout kill order: at `CW_TEST_TIMEOUT_MS` send `SIGTERM`; 3 s later send `SIGKILL` if still alive. A timed-out smoke counts as FAIL and is not retried (test/run-all.js:273-281,316-317).
- Retries only re-run assertion/semantic failures; each attempt gets a fresh sandbox; the retry count is recorded (test/run-all.js:305-319).
- Order of list operations: discover → sort → `--filter` → `--sample` → `CW_SKIP` split → `--fast` split → serial-only split (test/run-all.js:164-218). Note: because sampling comes BEFORE the skip split, a `CW_SKIP` file inside the sample lowers the run count.
- Results are sorted by file name before reporting, so the failure report order is stable no matter the pool finish order (test/run-all.js:378).
- Serial-only smokes run ALONE after the pool is quiet, so wall-clock checks measure CW and not pool load (test/run-all.js:366-376).

## Edge cases

- `--sample n` with n >= file count returns all files sorted — no error (test/run-all.js:155-157).
- The sample is a pure function of the file SET (order-free): hash-rank ties break by name (test/run-all.js:158-161).
- `deterministicSample` and the hash are kept INLINE in run-all.js on purpose: meta-smokes copy `run-all.js` alone into a temp dir and run it there (test/run-all.js:138-142; test/concurrency-default-smoke.js and test/run-all-json-summary-smoke.js both do this copy).
- A child `error` event (e.g. spawn failure) is a FAIL with `code: null` and the error message joined into the output (test/run-all.js:297-301).
- `--bail` does not kill running children; it stops NEW work, and the serial phase is skipped too (test/run-all.js:352-368).
- `multi-agent-eval-replay-harness-smoke.js` is only `require("./multi-agent-eval-replay-smoke")` — the same test runs twice in a full suite pass, once per file name (test/multi-agent-eval-replay-harness-smoke.js:4).
- The default `npm test` is NOT the full suite: it is `--fast --sample 35` (35 hash-picked smokes, slow ones removed). Only `test:gate` runs all 173 (package.json:65-67).

## Test inventory — every smoke, one line

Each line: what the file pins. The file itself is the evidence (header comment, first ~20 lines).

### harness (the runner's own behavior) — 4

- `concurrency-default-smoke.js` — runner defaults: no flag/env → concurrency > 1 (auto); `CW_TEST_CONCURRENCY=1` → sequential; flag wins over env (run on a copied runner + tiny fake smoke).
- `run-all-agent-env-hermetic-smoke.js` — the runner strips ambient `CW_AGENT_*`/`CW_BACKEND` from every smoke child's env.
- `run-all-json-summary-smoke.js` — `--json-summary` writes the schema above (run on a copied runner in a tiny test dir).
- `sample-determinism-smoke.js` — `--sample` picks the same subset every run (FNV-1a rank, not a random shuffle).

### cli-surface — 18

- `cli-arg-parsing-smoke.js` — `parseArgv`: a flag's value is never another flag; a valueless `--flag` does not swallow the next `-flag`.
- `cli-command-surface-smoke.js` — operational verb families (feedback/metrics/migration/sandbox/backend/contract) are thin delegations to `src/cli/handlers/operational.ts`, not an inline switch.
- `cli-format-smoke.js` — the pure string formatters in `src/cli/format.ts` keep their exact output.
- `cli-handler-clones-smoke.js` — `cw clones` routes to `src/cli/handlers/clones.ts`; verb output shape stable.
- `cli-handler-eval-node-smoke.js` — `cw eval` and `cw node` route to `handlers/eval.ts` and `handlers/node.ts`.
- `cli-handler-maintenance-smoke.js` — `cw gc`, `cw telemetry`, `cw demo` route to `handlers/maintenance.ts`.
- `cli-handler-workbench-smoke.js` — `cw workbench` routes to `handlers/workbench.ts` with unchanged behavior.
- `cli-io-smoke.js` — `src/cli/io.ts` helpers: `required` passthrough vs fail-with-tip.
- `cli-jsonmode-parity-smoke.js` — `cli.ts` `--json` behavior matches the capability registry's declared `cli.jsonMode`.
- `cli-mcp-parity-smoke.js` — CLI and MCP surfaces are two renderings of ONE data source (the capability registry).
- `cli-progress-summary-smoke.js` — progress/summary UX lines never leak into the stdout data channel.
- `cli-recoverable-errors-smoke.js` — a typo'd command gets `Did you mean: <closest>?` plus a `Try: cw help` recovery line; every failure hands a next move.
- `cli-render-smoke.js` — the Reporter (`src/reporter.ts`) and zero-dep term primitives (truncate / findings table / color-env).
- `cw-help-per-command-smoke.js` — `cw help <verb>` and `cw <verb> --help` render subcommand lists from `CAPABILITY_REGISTRY`.
- `doctor-smoke.js` — `cw doctor`: report shape; read-only (no `.cw/`/`$CW_HOME` writes); missing agent is WARN exit 0; unwritable home handled.
- `headline-commands-smoke.js` — the EXACT documented commands a new user types (`cw -q "question"`, vendor flags, demo/doctor/help/version/fix) work as typed.
- `operator-ux-smoke.js` — operator verbs through the CLI over a real run (status/report flow with evidence locator).
- `surface-explicit-cwd-smoke.js` — MCP and Workbench calls use explicit cwd scoping, never process-global `chdir`.

### mcp-surface — 4

- `mcp-app-surface-smoke.js` — the MCP server's app-surface tools answer over stdio JSON-RPC against a fixture run.
- `mcp-surface-registry-smoke.js` — `mcp-server` is built from `mcp-surface` + the capability registry (src/dist parity checks).
- `mcp-tool-call-coverage-smoke.js` — representative MCP tool calls from every domain (~40+ switch arms answer).
- `web-desktop-workbench-smoke.js` — the Workbench is a stateless, read-only renderer over durable `.cw/` files — a third front door, not a new brain.

### agent-wrappers — 10

- `agent-config-atomic-write-smoke.js` — `setAgentConfigFile` writes temp → rename; the durable config file is never torn.
- `agent-stream-gate-smoke.js` — the parent-side gate that picks stdio `inherit` (forward live agent stderr) vs `pipe` (capture).
- `claude-p-agent-wrapper-smoke.js` — the documented `claude -p` onboarding agent template works (PATH shim).
- `codex-agent-wrapper-smoke.js` — the Codex builtin adapter works via a `codex exec` PATH shim, no live login.
- `deepseek-agent-wrapper-smoke.js` — the DeepSeek-via-opencode adapter picks the DeepSeek model and reaches the shared opencode runner (shim).
- `gemini-agent-wrapper-smoke.js` — the Gemini builtin adapter works via a `gemini` PATH shim.
- `gemini-opencode-agent-wrapper-smoke.js` — the Gemini-via-opencode adapter picks a `google/gemini` model through the `opencode` shim.
- `opencode-agent-wrapper-smoke.js` — the OpenCode builtin adapter works via a PATH shim.
- `vendor-manifest-load-smoke.js` — the GENERATED per-vendor `mcp.json` files actually boot a working MCP server.
- `vendor-preflight-smoke.js` — `scripts/vendor-preflight.js` matrix + hard-block exit code, tested with shim wrappers offline.

### drive-loop (agent delegation, concurrency, budgets) — 15

- `agent-delegation-drive-smoke.js` — the full drive loop with a stub agent standing in for `claude -p`/`codex`: plan → dispatch → agent → accept → complete.
- `batch-output-overflow-smoke.js` — a verbose agent in a concurrent batch can never strand its siblings (streamed, not buffered-then-dumped).
- `budget-scaling-loop-smoke.js` — a `loop()` phase with `until:{kind:"budget-target"}` keeps spawning rounds while under target.
- `concurrent-failure-semantics-smoke.js` — 16 concurrent agents with 1 hang + 1 crash + 1 dirty-return: no deadlock, no disk corruption, replayable who-passed record.
- `concurrent-subworkflow-cache-nesting-smoke.js` — the deferred-checkpoint cache stays correct with nested sub-workflows in concurrent rounds.
- `concurrent-workflow-dsl-smoke.js` — `parallel()` DSL veneer; `driveConcurrentRound()` fulfills many ready tasks per round in deterministic task order; `metadata.reportedUsage` thread-back. (tag: slow)
- `deferred-checkpoint-batching-smoke.js` — a concurrent round flushes the durable `state.json` O(1) times per round, not once per task.
- `drive-concurrency-flag-smoke.js` — `cw run --drive --concurrency N` is forwarded into `drive()` and changes real concurrency.
- `drive-exhaustion-blocked-smoke.js` — a drive that hits its max-iteration guard without terminal progress fails closed as blocked, never complete/sealed.
- `incremental-resume-smoke.js` — `cw run --drive --incremental`: 5 scenarios over a real multi-phase app. (tag: slow)
- `loop-bounded-expansion-smoke.js` — a `loop()` phase's tasks are a per-round template with bounded expansion.
- `parallel-onramp-smoke.js` — `parallel()` works through the REAL command surface, not only the API.
- `run-resume-drive-smoke.js` — `run resume <id> --drive/--once` continues the SAME run through the drive loop; bare `run resume` unchanged.
- `sub-workflow-nesting-smoke.js` — a task can be fulfilled by planning + driving a CHILD app run; the child's report folds back.
- `token-budget-enforcement-smoke.js` — `limits.tokenBudget` is enforced by the drive loop against RECORDED usage (CW never measures usage itself). (tag: slow)

### state-persistence — 13

- `append-run-node-no-realloc-smoke.js` — `appendRunNode` mutates `run.nodes` in place, no full-array rebuild per append.
- `artifact-integrity-smoke.js` — `hashArtifactFile` hashes artifacts; a missing file does not throw.
- `blackboard-state-explosion-management-smoke.js` — a large topology run's blackboard state is kept bounded (state-explosion management).
- `contract-migration-tooling-smoke.js` — the declared migration registry (run-state + workflow-app contracts) round-trip proves over a REAL on-disk state file.
- `det-ids-b-smoke.js` — all 8 entity-ID mint sites are deterministic (sequence or content hash), never wall-clock.
- `durable-atomic-write-smoke.js` — the kernel persist primitive is atomic (temp → rename); cross-process stores serialize on `withFileLock`.
- `h7-custom-profile-persist-smoke.js` — a file-loaded custom sandbox profile persists as a definition on `run.customSandboxProfiles` so the boundary can re-resolve it by logical id.
- `node-snapshot-diff-replay-smoke.js` — per-node snapshot / diff / replay over a real persisted StateNode.
- `registry-corrupt-fail-closed-smoke.js` — corrupt home-registry / scheduler store files fail closed, never silently reset.
- `robustness-failclosed-smoke.js` — malformed-file and concurrent-writer conditions no longer crash, lose data, or misbehave.
- `robustness-hardening-smoke.js` — `migrateRunState` + CLI + MCP over malformed inputs.
- `run-fixture-compat-smoke.js` — every `test/fixtures/runs/*/state.json` (6 frozen old states) migrates and loads through the CLI.
- `state-node-smoke.js` — `createStateNode` / `transitionStateNode` / `linkStateNodes` / `recordNodeError` / contract validation unit behavior.

### control-plane (registry, scheduling, gc) — 7

- `clones-gc-smoke.js` — `cw clones list` / `cw clones gc`: TTL gc reclaims only the stale clone; `--all` clears.
- `control-plane-scheduling-smoke.js` — deterministic lease order by priority + a hard concurrency ceiling over the run-registry queue.
- `orphan-runs-gc-smoke.js` — `cw orphans list` / `cw orphans gc` reclaim run dirs a killed process left with no `state.json`.
- `run-registry-control-plane-smoke.js` — the registry is a DERIVED, fail-closed index over per-run `.cw/runs/<id>/state.json`.
- `run-retention-reclamation-smoke.js` — write-ahead, fail-closed reclamation transaction; dry-run reports what would be freed.
- `sched-policy-validation-smoke.js` — `cw sched policy set` fails closed on a non-numeric flag instead of silently taking the default.
- `schedule-routine-daemon-smoke.js` — the scheduler: routines create/list/fire and the daemon tick over a temp `CW_HOME`.

### export-bundle (portable runs, verify) — 12

- `quickstart-bundle-smoke.js` — `cw quickstart ... --bundle`: one command seals a COMPLETE drive into a self-verified portable bundle.
- `report-bundle-smoke.js` — `cw report bundle <run>` exports a sealed bundle, self-verifies it offline, and fails closed if the artifact would not verify.
- `report-verify-bundle-smoke.js` — `cw report verify-bundle <file>` proves archive bytes + telemetry chain + trust-audit chain with the bundle's EMBEDDED public key, offline.
- `run-export-cross-machine-smoke.js` — a `.cwrun.json` archive exported under one `CW_HOME` restores under another.
- `run-export-import-smoke.js` — `exportRun` / `importRun` / `verifyImportedRun` round trip with artifacts, external artifacts, audit events.
- `run-export-restore-rerun-smoke.js` — a FAILED run: export, restore on another machine, registry refresh, rerun from a neutral cwd.
- `run-export-restore-resume-smoke.js` — a PARTIAL run: export, restore, digest-verify, then continue from the restored state.
- `run-import-path-traversal-smoke.js` — a crafted archive run id cannot write outside the runs dir (zip-slip class refused).
- `run-import-tamper-failclosed-smoke.js` — a tampered archive: non-zero exit, one `cw:` stderr line, silent stdout, NOTHING written (checks run before any write).
- `run-inspect-archive-smoke.js` — `run inspect-archive PATH` re-proves every digest/size, the manifest, the whole-file sha256, writes nothing, never throws.
- `run-restore-failclosed-smoke.js` — `cw run restore <archive>` closes the gap `cw run import` leaves open (post-write verification, fail closed).
- `verify-import-audit-chain-smoke.js` — restore verification re-proves the trust-audit hash chain, not only telemetry.

### telemetry-trust (attestation, audit, tamper evidence) — 13

- `audit-verify-smoke.js` — `cw audit verify <run>` re-proves the trust-audit hash chain; a forged chain is a non-zero exit.
- `demo-bundle-smoke.js` — `cw demo bundle`: hermetic no-API proof that a sealed bundle verifies offline and any forgery (chain OR signature layer) is caught.
- `observability-cost-accounting-smoke.js` — the observability + cost accounting contract (usage totals, per-unit cost derivation).
- `pii-redaction-smoke.js` — no git-tracked file in the repo contains the blocked personal-name terms.
- `readme-trust-claim-smoke.js` — the README "Can You Trust the Report?" section states the tamper-evidence guarantee honestly (no overstated claim).
- `security-trust-hardening-smoke.js` — commit gate + candidate scoring + worker scope + trust-audit summary hardening paths.
- `tamper-evidence-demo-smoke.js` — `cw demo tamper` + `cw telemetry verify`: every forgery is caught.
- `telemetry-attest-wrap-smoke.js` — the EXECUTOR signing wrapper flips an unsigned agent's telemetry to `attested` end-to-end. (tag: slow)
- `telemetry-attestation-smoke.js` — a stub agent signs its self-reported usage with ed25519; the attested verdict is recorded. (tag: slow)
- `telemetry-fail-closed-smoke.js` — with require-attested-telemetry ON (opt-in), an unattested hop is rejected before any accept-side mutation.
- `telemetry-ledger-smoke.js` — the RECORDED attestation is itself tamper-evident (hash-chain ledger).
- `telemetry-metrics-coverage-smoke.js` — `deriveAttestationCoverage` buckets units by cryptographic verdict in the MetricsReport.
- `telemetry-verify-signatures-smoke.js` — `cw telemetry verify --pubkey` re-runs the ed25519 check instead of trusting the stored `attested` verdict.

### ledger (cross-agent handoff) — 3

- `ledger-apply-smoke.js` — `cw ledger apply` lets a `suggestedDiff` escape ONLY after the entry verifies (safe to pipe into `git apply`).
- `ledger-resolution-smoke.js` — `cw ledger list` pairs each proposal with its review(s): a machine-actionable inbox.
- `ledger-verify-smoke.js` — `cw ledger propose|review|verify` round trip; a tampered or malformed entry is refused with a non-zero exit.

### worker-commit-gate (isolation, acceptance, sandbox, hardening) — 17

- `candidate-scoring-smoke.js` — `registerCandidate` / `scoreCandidate` / `rankCandidates` / select over a real run state.
- `evidence-content-extraction-smoke.js` — `extractEvidenceContent` / `resolveEvidenceLocator`: file:line locator, no line number, missing file.
- `freebsd-audit-fixes-smoke.js` — the v0.1.81 audit's false-green holes now FAIL CLOSED (each pinned one by one).
- `no-false-green-smoke.js` — an empty capture (no findings AND no grounded evidence) can never verify green.
- `one-way-boundary-smoke.js` — the red line is welded into the TYPE layer: the repo's own `tsc` rejects a fixture that crosses the boundary.
- `parse-guard-smoke.js` — `metadataOption` gives a clear error on invalid JSON (not raw SyntaxError); `routine fire` gives a clear error on a bad payload file.
- `parse-hardening-round2-smoke.js` — the MCP type guard rejects null/non-object lines; `readJson` replaces bare `JSON.parse`; `resultPath` rejects system paths.
- `path-containment-smoke.js` — `initApp` refuses outside `appsDir`; `run export` output stays in the working directory; `extractReportTo` is contained in cwd.
- `result-normalize-smoke.js` — robust ingest: findings/evidence extracted from varied agent output shapes; canonical results pass through unchanged.
- `sandbox-env-batch-hardening-smoke.js` — `buildChildEnv` filters by sandbox policy; the batch child uses `job.env`; `persistStderr` redacts secrets; stdin is capped.
- `sandbox-profile-smoke.js` — `validateSandboxCommand` / `validateSandboxNetwork` / `validateSandboxProfileFile` plus CLI enforcement.
- `schema-validation-smoke.js` — declared output schemas are ENFORCED at result intake.
- `self-audit-hardening-smoke.js` — evidence grounding at result + commit gate; symlink-hardened path containment (`realResolve` / `isContainedPath`).
- `verifier-gated-commit-smoke.js` — `commitState` requires a verified result before commit (the verifier gate).
- `worker-accept-path-architecture-smoke.js` — static guard: `src/worker-accept/` holds exactly the 5 expected modules.
- `worker-isolation-smoke.js` — `allocateWorkerScope` / `recordWorkerOutput` / `validateWorkerBoundary` / scope listing / summaries.
- `worker-retry-count-smoke.js` — `reclaimOrphans` and retry counting on worker scopes.

### pipeline-feedback (pipeline runner, feedback, collaboration) — 9

- `collaboration-ops-unit-smoke.js` — orchestrator wrappers `collaborationApprove` / `collaborationComment` / `collaborationHandoff` / `reviewPolicy`.
- `coordinator-blackboard-smoke.js` — coordinator + blackboard verbs over CLI and stream; durable blackboard entries.
- `error-feedback-resolution-smoke.js` — `recordFeedback` / `resolveFeedback` / `listFeedback` resolution states persist per run.
- `error-feedback-smoke.js` — `collectRunErrors` / `createCorrectionTask` feedback flow over run errors.
- `feedback-ops-unit-smoke.js` — orchestrator wrappers `collectFeedback` / `createFeedbackTask` / `resolveFeedback`.
- `pdca-blackboard-loop-smoke.js` — a PDCA loop over the blackboard through the CLI.
- `pipeline-auto-advance-smoke.js` — the pipeline runner auto-advances phases per the default pipeline contract.
- `pipeline-runner-smoke.js` — `createPipelineRunner` step/gate behavior over a real run.
- `team-collaboration-smoke.js` — approvals/comments/handoffs are APPEND-ONLY and provenance-linked with trust-audit event ids.

### backends — 5

- `backend-registry-smoke.js` — built-in backends are registered; a host can add a NEW backend that appears in list/ids/descriptor/run with no central switch edit.
- `execution-backend-agent-smoke.js` — the agent backend through the full dispatch path: `preparedAgentOutcome` completion, canonical evidence, fail-closed refusals.
- `execution-backend-ci-smoke.js` — the CI backend through the full dispatch path: completion, evidence shape, probe readiness, refusals.
- `execution-backends-smoke.js` — the backend driver layer contract (descriptor / run / probe).
- `real-execution-backends-smoke.js` — the delegating backends fail closed with no container daemon: no image / no endpoint / no command / unreachable endpoint.

### multi-agent (topologies, eval, trust policy) — 11

- `evidence-adoption-reasoning-smoke.js` — a judge-panel run's evidence-adoption reasoning chain from worker output through blackboard to judge.
- `multi-agent-cli-mcp-surface-smoke.js` — multi-agent verbs hold parity across the CLI and MCP surfaces. (tag: slow)
- `multi-agent-eval-determinism-regression-smoke.js` — the determinism moat: the eval replay path cannot false-green.
- `multi-agent-eval-replay-harness-smoke.js` — the `npm run eval:replay` entry; it only `require()`s `multi-agent-eval-replay-smoke`.
- `multi-agent-eval-replay-smoke.js` — record then replay a multi-agent eval run deterministically via CLI + MCP.
- `multi-agent-operator-ux-smoke.js` — operator UX verbs for multi-agent runs across CLI + MCP.
- `multi-agent-runtime-core-smoke.js` — multi-agent runtime core verbs (groups, roles, fanout) via the CLI.
- `multi-agent-topologies-debate-smoke.js` — the debate topology end to end (via `topology-smoke-helper.js`).
- `multi-agent-topologies-judge-panel-smoke.js` — the judge-panel topology end to end.
- `multi-agent-topologies-map-reduce-smoke.js` — the map-reduce topology end to end.
- `multi-agent-trust-policy-audit-smoke.js` — trust-policy audit verbs over a multi-agent run across CLI + MCP.

### apps-quickstart (workflow apps, golden path, remote review) — 15

- `architecture-review-fast-automation-smoke.js` — `scripts/architecture-review-fast.js` runs against a fixture repo.
- `architecture-review-fast-phase-cache-smoke.js` — the Verify and Verdict phases are result-cached; a second full pipeline run reuses the cache.
- `architecture-review-fast-smoke.js` — the `architecture-review-fast` app drives to complete via orchestrator + drive under a fixed clock.
- `canonical-workflow-apps-smoke.js` — every canonical app (starting `architecture-review`, `architecture-review-fast`, ...) plans and runs through the CLI with min-version checks.
- `dogfood-architecture-review-smoke.js` — the architecture-review dogfood `--smoke` half: a stub agent drives the real app to a committed audited report.
- `end-to-end-demo-smoke.js` — the full plan→dispatch→result→commit→report pipeline in ONE script without an LLM.
- `end-to-end-golden-path-smoke.js` — `scripts/golden-path.js --json --cleanup` runs green end to end.
- `quickstart-check-smoke.js` — `cw quickstart --check` is a zero-write preflight: no plan, no `.cw/`, no agent, no report, no commit.
- `quickstart-corpus-smoke.js` — quickstart over a local NON-GIT folder (a corpus) through the research-synthesis app.
- `quickstart-no-agent-smoke.js` — the no-agent first-run path: `demo tamper` + `demo bundle` work without an agent.
- `quickstart-readme-path-smoke.js` — the README path: check (zero write) → portable bundle → offline verify, over the golden-path app.
- `quickstart-smoke.js` — the ONE-COMMAND quickstart is a thin wrapper: plan(app) → run --drive → report.
- `remote-link-archive-smoke.js` — review a remote repo delivered as an archive (`.tar.gz`/`.zip`) via `file://` URLs, hermetic. (tag: slow)
- `remote-link-git-smoke.js` — `cw -q "…" --link <url>` over a local bare git repo via `file://`, agent stubbed. (tag: slow)
- `workflow-app-framework-smoke.js` — the `cw apps` framework verbs through the CLI.

### release-repo-hygiene (release scripts, doc sync, static guards) — 17

- `block-unapproved-tag-smoke.js` — `scripts/block-unapproved-tag.js` blocks `git tag`/tag-push unless the gate marker AND an APPROVED reviewer verdict exist for HEAD.
- `bump-version-idempotent-smoke.js` — `bump:version <current>` is a no-op exit 0 ("already at"), not a hard failure.
- `dead-export-removal-guard-smoke.js` — the 10 removed dead production exports stay removed (static source guard).
- `dogfood-release-smoke.js` — `scripts/dogfood-release.js --smoke --json` returns a passing summary.
- `npm-global-install-smoke.js` — pack + `npm install -g` into a temp prefix; the headline commands work from a fresh unrelated dir.
- `npm-trusted-publish-smoke.js` — `.github/workflows/npm-publish.yml` uses OIDC trusted publishing (`id-token: write`, `npm publish --access public`), and never `NODE_AUTH_TOKEN` / `secrets.NPM_TOKEN`.
- `onramp-check-smoke.js` — the change-contract gate: behavior changes need smoke coverage, surface changes need docs, src/script changes need an iteration-log row.
- `parity-doc-sync-smoke.js` — `docs/cli-mcp-parity.7.md` stays machine-complete against the capability registry.
- `project-index-sync-smoke.js` — `docs/project-index.md` cannot silently drift from the source tree.
- `readme-sync-smoke.js` — the npm package README is GENERATED from the repo-root README and may not drift.
- `release-check-skip-smoke.js` — `release-check.js --skip-tests` prints `release:check tests ... skipped` and `- SKIP tests`, does not run `npm run test:ci`, still runs the other gates (e.g. `npm run dist:check`).
- `release-flow-smoke.js` — `scripts/release-flow.js` (the gated cut orchestrator) over throwaway git fixtures.
- `release-gate-smoke.js` — `scripts/release-gate.js` over git fixtures whose build/test scripts are `true`.
- `release-pipeline-hygiene-smoke.js` — static guards over the CI workflows + the cut's git side-effects (the v0.1.96 bug classes).
- `release-tooling-smoke.js` — `bump-version`'s targeted replace keeps historical version refs; release tooling checks without mutating the repo.
- `source-context-batch-smoke.js` — the batched blob reader in `scripts/source-context.js` keeps the JSONL contract (text/empty/excluded/changed-from/cache-hit).
- `source-context-profile-smoke.js` — the repo-local AI context profile is opt-in, JSONL-clean, and faithful to the include/exclude policy.

## Evidence

- Runner discovery, flags, env, sandbox, retry, timeout, sampling, output: test/run-all.js:42-479 (per-claim lines given inline above).
- Smoke contract and conventions: test/README.md:1-79.
- npm scripts: package.json:49,60,65-72.
- Helper shapes: test/assert-diff.js:1-51; test/topology-smoke-helper.js:1-60.
- Fixture use: test/run-fixture-compat-smoke.js:12-18; the six dirs under test/fixtures/runs/.
- Every inventory line: the named test file itself, header comment in its first ~20 lines (for files with no header, the classification comes from its `require()` set and body).
- Slow tags: the `// @cw-smoke: tags slow` line near the top of each of the 8 named files. Timeout annotations (parsed, not applied): budget-scaling-loop, incremental-resume, loop-bounded-expansion, npm-global-install, sub-workflow-nesting smokes.

## Pinned by tests

This spec IS the test map. The harness's own behavior is pinned by four meta-smokes: `test/concurrency-default-smoke.js`, `test/run-all-agent-env-hermetic-smoke.js`, `test/run-all-json-summary-smoke.js`, `test/sample-determinism-smoke.js`. They copy `run-all.js` into a temp dir with tiny fake smokes and drive it as a black box — which is why `run-all.js` must stay a single self-contained file with no sibling `require()`.

## Rebuild risks

1. `@cw-smoke: timeout <n>` looks like a per-test timeout but is DEAD: parsed, never applied. A rebuilder who wires it up changes behavior — the slow smokes only pass under a raised global `CW_TEST_TIMEOUT_MS`, per the current code. Same for `@cw-smoke: inline` (test/run-all.js:106-127).
2. `--sample` must be the FNV-1a hash rank (seed `0x811c9dc5`, the exact mix at test/run-all.js:143-150), not any random pick — `sample-determinism-smoke.js` and the coverage gate rely on the exact subset, and `npm test` = `--fast --sample 35` means the DEFAULT test run's content depends on this hash.
3. `run-all.js` must stay copy-able as one file: meta-smokes copy it alone into a temp dir. A rebuild that splits it into modules breaks them.
4. Timed-out smokes must NOT be retried; only assertion failures are (test/run-all.js:316-317). Getting this wrong hides hangs.
5. The child env strip list (8 `CW_AGENT_*`/`CW_BACKEND` keys) and the set list (`CW_HOME`/`XDG_STATE_HOME`/`HOME`/`TMPDIR`/`CW_NO_AUTO_AGENT=1`/`CW_REQUIRE_RESOLVABLE_EVIDENCE=0`) must match `src/agent-config.ts`'s env layer, or fail-closed smokes false-FAIL when an operator has an agent configured (test/run-all.js:222-257).
6. Zero discovered smokes and a zero-match filter are HARD errors (exit 1) — a rebuild that passes green on an empty suite breaks the fail-closed rule (test/run-all.js:169-182).
7. The order filter → sample → skip-split matters: sampling before skip detection means a `CW_SKIP` file in the sample shrinks the run, and skipped files never fall into the serial pool (test/run-all.js:174-218).
8. `multi-agent-eval-replay-harness-smoke.js` is a pure re-export; the full suite runs that test body twice under two names. De-duplicating it changes the suite count and the `eval:replay` entry point (test/multi-agent-eval-replay-harness-smoke.js:4; package.json:71).
