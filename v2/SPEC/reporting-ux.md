# reporting-ux

## Scope

This part covers how CW talks to a person and to a script: the run report (`report.md`), the calm TTY view and the Rule of Silence, `cw doctor` / `cw fix`, run export / import / restore, the offline report bundle, the metrics view, and the read-only Workbench. Files: `src/reporter.ts`, `src/term.ts`, `src/doctor.ts`, `src/observability.ts`, `src/observability/format.ts`, `src/observability/intake.ts`, `src/operator-ux.ts`, `src/operator-ux/format.ts`, `src/run-export.ts`, `src/compare.ts`, `src/workbench.ts`, `src/workbench-host.ts`, `src/version.ts`, plus the report writer `src/orchestrator/report.ts` and the CLI wiring in `src/cli/*`.

## Public surface

### CLI commands

All machine payloads go to **stdout** through `printJson` — `JSON.stringify(value, null, 2)` + `"\n"`, never colored (src/cli/io.ts:17-19). All human chrome goes to **stderr** or is TTY-gated. `--json` or `--format json` asks for the machine payload (src/cli/io.ts:22-24).

- `cw doctor [--json] [--fix] [--onramp] [--changed-from <ref>] [--cwd PATH]` — read-only host checks. Human text by default; `--json` prints the `DoctorReport`; `--fix` prints only the fix lines. Exit 1 when any check is `fail` (src/cli/command-surface.ts:170-176, src/doctor.ts:82-164). It is `cli-only` — no MCP tool (src/capability-registry.ts:192-199).
- `cw fix [--cwd PATH]` — same checks; prints only the fix commands (`formatDoctorFixes`); exit 1 when any check is `fail` (src/cli/command-surface.ts:126-131). NOTE: the man page `docs/fix.7.md:31-33` says `--json` works here, but the code has no `--json` branch for `fix` — it always prints the fix text. Code wins.
- `cw report <run-id>` — writes `report.md` fresh and prints only its path + `"\n"` to stdout (src/cli/handlers/operator.ts:42-51, src/orchestrator.ts:371-374). `--json` prints `{ "path": "<abs path>" }`. `--show` / `--summary` prints the operator console report then the state-explosion report (operator.ts:46-48).
- `cw report bundle <run-id> [--output P] [--with-trust-key K] [--pubkey K] [--extract-report P] [--strict-signatures] [--require-signatures]` — export a sealed bundle, then self-verify it offline. Prints `ReportBundleResult` JSON; exit 1 when `ok` is false (src/cli/handlers/operator.ts:33-41, src/capability-core.ts:396-415).
- `cw report verify-bundle <path> [--pubkey K] [--extract-report P] [--strict-signatures] [--require-signatures]` — offline, self-contained bundle check. Prints `ReportBundleVerification` JSON; exit 1 when `ok` is false (src/cli/handlers/operator.ts:24-32, src/capability-core.ts:421-432). Archive path may also come as `--archive`, `--path`, `--file`, or `--bundle`.
- `cw status [<run-id>] [--json] [--summary|--brief]` — with no run id: prints `No run selected` + the `adviseNoRun` next action (src/cli/command-surface.ts:257-261, src/operator-ux.ts:222-230). With an id: `--json` prints `summarizeRun`; default prints the full operator status panels; `--summary`/`--brief` prints the short form (src/cli/command-surface.ts:262-267).
- `cw operator status <run-id> [--json] [--summary|--brief]` and `cw operator report <run-id> [--json]` (src/cli/handlers/operator.ts:55-72). `operator report` also re-writes `report.md` as a side effect (src/orchestrator.ts:376-380).
- `cw graph <run-id> [--json]` — the operator run graph (src/cli/handlers/operator.ts:75-79, src/operator-ux.ts:351-426).
- `cw metrics show <run-id> [--json] [--pricing <path>|default|bundled] [--now ISO]` — derived per-run metrics; also writes the snapshot file (src/cli/handlers/operational.ts:140-145, src/orchestrator.ts:481-487).
- `cw metrics summary [--scope repo|home] [--pricing …] [--now ISO] [--json]` — cross-repo rollup over the run registry; default scope is `repo` (src/cli/handlers/operational.ts:146-151, src/capability-core.ts:1116-1145).
- `cw run export <run-id> [--output|--path|--archive P] [--with-trust-key K] [--cwd P]` — portable archive; default output name is `<runId>.cwrun.json` in the caller's cwd (src/capability-core.ts:285-298). The trust key falls back to `$CW_AGENT_ATTEST_PUBKEY` (src/capability-core.ts:291).
- `cw run import <archive> [--target|--repo|--cwd P]` — restore into `<target>/.cw/runs/<id>/`, then refresh the repo registry; prints `ImportResult` + `registry` (src/capability-core.ts:300-309). Exit stays 0 even when the inner verification is false.
- `cw run verify-import <run-id> [--strict]` — re-check a restored run; exit 1 only under `--strict` when `ok` is false (src/cli/handlers/run.ts:122-130).
- `cw run inspect-archive <path>` — read-only integrity check; writes nothing; exit 1 when `ok` is false (src/cli/handlers/run.ts:131-138, src/run-export.ts:321-378).
- `cw run restore <path> [--target P]` — fail-closed one step: inspect first (no write on a bad archive), then import, then reuse the import's verification; exit 1 when `ok` is false (src/cli/handlers/run.ts:139-147, src/capability-core.ts:349-387).
- `cw workbench view <run-id> [--json]` — the five-panel read-only view (src/cli/handlers/workbench.ts:18-24).
- `cw workbench serve [--port N] [--once] [--scope repo|home]` — `--once` or `--json` prints the serve descriptor and starts nothing; the default starts the localhost-only host (src/cli/handlers/workbench.ts:25-40). Default port is `7717` (src/workbench.ts:41).
- `cw version` / `cw --version` / `-v` — prints `0.1.98` + `"\n"` (src/cli/command-surface.ts:48-51,110-112; src/version.ts:1).

A registry keyword (`drive`, `search`, `list`, `show`, `resume`, `archive`, `rerun`, `export`, `import`, `verify-import`, `inspect-archive`, `restore`) with a `--drive` flag is NOT taken as `run <app> --drive` (src/cli/handlers/run.ts:32-35).

### Environment variables

- `NO_COLOR`, `CW_NO_COLOR` — any non-empty value turns all ANSI color off; the `--no-color` flag sets `CW_NO_COLOR=1` (src/term.ts:19-23, src/cli/command-surface.ts:74).
- `FORCE_COLOR` — non-empty and not `"0"` forces color on for human text even when piped; machine payloads use no styling at all (src/term.ts:21, src/reporter.ts:9-11).
- `CW_DRIVE_PROGRESS` — `"0"` forces drive progress off, `"1"` forces it on; unset means "on only when stderr is a TTY" (src/drive.ts:136-142).
- `CW_VERBOSE=1` — set by `--verbose`; presentation only, passed to the agent wrapper (src/cli/command-surface.ts:73).
- `CW_OUTPUT=full` — set by `--full`; also prints the report inline at run end (src/cli/command-surface.ts:75, src/cli/run-summary.ts:35-38).
- `CW_HOME` — home registry root for the doctor check; default `$HOME/.local/state/cool-workflow` (src/doctor.ts:134-136).
- `CW_AGENT_ATTEST_PUBKEY` — default trust key for `run export` / bundle verify (src/capability-core.ts:291, src/run-export.ts:488-491).
- `CW_REQUIRE_ARCHIVE_INTEGRITY` — `1|true|yes|on` (case-free) makes import refuse, and inspect fail, an archive with no `integrity` block (src/run-export.ts:361-363,831-833).
- `CW_WORKBENCH_TOKEN` — when set, every Workbench HTTP request must carry it as `Authorization: Bearer` or `?token=`; checked with a timing-safe compare; 401 on a bad token (src/workbench-host.ts:110-122).

### Exported functions (module surface)

- `src/reporter.ts`: `createReporter(stream)`, the `reporter` singleton over `process.stderr`, `Reporter` (`progress(line)`, `runSummary(fields)`), `RunSummaryFields` (reporter.ts:19-84).
- `src/term.ts`: `bold/dim/green/yellow/red/cyan(text, stream?)`, `doctorGlyph(status)`, `indent(text, spaces=2)`, `nextHint(cmd)`, `tryHint(cmd)`, `sectionHeader(title)`, `phaseProgressLine(name, done, total, mode?)`, `printSuccessSummary(fields, stream?)`, `stripAnsi`, `visibleWidth`, `truncate(text, maxWidth)`, `formatFindingsSummary(rows)`, types `TermSeverity`, `FindingRow`.
- `src/doctor.ts`: `runDoctor(args, env, cwd) -> DoctorReport`, `formatDoctorReport`, `formatDoctorFixes`.
- `src/observability.ts`: `METRICS_SCHEMA_VERSION = 1`, `fingerprintMetricsSource`, `deriveUsageTotals`, `deriveAttestationCoverage`, `deriveCost`, `deriveFailureRate`, `deriveVerifierPassRate`, `deriveCandidateAcceptanceRate`, `deriveMetricsReport`, `deriveCollaborationMetrics`, `metricsDir`, `loadPersistedMetricsFingerprint`, `showMetricsReport`, `deriveMetricsSummary`; re-exports `loadCostPolicy`, `parseUsageFromArgs` (from `observability/intake.ts`) and `formatMetricsReport`, `formatMetricsSummary` (from `observability/format.ts`) so the old import path keeps working (observability.ts:813,821).
- `src/operator-ux.ts`: `summarizeOperatorRun`, `adviseNoRun`, `summarizeOperatorWorkers`, `summarizeOperatorCandidates`, `summarizeOperatorFeedback`, `summarizeOperatorCommits`, `buildOperatorGraph`; re-exports the eleven `format*` functions from `operator-ux/format.ts` (operator-ux.ts:776-788).
- `src/run-export.ts`: `exportRun(run, outputPath, { trustPublicKey? })`, `importRun(exportPath, targetDir)`, `verifyImportedRun(run)`, `inspectArchive(archivePath)`, `importManifestPath(run)`, `verifyReportBundle(archivePath, options)`.
- `src/compare.ts`: `compareBytes(a, b)` — a locale-free order for strings; use it for any order that feeds a hash, an export, or a saved projection (compare.ts:13-15).
- `src/workbench.ts`: `WORKBENCH_DEFAULT_PORT = 7717`, `WORKBENCH_UI_RELATIVE = "ui/workbench"`, `buildWorkbenchRunView`, `buildWorkbenchIndex`, `workbenchUiRoot`, `buildWorkbenchServeDescriptor`.
- `src/workbench-host.ts`: `class WorkbenchHost` (`descriptor(once)`, `listen()`, `close()`, `run()`).
- `src/version.ts`: `CURRENT_COOL_WORKFLOW_VERSION = "0.1.98"`, `WORKFLOW_APP_SCHEMA_VERSION = 1`, `CURRENT_RUN_STATE_SCHEMA_VERSION = 1`, `LEGACY_RUN_STATE_SCHEMA_VERSION = 0`, `MIN_SUPPORTED_RUN_STATE_SCHEMA_VERSION = 0` (version.ts:1-5).
- `src/orchestrator/report.ts`: `writeReport(run) -> path` and `summarizeRun(run) -> RunSummary` (report.ts:24-149).

### MCP tools (same core entries as the CLI)

`cw_report`, `cw_operator_status`, `cw_operator_report`, `cw_operator_graph`, `cw_run_export`, `cw_run_import`, `cw_run_verify_import`, `cw_run_inspect_archive`, `cw_run_restore`, `cw_report_verify_bundle`, `cw_report_bundle`, `cw_workbench_view`, `cw_workbench_serve`, `cw_metrics_show`, `cw_metrics_summary` (src/capability-registry.ts:273,299,307,281,494-500,548-553,561-562). `doctor` and `fix` are `cli-only` (src/capability-registry.ts:152-159,192-199). `cw_workbench_serve` returns only the descriptor — it never starts the server; that is the one declared divergence (src/capability-registry.ts:549-553).

## Exact outputs

### `report.md` (written by `writeReport`)

Sections in this order, joined with `"\n"` and written with `fs.writeFileSync(run.paths.report, report, "utf8")` (src/orchestrator/report.ts:34-117):

```markdown
# <workflow title>

- Run: <id>
- Workflow: <workflow id>
- Workflow App: <app id>@<version>            (only when run.workflow.app)
- Workflow App Source: <manifest/entry path>  (only when run.workflow.app)
- Created: <ISO>
- Updated: <ISO>
- Repository: <repo or cwd>
- Source: <url>@<commit>                      (only when run.inputs.sourceUrl)
- Question: <question>
- Invariants: <list joined with "; ">
- Loop Stage: <stage>

## Phase Status

| Phase | Status | Completed | Total |
| --- | --- | ---: | ---: |
| <name> | <status> | <n> | <n> |

## State Commits
## Error Feedback
## Workers
## State Size & Compaction
## Multi-Agent Runtime
## Blackboard / Coordinator
## Sandbox Profiles
## Trust Audit
## Acceptance Rationale
## Candidates
## Pending Tasks
## Results
```

- The first meta line label is `- Source:` in place of `- Repository:` ONLY when the app metadata `domain` is `"research"` AND `run.inputs.sourceUrl` is not set (report.ts:32-33,47).
- Each empty section has a fixed line: `No state commits yet.`, `No feedback records.`, `No worker scopes yet.`, `No multi-agent runtime records yet.`, `No blackboard records yet.`, `No sandbox profiles selected yet.`, `No accepted candidate or verifier-gated commit rationale yet.`, `No candidates yet.`, `No pending tasks.`, `No completed results yet.` (report.ts:154,158,174,182,196,219,246,279,290,373).
- `## Results`: for each completed task, exactly `### <taskId>`, empty line, `Result: <resultPath>`, empty line, then the result file body trimmed, then an empty line. When the file is not on this host: `_Result file is not present on this host; state metadata remains inspectable._` (report.ts:157-170). The bundle cross-check depends on this exact shape (run-export.ts:424-436).
- Commit lines: `- <id>: <reason> [<loopStage>; verifier-gated commit|checkpoint; verifier=…, candidate=…, selection=…, evidence=N] (<snapshotPath>)` (report.ts:172-179,376-385).
- Trust audit lines carry loud tamper text: `  !! TRUST-AUDIT CHAIN TAMPER DETECTED: <codes>` when the chain fails (report.ts:310-312); `  - ⚠️  UNATTESTED usage — worker=<id> task=<id>: <reason>` for each unattested delegation, and `  - ⚠️  ATTESTATION LEDGER CHAIN BROKEN — a recorded verdict/usage was edited after the fact (<names>)` on a broken ledger (report.ts:342,348-352).
- The file:line citations in a report come from the worker result bodies, which are put in verbatim under `## Results`; CW does not re-write them.

### The Rule of Silence (TTY view vs pipes)

- `Reporter.runSummary` writes NOTHING when the stream is not a TTY (`if (!isTTY(this.s)) return;`, src/reporter.ts:53). `printSuccessSummary` does the same (src/term.ts:128). Piped or `--json` stdout carries only the data.
- On a TTY, stderr gets (src/reporter.ts:57-71):

```text

<findings table>            (only when there are findings, then one empty line)
✓ Report: <reportPath>
  ✓ Status: complete — <completed>/<planned>
  Transcript: <runDir>      (dim; only when runDir is known)
  Next: cw report <runId> --show
```

For a non-complete run:

```text
  ! Status: <status> — <n>/<n>
  Try: cw doctor            (only when agentConfigured === false)
  Next: cw status <runId>   (otherwise)
```

Under `--full`, then: `\n──── full report ────\n<report text trimmed>\n` (src/reporter.ts:69-71).
- The findings table (src/term.ts:185-210): head line `Findings: <n> — <k>×<sev>, …` with severity order `P0, P1, P2, P3, none`; a dim column head `  SEVERITY  CLASS  ID` where the severity column is padded to at least 8 and the class column to at least 5; one row per finding `  <severity>  <class>  <id>` with the id cut at 60 columns with `…`. Returns `""` when there are no findings.
- Findings come from re-parsing each completed worker's `result.md` `cw:result` block; a bad file or a run that does not load is skipped, never fatal (src/capability-core.ts:646-665).
- Drive progress lines go through `reporter.progress` with the prefix `[drive] `; on only when stderr is a TTY or `CW_DRIVE_PROGRESS=1`; off when `CW_DRIVE_PROGRESS=0` (src/drive.ts:136-142). Line shapes: `[drive] → <label> (<phase>) — dispatched, spawning agent, may take minutes…` (drive.ts:307), `[drive] ↺ <label> (<phase>) — accepting cached result` (drive.ts:284), `[drive] ⇉ concurrent round: <n> agent(s) spawning in parallel, may take minutes…` (drive.ts:598), `[drive] ⧉ <label> (<phase>) — sub-workflow <appId>…` (drive.ts:703), numbered step lines `[drive] <n>. <action> <status> <taskId> model=<m> — <reason>` (drive.ts:855-864).
- Phase boundary lines: `phaseProgressLine` gives `==> <Name> ✓ (6/6)` when done, `==> <Name> ⇉ (3/6)` for a parallel phase in flight, `==> <Name> … (3/6)` for a serial one (src/term.ts:104-109, drive.ts:822-848). `==>` is bold; `✓` green.
- Color rule: `NO_COLOR`/`CW_NO_COLOR` win over all; then `FORCE_COLOR` (non-`"0"`) forces on; else color only when the stream is a TTY (src/term.ts:19-23). ANSI codes used: reset `\x1b[0m`, bold `\x1b[1m`, dim `\x1b[2m`, green `\x1b[32m`, yellow `\x1b[33m`, red `\x1b[31m`, cyan `\x1b[36m` (src/term.ts:27-35).
- Top-level errors: `cw: <message>` on stderr (bold `cw:`, red message), then maybe `  Try: <hint>`; exit 1 (src/cli.ts:5-16). Hints: `unknown command` → `cw help`; `not configured` / `agent backend` → `cw doctor`; missing repo → `cw -q "<question>" -dir <project-folder>`; app not found → `cw app list`; run id problems → `cw run list` (src/cli.ts:21-29).

### `cw doctor`

Human text (src/doctor.ts:167-209):

```text
cw doctor
  ✓ node: Node v20.11.0 (>= 18).
  ! agent: No agent backend configured — `demo` and `--preview` work, but a real run reports status: blocked.
      fix: Pass --agent-command "claude -p", set $CW_AGENT_COMMAND, or use --agent-command builtin:claude.
  ✓ git: git version 2.44.0.
  ✓ home-registry: Home registry location is writable (<home>).
  ✓ repo-state: Run state location is writable (<cwd>/.cw).

✓ ready, with 1 warning
```

Glyphs: `✓` green for `ok`, `!` yellow for `warn`, `✗` red for `fail` (src/term.ts:71-79). Summary strings: `ready — all checks passed`; `ready, with <n> warning(s)`; `<n> blocking problem(s) found` (src/doctor.ts:150-154). Check order is fixed: `node`, `agent`, (`agent-binary` only for a command agent), `git`, `home-registry`, `repo-state` (src/doctor.ts:89-145). Exact detail strings are in src/doctor.ts:92-93,102,108-109,116,122-123,130-131,138-139,144-145.

`--json` payload:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "checks": [ { "name": "node", "status": "ok", "detail": "…", "fix": "…" } ],
  "summary": "ready — all checks passed",
  "onramp": { }
}
```

`fix` is present only on non-ok checks; `onramp` only under `--onramp` (src/doctor.ts:31-37,155-163). `--onramp` human text adds the fixed block starting `Quick start (3 steps):` with the three numbered lines and the `cw quickstart research-synthesis …` line (src/doctor.ts:178-183), then `Onramp`, `Recommended Checks`, `Contract Issues`, and section actions (src/doctor.ts:184-207).

`cw fix` / `cw doctor --fix` text (src/doctor.ts:212-216):

```text
Fix Commands
  1. <fix string>
  2. <fix string>
```

or exactly `No fixes needed.` when all checks are ok.

### `cw metrics show` / `summary`

Human text (src/observability/format.ts:27-48,50-71):

```text
metrics <runId>  [valid|stale|absent]  app=<app|->
  time: run=1.2s  active-task=340ms  in-flight-items=0
  failure-rate:    n/a (0 samples)
  verifier-pass:   50.0% (1/2)
  cand-acceptance: 100.0% (2/2)
  collaboration:   approvals=0 rejections=0 comments=0 handoffs=0 reviewers=0  approval-rate=n/a (0 samples)  time-to-approval=n/a (0 samples)
  usage: attested=1/2 units (coverage 50%), unreported=1; tokens in=12000 out=3400 total=15400
  cost:  state=unpriced
  models: claude-opus-4-8
  next: node scripts/cw.js metrics show <runId> --json
```

Rates render as `n/a (0 samples)` or `<pp.p>% (<count>/<total>)`; times as `—`, `<n>ms` under one second, else `<s.s>s`. Cost renders as `state=<s>` plus `attested=<cur> <n>`, `estimated=<cur> <n>`, `unpriced-models=<a,b>` only when present (format.ts:8-25). The summary head line is `metrics summary  scope=<s>  runs=<n>` plus ` (+<n> unreadable)` when some runs did not load; then per-app lines `  app <id>: runs=… verifier=… cost=…` and per-backend lines `  backend <id>: runs=… failure=…` (format.ts:52-68).

`--json` (`MetricsReport`, src/observability.ts:491-528): keys `schemaVersion` (1), `surface` (`"metrics"`), `runId`, `generatedAt` (the injected now — the ONLY now-made field), `sourceFingerprint` (`sha256:<32 hex>`, src/observability.ts:75-79), `freshness { status: "valid"|"stale"|"absent", persistedFingerprint, currentFingerprint }`, `scope { app, backendIds[] }`, `time { run, activeTaskMs, inFlight, tasks[], workers[] }` (each duration is `{ startedAt, endedAt, wallClockMs, inFlight }`), `rates { failure, verifierPass, candidateAcceptance }` (each `{ metric, state: "ok"|"n/a", count, total, rate, buckets }`), `usage` (`{ units, attestedUnits, unreportedUnits, coverage, inputTokens, outputTokens, totalTokens, models[] }`), `cost` (`{ state: "attested"|"estimated"|"unpriced"|"unreported", currency, attestedUsd, estimatedUsd, policyId?, unpricedModels[], pricedCoverage, notes[] }`), `attestedUsage[]`, `attestation { units, attested, unattested, absent, unverified, verifiedCoverage, ledger { present, verified, records } }`, `collaboration`, `nextAction`. `cw metrics show` returns freshness pinned to `"valid"` and writes the snapshot (src/observability.ts:599-612). The summary payload adds `scope`, `runCount`, `unreadableRuns`, pooled `rates`/`usage`/`cost`, `totalOutputBytes`, `byBackendCost[]`, `byApp[]`, `byBackend[]`, `runs[]`, `nextAction` (src/observability.ts:785-805).

### Run export / import / restore

`cw run export` prints (src/run-export.ts:109-155):

```json
{
  "runId": "…", "exportedAt": "…", "path": "…", "taskCount": 0, "commitCount": 0,
  "fileCount": 0, "artifactCount": 0, "auditFileCount": 0, "telemetryIncluded": false,
  "trustKeyEmbedded": false, "manifestSha256": "…", "archiveSha256": "…"
}
```

The archive file itself is one JSON document: `{ schemaVersion: 1, exportedAt, sourceVersion, run, files[], integrity { fileCount, manifestSha256 }, trust? { publicKeyPem, algorithm: "ed25519" }, artifacts[], audit[] }`. Each `files[]` entry is `{ relativePath, role: "artifact"|"audit"|"telemetry"|"run-file", contentBase64, sha256, sizeBytes, sourcePath? }` (src/run-export.ts:23-32,117-138). `state.json`, `import-manifest.json`, and `*.lock` files are never packed; symlinks are skipped (src/run-export.ts:642,704-715). Files sort by `compareBytes` on `relativePath` (src/run-export.ts:653). The manifest digest hashes `{relativePath, role, sha256, sizeBytes}` rows sorted in code-point order; `sourcePath` is left out on purpose (src/run-export.ts:841-858).

`cw run import` prints `ImportResult` + `registry`: `{ run, runDir, statePath, manifestPath, verifyCommand: "cw run verify-import <id> --cwd <target> --json", verification, registry }` (src/run-export.ts:218-226, src/capability-core.ts:300-309).

`cw run verify-import` prints `{ runId, ok, manifestPath, checkedFiles, checks[] }`; each check is `{ name, pass, code?, path?, expected?, actual? }`. Check names and codes: `import-manifest` (`missing-import-manifest`, `invalid-import-manifest`, `run-id-mismatch`, `manifest-digest-mismatch`), `archive-file` (`path-escape`, `missing-file`, `digest-mismatch`), `archive-files` (`archive-files-invalid`), `telemetry-ledger` (`telemetry-ledger-invalid`), `trust-audit` (`trust-audit-invalid`) (src/run-export.ts:229-316).

`cw run inspect-archive` prints `{ schemaVersion, archivePath, ok, schemaSupported, runId, fileCount, manifestSha256, archiveSha256, checks[] }`. Extra codes: `archive-unreadable`, `archive-invalid-json`, `unsupported-schema`, `archive-malformed`, `archive-bad-base64`, `size-mismatch`, `file-count-mismatch`, `archive-integrity-required` (src/run-export.ts:321-378,776-810).

`cw run restore` prints `{ schemaVersion: 1, ok, target, inspect, imported|null, verify|null, registry|null }`; on a bad inspect nothing is imported and the three tail fields are `null` (src/capability-core.ts:329-387).

Import throw messages (byte-pinned, src/run-export.ts:814-823): `Archive digest mismatch for <p>: expected <e>, got <a>`, `Archive size mismatch for <p>: expected <e>, got <a>`, `Archive file count mismatch: expected <e>, got <a>`, `Archive manifest digest mismatch: expected <e>, got <a>`, `Archive base64 invalid for <p>: <detail>`, `Archive verification failed: <name>`. Also: `Unsupported export schema version: <n>` (run-export.ts:161), `Invalid run export: missing run object` (166), `Run id escapes the runs directory: <json id>` (176), `Archive file escapes restore directory: <p>` (186), `Invalid archive relative path: <p>` (905), `Archive integrity block required but absent (CW_REQUIRE_ARCHIVE_INTEGRITY=1)` (832).

### Report bundle verify

`ReportBundleVerification` keys (src/run-export.ts:444-459,610-635): `schemaVersion` (1), `archivePath`, `runId`, `ok`, `archiveOk`, `telemetryVerified`, `trustAuditVerified`, `trustKeySource` (`"bundle"|"argument"|"environment"|"none"`), `signatureKeyProvided`, `signaturesChecked`, `signaturesReverified`, `signaturesFailed`, `trustLevel` (`"signed"|"unsigned"`), `reportFindingsVerified`, `reportExtractedTo?`, `failedChecks[]` (`{ name, code? }`). Extra failure codes: `restore` (with the throw message as code), `signatures`/`signature-key-required`, `signatures`/`signatures-required`, `extract-report`/`path-outside-working-directory`, `extract-report`/`report-md-unavailable`, `report-findings`/`result-missing:<taskId>`, `result-digest-mismatch:<taskId>`, `report-result-mismatch:<taskId>` (src/run-export.ts:542-608).

`ReportBundleResult` (`cw report bundle`): `{ schemaVersion: 1, runId, archivePath, trustKeyEmbedded, reportExtractedTo, verification, ok }` (src/capability-core.ts:406-414).

### Operator UX human text

- `cw status <id> --summary` (src/operator-ux/format.ts:60-73): `Run: <id>`, `Workflow: <id> (<app>@<version>)`, `Phase: <name|none> | Stage: <stage> | Blocked: <reasons|no>`, `Tasks: <k=v, …>; total=<n>`, one line per phase `  <name>: <status> (<done>/<total> completed)`, empty line, `Next Action`, `  <command>` + `    reason: <reason>` per action, empty line, dim `(use --verbose for full worker/candidate/feedback/commit/trust panels)`.
- The full `cw status <id>` adds panels in this order: `Workers`, `Candidates`, `Feedback`, `Commits`, `Topologies`, `Multi-Agent`, `Multi-Agent Operator UX`, `Blackboard / Coordinator`, `Trust Audit`, `Multi-Agent Trust: <run>`, then `Report: <path>` (src/operator-ux/format.ts:26-55).
- `cw report <id> --show` adds `Active and Pending Tasks`, `Evidence` (or `  none recorded`), the multi-agent dependency/failure/evidence panels, and a fixed `Resource Commands` list of 18 `node scripts/cw.js …` lines (src/operator-ux/format.ts:75-114).
- `cw graph <id>` human form: `Run Graph: <id>`, `Nodes`, groups by kind sorted, `    [<status>] <id> (<label>) -> <path>`, then `Edges` with `  <from> -> <to> (<label>)` or `  none` (src/operator-ux/format.ts:116-132).
- The graph JSON is `{ runId, nodes[], edges[] }`; nodes sort by kind then id; edges are made unique on `from<US>to<US>label` and sort by from/to/label (src/operator-ux.ts:421-425,723-747). Node kinds seen: `run`, `phase`, `task`, `dispatch`, `worker`, `candidate`, `selection`, `commit`, `feedback`, plus every state node and the multi-agent / topology / blackboard graphs merged in (src/operator-ux.ts:362-419).
- Next-action advice order (first match wins): open feedback → failed worker → running tasks → active topology → pending tasks (`dispatch … --limit <n>`) → blackboard not ready → topology next action → all complete with gated commit (`report --show`) → completed worker with no candidate → unscored candidate → scored without selection → ready-for-commit → fallback `report --show` (src/operator-ux.ts:434-577).

### Workbench

- `WorkbenchRunView` JSON: `{ schemaVersion: 1, surface: "workbench", runId, resolved, error?, panels }`. Panel groups and members: `graph { operator, multiAgent, compact, criticalPath }`, `blackboard { coordinator, digest, graph }`, `worker { summary }`, `candidate { summary, reasoning }`, `metrics { report }`, `audit { summary, multiAgent, policy, judge }`, `collaboration { review, comments }` (src/workbench.ts:63-164). Each panel is `{ capability, cli, mcp, status: "present", data }` or `{ …, status: "absent", error }`; `data` is byte-equal to the named `cw <cmd> --json` payload (src/workbench.ts:55-61).
- Human `cw workbench view` text: `Workbench view <id> (resolved|UNRESOLVED)`, optional `  error: <e>`, then per group `  <group>:` and per panel `    <name>: <status> — <capability>` or `— absent (<error>)` (src/cli/format.ts:43-56).
- Serve descriptor: `{ schemaVersion: 1, surface: "workbench", command: "serve", host: "127.0.0.1", port, once, readOnly: true, scope, root, uiAvailable, uiRoot, routes[] }` with five fixed routes (`/`, `/ui/*`, `/api/index`, `/api/serve`, `/api/run/:runId`) (src/workbench.ts:195-224).
- The default `workbench serve` prints ONE compact line to stdout: `JSON.stringify({ …descriptor, boundPort })` + `"\n"` (not pretty; src/workbench-host.ts:93-96), then blocks.
- HTTP behavior: non-localhost `Host` header → 403 `{"error":"forbidden: non-localhost Host header"}`; non-GET → 405 `{"error":"read-only: only GET is permitted"}` with `Allow: GET`; bad token → 401 `{"error":"unauthorized: token mismatch"}`; bad URL escape → 400; unknown route → 404 `{"error":"no such read-only view: <route>"}`; path traversal → 403 `{"error":"forbidden: path traversal"}`; missing asset → 404 `{"error":"UI asset not installed: <rel>"}`; any throw → 500 `{"error": "<message>"}` (src/workbench-host.ts:98-141,146-162). JSON responses are pretty (2-space) with headers `Cache-Control: no-store` and `X-Content-Type-Options: nosniff` (src/workbench-host.ts:164-182). Allowed hostnames: `127.0.0.1`, `localhost`, `::1`, `[::1]`; no `Host` header at all is allowed (src/workbench-host.ts:39,185-189). A missing `index.html` gets a fixed fallback HTML page that lists the JSON routes (src/workbench-host.ts:199-210).

### Exit codes

| Command | Exit 1 when |
| --- | --- |
| `doctor`, `fix` | any check has status `fail` (command-surface.ts:129,175) |
| `report bundle` | `ok` false (operator.ts:39) |
| `report verify-bundle` | `ok` false (operator.ts:30) |
| `quickstart --bundle` | `bundle.ok` false (command-surface.ts:246-248) |
| `run inspect-archive` | `ok` false (run.ts:136) |
| `run restore` | `ok` false (run.ts:145) |
| `run verify-import --strict` | `ok` false; without `--strict` always exit 0 (run.ts:128) |
| any thrown error | always (cli.ts:15) |

## Files on disk

- `<repo>/.cw/runs/<id>/report.md` — the human report; `run.paths.report` (src/state.ts:14, orchestrator/report.ts:116).
- `<repo>/.cw/runs/<id>/metrics/metrics-report.json` — the persisted metrics snapshot; the full `MetricsReport` JSON with `freshness.status: "valid"` at write time (src/observability.ts:575-612). Read back only for its `sourceFingerprint` (observability.ts:584-593).
- `<repo>/.cw/runs/<id>/import-manifest.json` — written on import, durable write: `{ schemaVersion: 1, runId, importedAt, sourceVersion, archiveSha256, manifestSha256, files[] }` where `files[]` are the archive entries with `contentBase64` removed (src/run-export.ts:90-98,206-216).
- `<runId>.cwrun.json` (default name) — the portable archive, written where the caller says with `writeJson` (pretty JSON) (src/capability-core.ts:287, src/run-export.ts:139). Export refuses output paths under system directories by the pattern `^\/(etc|bin|sbin|usr|Library|System|Applications|boot|dev|proc|sys|root|var\/log|var\/run)\/` (src/capability-core.ts:293-296).
- `--extract-report <path>` writes the bundle's `report.md` bytes to that path (src/run-export.ts:560-572).
- Bundle verify restores into a temp dir `cw-verify-bundle-*` under `os.tmpdir()` and removes it in a `finally` block (src/run-export.ts:493,576).
- Workbench UI assets are read from `<pluginRoot>/ui/workbench/` on every request; nothing is cached (src/workbench.ts:46,188-190, workbench-host.ts:146-162).
- Doctor reads only: it checks the nearest existing parent dir of `$CW_HOME` and `<cwd>/.cw` for write access and never makes either (src/doctor.ts:60-80).

## Invariants and error behavior

1. **stdout is data; stderr is talk.** Machine payloads (`printJson`, the `cw:result` fence) never carry ANSI codes; `FORCE_COLOR` may color human text only (src/reporter.ts:7-11, src/cli/io.ts:17-19).
2. **Silent when piped.** The end-of-run summary and the drive progress render only on a TTY (or forced by `CW_DRIVE_PROGRESS=1`); a non-TTY stream gets zero bytes of chrome (src/reporter.ts:53, src/term.ts:128, src/drive.ts:138-141).
3. **Doctor is read-only and fail-closed.** It never writes; any `fail` check → `ok:false` → exit 1; a `warn` does not fail (src/doctor.ts:9-15,147-149).
4. **Metrics are derived and honest.** A rate over zero samples is `n/a` with `count`/`rate` null, never 0% or 100% (src/observability.ts:110-115). Cost is priced only from attested usage; no usage → `unreported`, usage with no policy → `unpriced`; exact-match money and default-price money stay two numbers (`attestedUsd` vs `estimatedUsd`) and never merge (src/observability.ts:276-355,659-703). Negative or broken time spans give `null`, not a lie (src/observability.ts:90-97). Runs that do not load are counted in `unreadableRuns`, never dropped without note (src/capability-core.ts:1127-1141).
5. **Freshness is fail-closed.** The snapshot fingerprint is structural (ids + statuses + timestamps + usage), so an edited status flips freshness to `stale`; no saved fingerprint → `absent` (src/observability.ts:121-151,482-485).
6. **`metricsShow` never touches `state.json`** — it writes only the `metrics/` snapshot, so repeated reads are stable (src/orchestrator.ts:476-487).
7. **Import is contained.** The run id must be one safe path segment (`assertSafeRunId`) and the run dir must stay inside `.cw/runs`; every restored file must stay inside the run dir; base64 must be canonical; a first failing digest/size/count/manifest check throws BEFORE any write of that file set (src/run-export.ts:168-190,749-770,825-839).
8. **Restore is fail-closed and ordered:** inspect (read-only) → refuse bad archive with nothing written → import → reuse the import's own verification verdict; `ok` is the verify verdict (src/capability-core.ts:349-387).
9. **Bundle `ok`** needs ALL of: archive bytes ok, telemetry chain ok, trust-audit chain ok, zero failed signatures, report⇄result cross-check ok, and no strict/extract/require shortfall (src/run-export.ts:613-622). Key order is bundle > `--pubkey` > `CW_AGENT_ATTEST_PUBKEY` (src/run-export.ts:484-491). `trustLevel: "signed"` needs at least one result-covering signature re-proved, zero failed, and the cross-check held (src/run-export.ts:597-598). A requested `--extract-report` that cannot be done is a failure, not a no-op (src/run-export.ts:607-608).
10. **The cross-check trusts only signed records.** It walks `sig.resultBound` (signature-covered result digests), never the archive's `run.tasks` list; each bound task's restored result file must hash to the signed digest and be present at its own `### <taskId>` section of `report.md`, body-first (src/run-export.ts:526-559,424-436).
11. **Workbench is read-only and fails closed.** Loopback bind only; GET only; non-localhost Host refused; an unreadable run gives `resolved:false` and all panels `absent` with the honest error — never a made-up view (src/workbench-host.ts:77,101-104, src/workbench.ts:55-61,144-164).
12. **Deterministic order everywhere.** Graph nodes/edges, evidence paths, workers, candidates, feedback all sort before render; export manifests and hash inputs use code-point order (`compareBytes`), not locale order (src/operator-ux.ts:421-425,654-681; src/run-export.ts:653,850-856; src/compare.ts:1-15).
13. **`writeReport` re-writes the whole file** each call from state; the report is a projection, not a store (src/orchestrator/report.ts:24-118).

## Edge cases

- `cw doctor` on a path whose parent chain holds a FILE (not a dir) reports not-writable: `dirWritable` walks up to the nearest existing parent and needs it to be a writable directory (src/doctor.ts:60-80).
- `whichBinary` honors `PATHEXT` on win32 and takes an explicit path with `/` or `\` as-is (src/doctor.ts:41-54).
- Legacy archives with only `artifacts[]` (no `files[]`) still import: entries are rebuilt from `artifacts`, base64 or utf8 `content`, with digests computed when absent (src/run-export.ts:724-747). An archive with no `integrity` block passes by default; `CW_REQUIRE_ARCHIVE_INTEGRITY=1` refuses it on import and marks inspect `ok:false` (src/run-export.ts:361-363,831-833).
- Import rebases every string path in the run state from the old run dir / old cwd to the new ones, and maps external artifact source paths to their packed `external-artifacts/<16-hex>-<safe name>` copies (src/run-export.ts:670-682,860-900). `run.updatedAt` is set fresh at import time (run-export.ts:867).
- Bundle verify on an archive with a bad schema stops early: no temp dir, nothing written (src/run-export.ts:462-464).
- `reportSectionEmbedsResult` walks EVERY `### <taskId>` place in `report.md`, so a stray heading inside an earlier result body cannot mis-anchor the check; the `Result:` path line matches loosely because it is host-specific (src/run-export.ts:424-436).
- `verifyImportedRun` on an absent trust-audit chain passes (nothing to prove), so old archives do not go red (src/run-export.ts:299-307).
- Findings collection is best-effort in both directions: a garbled `result.md` is skipped; an unloadable run gives no table at all — the summary still prints the report path (src/capability-core.ts:646-665).
- `truncate("…", 1)` returns `…`; width counts each code point as 1 (wide glyphs are a known small error) (src/term.ts:156-168).
- The metrics usage units never double-count: a worker with output owns its task's usage; a task completed straight through `cw result` is its own unit (src/observability.ts:178-193).
- Verifier gates that are pending/running are left out of the pass-rate denominator (src/observability.ts:396-411).
- Workbench serve with `--port 0` binds an ephemeral port and reports the real one as `boundPort` (src/workbench-host.ts:77-82).
- An HTTP/1.0 request with no `Host` header is allowed — the loopback bind already limits it (src/workbench-host.ts:185-186).
- `cw run export` output name may not be under a system dir; the check is on the resolved path (src/capability-core.ts:292-296).
- `quickstart` without `--json` prints the JSON payload to stdout AND the stderr summary; under `--json` the summary is off (src/cli/command-surface.ts:229-239).
- `cw quickstart --bundle` on a run that did not complete seals nothing and says so in `hint`: `--bundle skipped: the run did not complete (status=<s>); no bundle was sealed.` (src/capability-core.ts:806-809).

## Evidence

Every claim above carries its pointer inline. Chief anchors: src/reporter.ts:42-72 (summary + silence); src/term.ts:19-23,104-143,185-210 (color gate, phase line, success summary, findings table); src/doctor.ts:82-216 (checks, render, fixes); src/cli/command-surface.ts:126-131,170-177 (fix/doctor wiring + exit); src/orchestrator/report.ts:24-170 (report.md shape); src/observability.ts:110-115,276-355,463-529,599-612 (rates, cost, report, snapshot); src/observability/format.ts:27-71 (human metrics); src/observability/intake.ts:15-62 (policy + usage intake); src/operator-ux.ts:179-230,351-426,434-577 (summaries, graph, advice); src/operator-ux/format.ts:26-132 (status/report/graph text); src/run-export.ts:109-226,229-316,321-378,438-636,825-858 (export, import, verify, inspect, bundle, digests); src/capability-core.ts:285-432,646-665,1116-1145 (core entries); src/workbench.ts:41-224 and src/workbench-host.ts:39-210 (workbench); src/version.ts:1-5; src/compare.ts:13-15; src/cli.ts:5-29.

## Pinned by tests

- `test/doctor-smoke.js` — doctor report shape, read-only, warn-vs-fail exits, `--json` vs human, `--onramp`.
- `test/cli-progress-summary-smoke.js` — `printSuccessSummary` TTY render + non-TTY silence, `Try: cw doctor` recovery, `==>` phase lines, `--json` stdout stays byte-clean of `==>`/`Report:`/ANSI.
- `test/cli-render-smoke.js` — Reporter TTY/non-TTY paths, `progress()` verbatim write, `--full` inline report, truncate, `NO_COLOR`/`CW_NO_COLOR`/`FORCE_COLOR`.
- `test/cli-io-smoke.js`, `test/cli-format-smoke.js`, `test/cli-command-surface-smoke.js`, `test/cli-jsonmode-parity-smoke.js`, `test/cli-mcp-parity-smoke.js` — printJson, workbench human text, dispatch wiring, CLI-MCP payload parity.
- `test/observability-cost-accounting-smoke.js`, `test/telemetry-metrics-coverage-smoke.js` — derived durations, `n/a` rates, attested vs estimated cost, deterministic report over injected now, metrics CLI-MCP parity.
- `test/run-export-import-smoke.js`, `test/run-export-cross-machine-smoke.js`, `test/run-export-restore-rerun-smoke.js`, `test/run-export-restore-resume-smoke.js`, `test/run-import-path-traversal-smoke.js`, `test/run-import-tamper-failclosed-smoke.js`, `test/run-inspect-archive-smoke.js`, `test/run-restore-failclosed-smoke.js`, `test/verify-import-audit-chain-smoke.js` — the whole archive family and its fail-closed exits.
- `test/report-bundle-smoke.js`, `test/report-verify-bundle-smoke.js`, `test/demo-bundle-smoke.js`, `test/tamper-evidence-demo-smoke.js` — bundle produce-and-prove, offline verify, forgery detection.
- `test/web-desktop-workbench-smoke.js`, `test/cli-handler-workbench-smoke.js` — panel byte-parity, GET-only, 403/405, loopback bind, fail-closed absent panels, no hidden state.
- `test/operator-ux-smoke.js`, `test/multi-agent-operator-ux-smoke.js` — operator summaries, graph, next-action advice.

## Rebuild risks

1. **The Rule of Silence gate points.** Silence is decided in three places, not one: the reporter checks its own stream's `isTTY`, drive progress checks `process.stderr.isTTY` + `CW_DRIVE_PROGRESS`, and the quickstart path also skips the summary under `--json`. Miss one and piped output grows chrome.
2. **`cw fix` has no `--json`** even though `docs/fix.7.md` says it does. A rebuild from the docs would add a branch the old code does not have; a conformance test on the old binary would then differ.
3. **The `### <taskId>` result shape in `report.md` is load-bearing.** Bundle verify anchors on `### <id>\n\nResult: <path>\n\n<body>` body-first. Change a space or the blank lines in `renderResults` and every signed bundle stops verifying.
4. **Sort orders that feed hashes must be code-point order, not locale order.** The export manifest digest and the archive file list use `compareBytes`; using `localeCompare` there makes digests differ across hosts. Display sorts (operator panels) DO use `localeCompare`. Do not swap them.
5. **Cost states must never merge.** `attestedUsd` and `estimatedUsd` are two fields; a default-priced model also lands in `unpricedModels`; pooled state picks `estimated` over `attested` when both exist. Folding them into one number breaks the honesty contract and the smoke tests.
6. **Freshness pinning in `metrics show`.** The returned payload is forced to `freshness: "valid"` with the fingerprint equal to itself (so CLI and MCP are byte-equal), while `metrics summary` reports the real `valid|stale|absent` per run against the saved snapshot. Copying one behavior to the other breaks parity or honesty.
7. **Exit-code asymmetry in the archive family.** `import` and default `verify-import` exit 0 even on a false verdict; `--strict` verify-import, `inspect-archive`, `restore`, `report bundle`, and `report verify-bundle` exit 1 on a false verdict. Making them uniform changes scripted behavior.
8. **The workbench serve stdout line is compact JSON, not pretty.** Everything else on stdout is pretty-printed via `printJson`; the host's `run()` prints a single compact `JSON.stringify` line with `boundPort` added. A rebuild that reuses `printJson` there changes the bytes.
