# orchestrator

## Scope (one line)

This spec covers the `CoolWorkflowRunner` facade and its helper modules: `src/orchestrator.ts` plus every file under `src/orchestrator/` (`app-operations.ts`, `audit-operations.ts`, `candidate-operations.ts`, `cli-options.ts`, `collaboration-operations.ts`, `feedback-operations.ts`, `host-operations.ts`, `lifecycle-operations.ts`, `migration-operations.ts`, `multi-agent-operations.ts`, `report.ts`, `topology-operations.ts`).

## Public surface

### The facade shape is a rule, not an accident

`CoolWorkflowRunner` is the ONE facade that both front doors (`cli.ts` and the MCP server) go through. It is wide (141 public capability methods) and thin on purpose: each method loads durable run state and hands the work to a domain module. The project docs say this shape is an anti-goal to take apart; the CLI<->MCP parity gate fails closed if one surface has a method the other does not (src/orchestrator.ts:42-59, docs/cli-mcp-parity.7.md). Of the 141 methods exactly ONE is a runner-to-runner forward: `collaborationReject` calls `this.collaborationApprove(runId, targetKind, targetId, options, "reject")` (src/orchestrator.ts:53-59, 323-325).

### Class `CoolWorkflowRunner`

- `constructor({ pluginRoot, baseDir })` — resolves `pluginRoot` by walking up at most 5 directory levels until a directory has BOTH `workflows/` and `package.json`; if none is found it throws `Run cw.js from the cool-workflow plugin directory`. Sets `workflowsDir = <pluginRoot>/workflows` and `appsDir = <pluginRoot>/apps`. `baseDir` (if given) is made absolute (src/orchestrator.ts:74-79, 1018-1027).
- `withBaseDir(dir)` — gives back a runner that resolves runs against `dir` in place of `process.cwd()`, with NO `process.chdir`. Same instance comes back when the resolved dir is unchanged (src/orchestrator.ts:105-109).
- `loadWithCache(fn)` — runs `fn(runner)` with a per-request `loadRun` memo keyed by run id, and a trust-audit event cache (`setAuditEventCache(new Map())`). It is reentrant: it saves the outer cache and puts it back in `finally`, so a nested call never wipes the outer scope's in-memory run. The audit cache is cleared with `clearAuditEventCache()` in the same `finally` (src/orchestrator.ts:91-101).
- `loadRun(runId)` — reads the memo first; on a miss it calls `loadRunFromCwd(runId, this.baseDir)` which reads `<base>/.cw/runs/<runId>/state.json` and runs the state migration in dry-run form (src/orchestrator.ts:766-774, src/state.ts:52-61).
- Private helpers: `invocationCwd()` = `baseDir || process.cwd()`; `resolveFromBase(target)` = `path.resolve(invocationCwd(), target)`; `loadWorkflowAppById` delegates to `appOps.loadWorkflowAppById` (src/orchestrator.ts:776-786).

### The 141 capability methods, by domain, with the module that does the real work

Every method below takes `runId` first when it touches a run; `options` is a raw parsed-argv bag (`Record<string, unknown>`). "persists" means the op writes `report.md` (via `writeReport`) and then `state.json` (via `saveCheckpoint`).

**Workflow-app domain** — delegate: `src/orchestrator/app-operations.ts` (plus inline `init`):

| Method | What it does | Real work |
| --- | --- | --- |
| `listWorkflows()` | id/title/summary/file per app | `app-operations.ts:83` |
| `listApps()` | `WorkflowAppSummary[]` | `app-operations.ts:95` |
| `showApp(appId)` | full app + workflow projection | `app-operations.ts:99` |
| `validateApp(target)` | validation result; catch turns errors into issues | `app-operations.ts:141` |
| `initApp(appId, options)` | writes `app.json` + `workflow.js`, then validates | `app-operations.ts:164` |
| `packageApp(appId, options)` | writes a `.cwapp.json` package | `app-operations.ts:197` |
| `init(workflowId, options)` | writes a workflow template file | inline, src/orchestrator.ts:135-148 |

**Run lifecycle** — delegate: `src/orchestrator/lifecycle-operations.ts`:

| Method | What it does | Real work |
| --- | --- | --- |
| `plan(workflowId, options)` | makes a new run dir + state + task/plan nodes; commits `initial-plan` | `lifecycle-operations.ts:62` |
| `status(runId)` | `RunSummary` view (no write) | `report.ts:120` (`summarizeRun`) |
| `next(runId, options)` | next dispatchable tasks; `options.limit` | `src/dispatch.ts` (`nextDispatchTasks`) |
| `dispatch(runId, options)` | dispatch manifest; commits `dispatch:<id>` | `lifecycle-operations.ts:210` |
| `recordResult(runId, taskId, resultPath, options)` | accepts a task result; commits `result:<taskId>` | `lifecycle-operations.ts:253` |
| `recordWorkerOutput(runId, workerId, resultPath, options)` | accepts a worker result; commits `worker:<id>:result`; may expand a loop round | `lifecycle-operations.ts:360` |
| `recordWorkerFailure(runId, workerId, message, options)` | records failure, `loopStage="adjust"` | `lifecycle-operations.ts:400` |
| `checkState(runId, options)` | migration report for a state file; `--write` persists | `lifecycle-operations.ts:428` |
| `commit(runId, input)` | verifier-gated commit or checkpoint | `lifecycle-operations.ts:437` |

**Worker domain** — delegate: `src/worker-isolation`:
`listWorkers` (filter by `options.status`), `showWorker` (throws on unknown id), `reclaimOrphans(runId, now?)`, `showWorkerManifest` (throws on unknown id), `validateWorker(runId, workerId, targetPath?)` (src/orchestrator.ts:177-215).

**Audit domain** — delegate: `src/orchestrator/audit-operations.ts` over `src/trust-audit` and `src/multi-agent-trust`:
`auditSummary`, `auditMultiAgent`, `auditPolicy`, `auditRole(runId, roleId)`, `auditBlackboard`, `auditJudge`, `workerAudit(runId, workerId)`, `evidenceProvenance(runId, options)` (filters: `--worker`, `--candidate`, `--commit`), `recordAuditAttestation(runId, options)` (persists), `recordAuditDecision(runId, workerId, options)` (persists; see error section) (src/orchestrator.ts:220-258).

**Sandbox + backend (no run state)** — delegates: `src/sandbox-profile`, `src/execution-backend`:
`listSandboxProfiles(options)`, `showSandboxProfile(profileId, options)`, `validateSandboxProfile(profileFile, options)` — all take `options.cwd` (default: the runner's invocation cwd). `listBackends()`, `showBackend(backendId)`, `probeBackend(backendId?, options)` (src/orchestrator.ts:260-284).

**Candidate domain** — delegate: `src/orchestrator/candidate-operations.ts` over `src/candidate-scoring`:
`listCandidates` (filters `--status`, `--kind`), `showCandidate` (throws on unknown id), `registerCandidate` (folds worker/task node + artifact + evidence context; persists), `scoreCandidate` (persists), `rankCandidates` (persists), `selectCandidate` (persists), `rejectCandidate(runId, candidateId, reason)` (persists) (src/orchestrator.ts:287-313).

**Team collaboration** — delegate: `src/orchestrator/collaboration-operations.ts` over `src/collaboration`:
`collaborationApprove(runId, targetKind, targetId, options, decision="approve")`, `collaborationReject` (forward to approve with `"reject"`), `collaborationComment`, `collaborationCommentList`, `collaborationHandoff`, `reviewStatus` (injectable `options.now`), `reviewPolicy`, `formatReviewStatus(report)`, `formatCommentList(comments)` (the last two are pure text renderers) (src/orchestrator.ts:319-353).

**Operator views (read-only)** — delegate: `src/operator-ux`:
`operatorStatus`, `summarizeWorkerRecords`, `summarizeCandidateOperatorRecords`, `summarizeFeedbackRecords`, `summarizeCommitRecords`, `operatorGraph` (src/orchestrator.ts:161-163, 355-369, 405-407).

**Report + nodes + contract**:
`report(runId)` returns `{ path }` after writing `report.md`; `operatorReport(runId)` writes the report then returns the operator summary; `showContract(runId, contractId?)` via `createPipelineRunner().getRunContract`; `listNodes` returns `run.nodes || []`; `showNode(runId, nodeId)` via `getRunNode`; `graphNodes` projects `{ id, kind, status, parents, children }` per node (src/orchestrator.ts:371-403).

**Multi-agent views** — delegates: `src/multi-agent`, `src/multi-agent-operator-ux`, `src/evidence-reasoning`, `src/state-explosion`, `src/observability`, `src/coordinator`:
`multiAgentSummary`, `multiAgentGraph`, `multiAgentOperatorStatus`, `multiAgentOperatorGraph`, `multiAgentDependencies`, `multiAgentFailures`, `multiAgentEvidence` (adds `rationaleStatus` per row from the evidence-reasoning report; additive, old row shape kept), `multiAgentReasoning` (with `--refresh` it recomputes + `saveCheckpoint`), `multiAgentReasoningRefresh` (persists), `summaryRefresh` (recomputes summaries for `--view` list; writes report + checkpoint), `summaryShow` (checkpoints after read), `metricsShow` (NEVER checkpoints; `args.now` injectable; pricing policy via `loadCostPolicy(args, pluginRoot)`), `blackboardSummarize`, `multiAgentSummarize`, `multiAgentGraphView` (view/focus/depth), `stateExplosionReport` (src/orchestrator.ts:409-510).

**Host multi-agent** — delegate: `src/orchestrator/host-operations.ts` over `src/multi-agent-host`:
`hostMultiAgentRun(runId?, options)` — load-or-plan policy lives in the runner: no `runId` plus `--app <id>` means plan a fresh run with the host-run keys stripped (`withoutHostRunKeys`); no run at all throws `multi-agent run requires <run-id> or --app <app-id>`. `hostMultiAgentStatus` (writes report, no checkpoint), `hostMultiAgentStep`, `hostMultiAgentBlackboard(runId, action?, options)`, `hostMultiAgentScore`, `hostMultiAgentSelect` (all persist) (src/orchestrator.ts:514-543, src/orchestrator/host-operations.ts:9-47).

**Eval / replay** — delegate: `src/multi-agent-eval`:
`evalSnapshot(runId, options)`, `evalReplay(target, options)`, `evalCompare(baseline, replay)`, `evalScore(target)`, `evalGate(target)`, `evalReport(target)` (src/orchestrator.ts:545-567).

**Node snapshot / diff / replay** — delegate: `src/node-snapshot`:
`nodeSnapshot(runId, nodeId, options)`, `nodeDiff(runId, baselineSnapshotId, candidateSnapshotId)`, `nodeReplay(runId, snapshotId, options)`, `nodeReplayVerify(runId, replayId, options)` (src/orchestrator.ts:570-587).

**Contract migration** — delegate: `src/orchestrator/migration-operations.ts` over `src/contract-migration`:
`migrationList()`, `migrationCheck(target, options)`, `migrationProve(target, options)` (writes an append-only proof file; a read-only target still returns the proof), `loadMigrationSnapshot(target, options)` (`options.contract === "workflow-app"` picks that contract, anything else means `"run-state"`; `target` may be a file path or a run id resolved to `<cwd>/.cw/runs/<target>/state.json`) (src/orchestrator.ts:591-605, src/orchestrator/migration-operations.ts:9-38).

**Topology** — delegate: `src/orchestrator/topology-operations.ts` over `src/topology`:
`listTopologies()`, `showTopology(topologyId)` (throws `Unknown topology id: <id>`), `validateTopology(topologyId)`, `applyTopology(runId, topologyId, options)` (persists; options: id, title, multi-agent-run, blackboard, tasks, `mapper-count`, `judge-count`, `debate-rounds`, `collect-initial-fanin`, metadata), `showTopologyRun(runId, topologyRunId)`, `topologySummary(runId)`, `topologyGraph(runId)` (src/orchestrator.ts:608-634).

**Multi-agent lifecycle + blackboard** — delegate: `src/orchestrator/multi-agent-operations.ts` over `src/multi-agent` and `src/coordinator`:
Mutating (all persist): `createMultiAgentRun`, `transitionMultiAgentRun` (status default `"running"`), `createAgentRole`, `createAgentGroup`, `assignAgentMembership`, `createAgentFanout` (reason default `"work split"`), `collectAgentFanin`, `resolveRunBlackboard`, `createBlackboardTopic`, `postBlackboardMessage`, `putBlackboardContext`, `addBlackboardArtifact`, `snapshotBlackboard`, `recordCoordinatorDecision` (author defaults: `authorKind` `"coordinator"`, `authorId` `"cw"`).
Read-only: `showMultiAgentRun`, `showAgentRole`, `showAgentGroup`, `showAgentMembership`, `showAgentFanout`, `showAgentFanin` (each throws on unknown id), `blackboardSummary`, `coordinatorSummary` (same body as `blackboardSummary`), `blackboardGraph`, `listBlackboardMessages`, `listBlackboardArtifacts` (src/orchestrator.ts:637-735, src/orchestrator/multi-agent-operations.ts).

**Feedback** — delegate: `src/orchestrator/feedback-operations.ts` over `src/error-feedback`:
`collectFeedback` (persists), `listFeedback` (filters `--status`, `--severity`, `--classification`), `showFeedback` (throws on unknown id), `createFeedbackTask(runId, feedbackId, options)` (`--verify`, `--guidance`; persists), `resolveFeedback` (`options.status === "rejected"` gives `"rejected"`, anything else gives `"resolved"`; persists) (src/orchestrator.ts:746-764, src/orchestrator/feedback-operations.ts:8-48).

### Module-level exports of `src/orchestrator.ts`

- `parseArgv(argv)` — returns `{ command, positionals, options }`. Rules:
  - first token is `command`;
  - `--` is POSIX end-of-options: everything after it is a positional, even dash-leading tokens (src/orchestrator.ts:799-804);
  - single-dash flags map through `{ q: "question", r: "repo", d: "dir", l: "link", a: "agent-command", h: "help", v: "version" }`; an unmapped short flag keeps its own name (src/orchestrator.ts:809-817);
  - `--key=value` splits at the first `=`; a value that starts with `-` survives only through `--key=-value` or after `--`;
  - a valueless flag is `true`; a flag NEVER consumes a next token that starts with `-` (single or double dash) (src/orchestrator.ts:826-835);
  - a repeated key turns its value into an array (`appendOption`, src/orchestrator.ts:1009-1016).
- `KNOWN_COMMANDS` — a `Set` of every top-level command name, used for "did you mean" (src/orchestrator.ts:842-851). Exact members: `help list doctor info search man init quickstart plan status next dispatch result state commit report app sandbox backend contract node feedback worker audit candidate review loop schedule routine registry run queue clones orphans history audit-run multi-agent topology summary blackboard coordinator metrics operator sched gc telemetry migration demo workbench approve reject comment handoff graph eval version update fix`.
- `suggestCommand(input)` — Levenshtein nearest command; returns `undefined` when input length < 2, or when the best distance is > 3 or > half the input length (src/orchestrator.ts:875-887).
- `formatSearchResults(keyword, results)` — human text (see Exact outputs).
- `formatInfo(appId, data)` — human text (see Exact outputs).
- `formatHelp()` — the top-level `cw help` text; color keyed off `process.stdout` (see Exact outputs).
- `formatCommandHelp(verb)` — per-verb help built from `CAPABILITY_REGISTRY` rows whose `cli.path[0] === verb`; unknown verb gives a soft "Unknown command" text (never a throw) (src/orchestrator.ts:988-1007).

### Exports of the submodules (reachable by other modules and by tests)

- `src/orchestrator/report.ts`: `writeReport(run)` (writes `report.md`, returns its path) and `summarizeRun(run)` (the `RunSummary` view model). Both call `updatePhaseStatuses(run)` first (src/orchestrator/report.ts:24-149).
- `src/orchestrator/cli-options.ts`: pure option coercers — `isMissing`, `numberOption`, `stringOption`, `requiredStringOption`, `COLLABORATION_TARGET_KINDS`, `collaborationTarget`, `collaborationTargetMaybe`, `actorInputFrom`, `firstDefined`, `graphViewOption` (default `"compact"`), `graphViewsOption`, `metadataOption` (JSON string or object), `withoutHostRunKeys`, `optionsRecord`, `parseBlackboardAuthor`, `parseBlackboardScope`, `parseBlackboardLinks`, `parseSandboxChoices`, `parseCriteria`, `parseEvidence`, `mergeEvidence`, `arrayOption`, `valuesOption`, `inferAuditDecisionKind`, `isSandboxProfileError`, `validationIssuesFromError` (src/orchestrator/cli-options.ts:17-271).
- Every `*-operations.ts` file exports its domain functions taking an already-loaded `WorkflowRun`; unit tests require them straight from `dist/orchestrator/*` (e.g. test/collaboration-ops-unit-smoke.js:22).

### Env vars

- `CW_DETERMINISTIC_RUN_IDS` — truthy match `/^(1|true|yes|on)$/i`. When set, `plan()` mints run ids as `<workflowId>-<hash6>` where `hash6` is the first 6 hex chars of `sha256("<workflowId>:<pid>:<sequence>")` — no wall-clock part. When not set the id is `<workflowId>-<stamp>-<hash6>` where `stamp` is the ISO time with `-` and `:` removed and sub-seconds cut (e.g. `20260703T120000Z`), and `hash6` = first 6 hex of `sha256("<workflowId>:<stamp>:<pid>:<sequence>")` (src/orchestrator/lifecycle-operations.ts:666-689).

## Exact outputs

### `formatHelp()` (top-level `cw help`)

Line-by-line structure (color codes come from `bold`/`dim` keyed off stdout; strings below are the plain content):

```text
Cool Workflow

  -q "question" [-claude|-codex|-gemini|-deepseek]  Ask a question, get a report
  -q "question" --link <url>                 Review a remote repo by URL
  version                                   Show version
  update                                    Update to latest release
  doctor                                    Check setup
  fix                                       Show fix commands for setup issues

Flags
  -q, --question TEXT    The task or question to answer
  -r, --repo PATH        Target repository path (default: .)
  -d, --dir PATH         Project folder to review (alias for --repo)
  -claude                Use Claude agent
  -codex                 Use Codex agent
  -gemini                Use Gemini (via opencode)
  -deepseek              Use DeepSeek (via opencode)
  --verbose              Show full agent narration live (default: compact)
  --full                 Verbose, plus the report printed inline at the end
  --no-color             Disable ANSI color (also honors NO_COLOR / FORCE_COLOR)
  --json                 Print JSON for commands that support it
  --quiet                Suppress [drive] progress lines (not agent output)

More commands
  <pipe-joined command tokens, 2-space indent, wrapped at 76 columns>

    Run  cw help <command>  for one command's subcommands and descriptions.
```

The "More commands" token list is this exact space-separated set, then pipe-joined with no spaces: `list search info init plan status next dispatch result state commit report app sandbox backend contract node feedback worker audit candidate review loop schedule routine registry run queue clones orphans history quickstart audit-run multi-agent topology summary blackboard coordinator metrics operator sched gc telemetry migration demo workbench approve reject comment handoff ledger graph eval man version fix completion`. The last note line has a 4-space indent ON PURPOSE so the parity help-token check (which only parses 2-space lines) never reads it as a command (src/orchestrator.ts:931-981).

### `formatCommandHelp(verb)`

Known verb:

```text
cw <verb>

  cw <verb> <sub...>  <registry summary>
  ...
```

Rows are sorted by command string; the command column is padded to `min(40, longest)`. Unknown verb (soft, exit stays 0 at the CLI layer):

```text
Unknown command: <verb>
  Did you mean:  cw <hint>
  Try:  cw help   (list all commands)
```

The `Did you mean` line is present only when `suggestCommand` returns a hint (src/orchestrator.ts:988-1007).

### `formatSearchResults(keyword, results)`

No match:

```text
No workflows matched "<keyword>".
  Tip: cw list for all available workflows.
```

With matches (header bold, summary line dimmed, summary cut at 120 chars with `…`):

```text
<n> workflow[s] matching "<keyword>"
  <id> — <title>
    <summary[0..120]>[…]

Use cw info <id> for full details.
```

(src/orchestrator.ts:889-897)

### `formatInfo(appId, data)`

```text
cw info <appId>
  Title: <title>
  Version: <version>
  Summary: <summary>
  Author: <name>
  Compatible: yes|no
  Inputs:
    - <name> (<type>[, required][, default: <default>])[ — <description>]
  Sandbox: <profile, profile>
  Phases: <n> phase[s], <m> task[s]
  Run: cw quickstart <appId> --repo . --question "..."
```

Each labeled line appears only when its field is present; the `Run:` line always appears (src/orchestrator.ts:899-929).

### `report.md` (written by `writeReport`)

Section order and exact headers:

```markdown
# <workflow title>

- Run: <runId>
- Workflow: <workflowId>
- Workflow App: <appId>@<version>
- Workflow App Source: <path>
- Created: <ISO>
- Updated: <ISO>
- Repository: <inputs.repo || run.cwd>
- Source: <sourceUrl>[@<sourceCommit>]
- Question: <question>
- Invariants: <joined with "; ">
- Loop Stage: <loopStage>

## Phase Status

| Phase | Status | Completed | Total |
| --- | --- | ---: | ---: |
| <name> | <status> | <n> | <m> |

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

Rules with exact strings:

- The `- Workflow App:` pair appears only when `run.workflow.app` is set; the `- Source:` line only when `run.inputs.sourceUrl` is set. When the app metadata domain is `research` AND there is no `sourceUrl`, the `Repository` label becomes `Source` (src/orchestrator/report.ts:32-53).
- Empty-section fallback lines, byte-exact: `No state commits yet.`, `No feedback records.`, `No worker scopes yet.`, `No multi-agent runtime records yet.`, `No blackboard records yet.`, `No sandbox profiles selected yet.`, `No candidates yet.`, `No pending tasks.`, `No completed results yet.`, `No accepted candidate or verifier-gated commit rationale yet.` (src/orchestrator/report.ts:153-373).
- Commit row: `- <id>: <reason> [<loopStage>; verifier-gated commit|checkpoint; <gate>] (<snapshotPath>)` where a non-gated row's gate part is `verifierGated=false` and a gated row's gate is `verifier=<id|unknown>, candidate=<id>, selection=<id>, evidence=<n>` with empty parts dropped (src/orchestrator/report.ts:172-179, 376-385).
- Pending task row: `- <taskId> (<phase>, <status>): <taskPath>` (src/orchestrator/report.ts:154).
- Result section: `### <taskId>`, blank, `Result: <path>`, blank, then the full result file text; a missing file renders `_Result file is not present on this host; state metadata remains inspectable._` (src/orchestrator/report.ts:161-169).
- Trust-audit block: `- Events: <n>`, `- Chain integrity: verified|FAILED|n/a (<x> chained, <y> legacy[, <z> corrupt])`, and on failure the loud line `  !! TRUST-AUDIT CHAIN TAMPER DETECTED: <codes>` (src/orchestrator/report.ts:301-321).
- Telemetry attestation block (only when delegation events carry `telemetryAttestation`): `- Telemetry attestation: <a>/<n> attested[, <u> UNATTESTED][, <b> absent]`; per unattested event `  - ⚠️  UNATTESTED usage — worker=<id|?> task=<id|?>: <reason|signature unverified>`; ledger line `- Attestation ledger: <n> records, chain verified (tamper-evident)` or `  - ⚠️  ATTESTATION LEDGER CHAIN BROKEN — a recorded verdict/usage was edited after the fact (<check names>)` (src/orchestrator/report.ts:326-355).
- Counts render as `key=value, key=value` sorted by key, or `none` when empty (src/orchestrator/report.ts:387-391).

### `summarizeRun(run)` (`RunSummary` JSON shape)

```json
{
  "runId": "...", "workflowId": "...", "app": {},
  "phases": [], 
  "tasks": { "total": 0, "pending": 0, "running": 0, "failed": 0, "completed": 0 },
  "loopStage": "interpret",
  "durationMs": 0,
  "progressPercent": 0,
  "next": "phase name or null",
  "reportPath": ".../report.md",
  "commits": [],
  "workers": { "total": 0, "byStatus": {} }
}
```

`durationMs = max(0, updatedAt - createdAt)` and is absent when either stamp does not parse; `progressPercent = round(completed / total * 100)` and 0 when there are no tasks; `next` is the first runnable phase name or `null` (src/orchestrator/report.ts:120-149).

### Small JSON envelope shapes made in this subsystem

- `collaborationCommentList` → `{ "schemaVersion": 1, "surface": "collaboration", "runId", "target"?, "count", "comments" }` (src/orchestrator/collaboration-operations.ts:67-78).
- `reviewPolicy` → `{ "schemaVersion": 1, "surface": "collaboration", "runId", "policy" }` (src/orchestrator/collaboration-operations.ts:125).
- `auditPolicy` → `{ "schemaVersion": 1, "runId", "rolePolicies", "permissionDecisions", "policyViolations", "nextAction" }`; `auditRole` adds `roleId`, `role`, `blackboardWrites`, `messageProvenance`, `judgeRationales`, `panelDecisions`, `events`, and its `nextAction` is exactly `cw audit multi-agent <runId> --json`; `auditBlackboard` and `auditJudge` are filtered projections with `schemaVersion: 1` (src/orchestrator/audit-operations.ts:38-93).
- `migrationList` → `{ "contracts": [...] }` (src/orchestrator/migration-operations.ts:9-11).
- `report(runId)` → `{ "path": "<report.md path>" }` (src/orchestrator.ts:371-374).
- `init` → `{ "id", "path" }`; `initApp` → `{ "id", "manifestPath", "entrypointPath" }`; `packageApp` → `{ "id", "version", "path" }`; `commit` → `{ "runId", "commit" }` (src/orchestrator.ts:135-148, src/orchestrator/app-operations.ts:170, 203, src/orchestrator/lifecycle-operations.ts:57-60, 455).
- `graphNodes` row → `{ "id", "kind", "status", "parents", "children" }` (src/orchestrator.ts:395-403).

### Error strings (thrown; byte-exact templates)

From `src/orchestrator.ts`:
- `Workflow id must include at least one letter or digit` (137)
- `Refusing to overwrite existing workflow: <destination>` (143)
- `Unknown worker id for run <runId>: <workerId>` (185, 196)
- `multi-agent run requires <run-id> or --app <app-id>` (521)
- `Run cw.js from the cool-workflow plugin directory` (1026)

From `src/orchestrator/app-operations.ts`:
- `Duplicate workflow app id <id>: <path1> and <path2>` (55-57)
- `Workflow app not found: <appId>` (66)
- `Missing workflow app path or id` (73)
- `App id must include at least one letter or digit` (172)
- `Refusing to create app in a system directory: <destinationDir>` (179)
- `Refusing to overwrite existing workflow app: <destinationDir>` (184)
- `Generated workflow app is invalid` (a `WorkflowAppValidationError` with the issues attached) (191)

From `src/orchestrator/lifecycle-operations.ts`:
- `Missing required input --<name>` (485)
- `Unknown task id for run <runId>: <taskId>` (255)
- `Result path must not be a system directory: <resultPath>` (264)
- `Result file does not exist: <absolutePath>` (267)
- `Result cites file evidence that does not resolve on disk: <list joined with ", ">` (276)
- `Duplicate task id: <taskId>` (611)

From `src/orchestrator/cli-options.ts`:
- `Missing <label>` (34)
- `Target kind must be one of run|task|candidate|selection|commit|node` (44)
- `Missing target id` (46)
- `Unknown graph view: <view>. Valid views: <list joined with ", ">` (85, 95)
- `Invalid JSON in --metadata: <first 80 chars>` (104)
- `Missing score criteria. Use --criterion name=value` (220)

From `src/orchestrator/audit-operations.ts`:
- `Unknown worker id for run <runId>: <workerId>` (140)
- `Missing audit decision target: provide --path, --command, --network, or --env` (143)
- env deny record: code `sandbox-env-denied`, message `Worker <workerId> env var is outside sandbox profile <profileId|unknown>: <name>` (153)

From `src/orchestrator/candidate-operations.ts`: `Unknown candidate id for run <runId>: <candidateId>` (29), `Unknown worker id for run <runId>: <workerId>` (36).
From `src/orchestrator/feedback-operations.ts`: `Unknown feedback id for run <runId>: <feedbackId>` (25).
From `src/orchestrator/migration-operations.ts`: `Migration target not found: <target>` (36).
From `src/orchestrator/topology-operations.ts`: `Unknown topology id: <topologyId>` (15).
From `src/orchestrator/multi-agent-operations.ts`: `Unknown MultiAgentRun id for run <runId>: <id>` (150), `Unknown AgentRole id for run <runId>: <id>` (156), `Unknown AgentGroup id for run <runId>: <id>` (162), `Unknown AgentMembership id for run <runId>: <id>` (168), `Unknown AgentFanout id for run <runId>: <id>` (174), `Unknown AgentFanin id for run <runId>: <id>` (180).
From `src/state.ts` (reached through `loadRun`): `Missing run id` (53), `Unsupported CW run state: <errors joined with "; ">` (58), `File not found: <file>` (115), `Invalid JSON in <file>: <message>` (120).

Exit codes are owned by the CLI layer (`cli.ts`), not by this subsystem; the runner signals failure only by throwing.

### Deterministic id and node-id formats (a rebuild must keep these bytes)

- Run id: `<workflowId>-<stamp>-<hash6>` (or `<workflowId>-<hash6>` under `CW_DETERMINISTIC_RUN_IDS`) (src/orchestrator/lifecycle-operations.ts:667-689).
- Node ids made here: `<runId>:input`, `<runId>:task:<taskId>`, `<runId>:result:<taskId>`, `<runId>:verifier:<taskId>`, `<runId>:loop-control:<originPhaseId>:r<round>`; a result node's parent is `<runId>:dispatch:<dispatchId>` when the task was dispatched (src/orchestrator/lifecycle-operations.ts:167, 181, 291, 303, 326, 540).
- Commit reasons minted here: `initial-plan`, `dispatch:<dispatchId>`, `result:<taskId>`, `worker:<workerId>:result`, and the manual default `manual` (src/orchestrator/lifecycle-operations.ts:199, 223, 337, 384, 444).
- Loop round names: next phase id `<originId>@r<n>`, phase name `<origin name> (round <n>)`, task ids `<baseId>@r<n>` (the old `@r<x>` tail is stripped first) (src/orchestrator/lifecycle-operations.ts:553-581).
- Loop stop reasons: `budget-target: <spent>/<target> recorded tokens` and `loop predicate "<ref>" not registered — stopping fail-closed` (src/orchestrator/lifecycle-operations.ts:527, 532).

## Files on disk

All run files live under `<cwd>/.cw/runs/<runId>/` (`cwd` is `inputs.cwd || inputs.repo || process.cwd()` at plan time; reads use the runner's `baseDir` or the process cwd).

| Path | Made by | Format |
| --- | --- | --- |
| `.cw/runs/<runId>/state.json` | `plan` + every persisting op (`saveCheckpoint`) | one JSON `WorkflowRun`; `schemaVersion: 1`; durable write under a file lock |
| `.cw/runs/<runId>/report.md` | `writeReport` on every persisting op | the markdown shown in Exact outputs |
| `.cw/runs/<runId>/tasks/` | `writeTaskFiles` at plan and loop expansion | one markdown prompt file per task |
| `.cw/runs/<runId>/results/<safeFileName(taskId)>.md` | `recordResult` copies the caller's file in | markdown result envelope |
| `.cw/runs/<runId>/dispatches/`, `artifacts/`, `commits/`, `nodes/`, `feedback/`, `workers/`, `candidates/`, `multi-agent/`, `blackboard/`, `topologies/` | `ensureRunDirs` at plan | domain dirs (owned by the domain modules) |
| `.cw/runs/<runId>/audit/events.jsonl`, `audit/summary.json`, `audit/index.json` | trust-audit module; the paths are seeded into `run.audit` at plan | JSONL event chain + JSON summaries |
| `.cw/packages/<appId>-<version>.cwapp.json` (default; `--output` overrides) | `packageApp` | `{ "schemaVersion": 1, "app": <run metadata>, "workflow": <definition>, "packagedAt": "<ISO>" }` |
| `<appsDir>/<id>/app.json` + `<appsDir>/<id>/workflow.js` (default; `--directory`/`--output` overrides) | `initApp` | manifest + entrypoint templates |
| `<workflowsDir>/<id>.workflow.js` (default; `--output` overrides) | `init` | workflow app template |
| `<state dir>/migration/<fingerprint first 16 hex>.json` | `migrationProve` | the migration proof JSON, append-only next to the target |
| `metrics/` under the run | `metricsShow` (through `showMetricsReport`) | fingerprinted snapshot; the run's own `state.json` is untouched |

Reads: `loadRun` reads `.cw/runs/<runId>/state.json`; `checkState` reads the same path or the `--state` override; `loadMigrationSnapshot` reads a file path or `<cwd>/.cw/runs/<target>/state.json`; `recordResult` reads the caller's result file; the report's Results section re-reads each `task.resultPath` (src/state.ts:52-61, src/orchestrator/lifecycle-operations.ts:428-435, src/orchestrator/migration-operations.ts:30-38, src/orchestrator/report.ts:161-169).

Example `state.json` skeleton as `plan` writes it (src/orchestrator/lifecycle-operations.ts:86-152):

```json
{
  "schemaVersion": 1,
  "id": "architecture-review-20260703T120000Z-a1b2c3",
  "createdAt": "…", "updatedAt": "…", "cwd": "/repo",
  "workflow": { "id": "…", "title": "…", "summary": "", "limits": {}, "app": {} },
  "inputs": {}, "loopStage": "interpret",
  "phases": [{ "id": "…", "name": "…", "status": "pending", "taskIds": [] }],
  "tasks": [], "dispatches": [], "commits": [], "paths": {}, "nodes": [],
  "contracts": [], "feedback": [],
  "audit": { "schemaVersion": 1, "eventLogPath": "…", "summaryPath": "…", "indexPath": "…" },
  "workers": [], "sandboxProfiles": [], "candidates": [], "candidateSelections": [],
  "multiAgent": { "schemaVersion": 1, "runs": [], "roles": [], "groups": [], "memberships": [], "fanouts": [], "fanins": [] },
  "blackboard": { "schemaVersion": 1, "boards": [], "topics": [], "messages": [], "contexts": [], "artifacts": [], "snapshots": [], "decisions": [] },
  "topologies": { "schemaVersion": 1, "runs": [] }
}
```

## Invariants and error behavior

- **Persist pattern.** Every mutating domain op calls the underlying impl with `{ persist: false }`, then `writeReport(run)`, then `saveCheckpoint(run)` — report before checkpoint, exactly once per call. Read-only ops never write (with two named exceptions: `summaryShow` and `multiAgentReasoning --refresh` checkpoint, and `hostMultiAgentStatus` writes the report but not the checkpoint) (src/orchestrator/candidate-operations.ts:61-63 and all sibling modules; src/orchestrator.ts:445-474, src/orchestrator/host-operations.ts:16-19).
- **`metricsShow` never mutates.** It is derived from durable state so the same read gives the same report; `args.now` may be injected for replay (src/orchestrator.ts:476-486).
- **Deferred persistence.** `dispatch`, `recordWorkerOutput`, and `recordWorkerFailure` accept `options.persistState === false` (concurrent-round callers only, never from an arg bag) which skips `commitState`/`saveCheckpoint`/`writeReport` on every branch, success or error (src/orchestrator/lifecycle-operations.ts:204-251, 369-397, 406-425).
- **Fail closed on system dirs.** `initApp` refuses a destination under `/(etc|bin|sbin|usr|Library|System|Applications|boot|dev|proc|sys|root|var/log|var/run)/`; `recordResult` refuses a result path under the same set (src/orchestrator/app-operations.ts:177-180, src/orchestrator/lifecycle-operations.ts:263-265).
- **Fail closed on evidence.** `recordResult` rejects a result whose file evidence does not resolve on disk against `[run.cwd, process.cwd(), run.paths.runDir, dirname(resultPath)]` (src/orchestrator/lifecycle-operations.ts:274-277).
- **Result intake order** (`recordResult`): `assertTaskCanComplete` → system-dir check → exists check → parse envelope (`loopStage="observe"`) → validate envelope (`loopStage="adjust"`) → evidence check → copy into `results/` → mark task `completed` → append result node → empty-capture audit event → `updatePhaseStatuses` → `validateRunGates` → verifier pipeline stage → `commitState("result:<taskId>")` → `writeReport` → `saveCheckpoint`. ANY error records feedback with source `verifier` (with task/dispatch/node context), writes the report, and re-throws — the state file is NOT checkpointed on the error path (src/orchestrator/lifecycle-operations.ts:253-357).
- **Empty capture is surfaced, never silent.** A result with no findings/evidence gets node metadata `captureWarning: "no findings or evidence captured from result.md"` plus a `worker.capture-warning` trust-audit event (src/orchestrator/lifecycle-operations.ts:306-322).
- **Dispatch sandbox failure parks the run.** A `SandboxProfileError` in `dispatch` sets `loopStage="adjust"`, records feedback with source `cli` (non-retryable, with the sandbox profile id in metadata), persists, and re-throws (src/orchestrator/lifecycle-operations.ts:228-250).
- **Commit gating.** `commit` sets `loopStage="checkpoint"`; `verifierGated = hasGateOption || !allowUnverifiedCheckpoint` where the gate options are `--verifier`/`--verifier-node`/`--candidate`/`--selection` and the escape is `--allow-unverified-checkpoint` (camel or dashed). On BOTH success and failure it writes the report and checkpoint (the gate result must be durable); success also runs `maybeCompactRun` (src/orchestrator/lifecycle-operations.ts:437-461).
- **Attested-only telemetry.** `recordResult`/`recordWorkerOutput` record caller-supplied usage verbatim as provenance and never make it up; absent means `unreported`. `recordWorkerOutput` forwards `options.requireAttestedTelemetry === true` so an unattested hop parks fail-closed; the default is flag-and-surface (src/orchestrator/lifecycle-operations.ts:256-258, 362-371).
- **Plan input rules.** Required inputs must be present (`Missing required input --<name>`); optional inputs fold to their declared default (or `""`) so a `{{name}}` placeholder never leaks into a prompt; `--arg key=value` pairs unpack into inputs; `repo` aliases to `cwd`; a caller-injected `options.runId` fixes the child run id and is stripped from `inputs` (src/orchestrator/lifecycle-operations.ts:62-84, 465-488).
- **Audit decision routing.** `recordAuditDecision` picks the check by `--kind` or infers it: `--command` → `sandbox.command`, `--network` → `sandbox.network`, `--env` → `sandbox.env`, else `sandbox.path`. A denied decision ALSO records a non-retryable worker failure (feedback ids folded into the audit event); allowed/denied is recorded either way, then report + checkpoint (src/orchestrator/audit-operations.ts:134-200, src/orchestrator/cli-options.ts:252-257).
- **Duplicate app ids are an error, deterministically.** App records are sorted by id then source path before the duplicate check, so the two paths named in the error are stable (src/orchestrator/app-operations.ts:41-62).
- **`parseArgv` never lets a flag eat a flag.** A valueless `--flag` (or `-f`) stays `true` when the next token starts with `-`; the only ways to pass a dash-leading value are `--key=-value` and after `--` (src/orchestrator.ts:826-835).
- **Atomic state writes.** `saveCheckpoint` stamps `updatedAt` and writes `state.json` durably under a file lock, so concurrent processes never lose an update (src/state.ts:84-91 — one level out, relied on by every persisting op here).

## Edge cases

- **Loop expansion is bounded and single-step.** `maybeExpandLoop` (run inside `recordWorkerOutput`) acts only when the just-finished phase is the LATEST round of a not-done loop and every task in the round is `completed`. It expands at most ONE loop boundary per call. Stop conditions: the predicate says done, OR round >= `maxRounds` (fail-closed cap), OR the predicate ref is not registered (stops with the fail-closed reason string). Each boundary writes exactly one `loop-control` node under a deterministic id — the replay source of truth. `budget-target` loops stop when recorded (attested-only) tokens reach the target (src/orchestrator/lifecycle-operations.ts:490-604).
- **Round tasks are cloned from round 1.** New tasks copy kind/prompt/evidence/sandbox/label/model/agentType/schema from the ORIGIN phase's tasks, get empty `taskPath`/`resultPath`, then `writeTaskFiles` + a plan-stage pipeline node per task mirrors `plan()` (src/orchestrator/lifecycle-operations.ts:552-602).
- **Reentrant request cache.** A nested `loadWithCache` (a concurrent drive round whose sub-workflow task drives a child run on the SAME runner) restores the outer cache instead of clearing to `undefined`; otherwise the outer round's un-persisted mutations would be lost to a stale disk read (src/orchestrator.ts:81-101).
- **`initApp` writes before it validates.** The manifest and entrypoint are written first; if the generated app fails validation the call throws `Generated workflow app is invalid` but the files stay on disk (src/orchestrator/app-operations.ts:186-193).
- **`migrationProve` tolerates a read-only target.** The proof write is wrapped in try/catch; the proof is still returned when the directory cannot be written (src/orchestrator/migration-operations.ts:21-27).
- **`loadWorkflowAppTarget` fallback chain.** An existing directory loads `<dir>/app.json`; an existing file named `app.json` or ending `.json` loads as a manifest; any other existing file loads as an entrypoint; a non-existing target falls back to an id lookup (src/orchestrator/app-operations.ts:72-81).
- **`parseCriteria` extras.** Criteria come from a structured object, repeated `--criterion name=value`, `--score`, or bare `--total <n>` (as `criteria.total`); no criteria at all throws (src/orchestrator/cli-options.ts:202-222).
- **`parseSandboxChoices` default key.** A bare `--sandbox <id>` with no per-task choices becomes `{ "default": "<id>" }` (src/orchestrator/cli-options.ts:187-200).
- **`withoutHostRunKeys`** strips the host-run/topology keys from a plan arg bag and then merges a structured `inputs` record on top (src/orchestrator/cli-options.ts:108-138).
- **Old state migrates on read.** `loadRun` goes through the state migration in dry-run form; an `unsupported` state throws `Unsupported CW run state: …`. `checkState --write` is the only path in this subsystem that persists a migration (src/state.ts:52-82, src/orchestrator/lifecycle-operations.ts:428-435).
- **`coordinatorSummary` is an alias body.** It calls the same `maOps.blackboardSummary` as `blackboardSummary` — two registered names, one behavior (src/orchestrator.ts:689-695).
- **`checkState` bypasses `loadRun`.** It resolves its own path from `options.cwd`/`options.state` and does not use `baseDir` (src/orchestrator/lifecycle-operations.ts:428-435).
- **Run-id sequence.** `createRunId` uses `process.pid` + a module-level counter, so two `plan()` calls in one process in the same second still differ (src/orchestrator/lifecycle-operations.ts:666-689).
- **`suggestCommand` short-input guard.** Inputs under 2 chars never get a guess; the threshold (`<= 3` and `<= length/2`) avoids wild guesses (src/orchestrator.ts:875-887).
- **`formatHelp` layout is parity-load-bearing.** The 2-space command lines are parsed by the parity help-token check; the 4-space note line and the pipe-joined wrap (76 cols) exist so nothing bogus registers as a command token (src/orchestrator.ts:942-951, 977-979).

## Evidence

Every claim above carries an inline `file:line` pointer relative to `plugins/cool-workflow/`. Primary anchors:

- Facade contract and the one forward: src/orchestrator.ts:42-59, 319-325.
- Constructor/base-dir/cache/loadRun: src/orchestrator.ts:60-109, 766-786, 1018-1027.
- Method table: src/orchestrator.ts:111-764 (line per method listed in the surface JSON).
- `parseArgv`/`KNOWN_COMMANDS`/`suggestCommand`/formatters: src/orchestrator.ts:789-1016.
- Plan/dispatch/result/commit/loop engine: src/orchestrator/lifecycle-operations.ts:62-689.
- Report bytes and `RunSummary`: src/orchestrator/report.ts:24-397.
- Option coercers and their errors: src/orchestrator/cli-options.ts:17-271.
- Domain modules: src/orchestrator/app-operations.ts:22-225, audit-operations.ts:30-200, candidate-operations.ts:20-119, collaboration-operations.ts:27-134, feedback-operations.ts:8-48, host-operations.ts:9-47, migration-operations.ts:9-38, multi-agent-operations.ts:22-336, topology-operations.ts:9-51.
- One level out (relied on): src/state.ts:10-91, 114-121 (`createRunPaths`, `ensureRunDirs`, `loadRunFromCwd`, `saveCheckpoint`, `readJson`).
- Contract doc: docs/cli-mcp-parity.7.md (parity gate; `--json` payload = MCP payload for `payloadIdentical` capabilities).

## Pinned by tests

- `test/cli-arg-parsing-smoke.js` — `parseArgv` no-swallow rule, `--key=-value`, `--` end-of-options, short-alias map.
- `test/cli-mcp-parity-smoke.js` — `formatHelp` token lines vs the capability registry; the facade's CLI<->MCP method parity.
- `test/cw-help-per-command-smoke.js` — `cw help <verb>` rows from the registry; `cw <verb> --help` byte-equal alias; soft unknown-verb text.
- `test/cli-command-surface-smoke.js` — the CLI surface must keep `parseArgv(`-based parsing.
- `test/parse-hardening-round2-smoke.js` — `new CoolWorkflowRunner({ pluginRoot })` and `withBaseDir(tmp)` construction paths.
- `test/collaboration-ops-unit-smoke.js` — `dist/orchestrator/collaboration-operations` unit behavior incl. `reviewStatus` with injected `now` and the format helpers.
- `test/feedback-ops-unit-smoke.js` — `dist/orchestrator/feedback-operations` unit behavior.
- `test/loop-bounded-expansion-smoke.js` — bounded loop expansion + `loop-control` nodes.
- `test/budget-scaling-loop-smoke.js` — `budget-target` loop stop.
- `test/deferred-checkpoint-batching-smoke.js` — `persistState:false` deferred flush.
- `test/det-ids-b-smoke.js` — deterministic entity-id minting across fresh runs.
- `test/concurrent-workflow-dsl-smoke.js`, `test/concurrent-failure-semantics-smoke.js`, `test/concurrent-subworkflow-cache-nesting-smoke.js` — concurrent rounds and the reentrant request cache.
- `test/end-to-end-golden-path-smoke.js`, `test/quickstart-smoke.js` — plan→dispatch→result→report through the facade.
- `test/mcp-tool-call-coverage-smoke.js` — every MCP tool reaches its runner method.
- `test/telemetry-attestation-smoke.js`, `test/telemetry-fail-closed-smoke.js`, `test/telemetry-ledger-smoke.js`, `test/telemetry-attest-wrap-smoke.js` — attestation lines in the report and the fail-closed park.
- `test/tamper-evidence-demo-smoke.js` — the TAMPER DETECTED report line.
- `test/incremental-resume-smoke.js`, `test/run-resume-drive-smoke.js`, `test/run-export-*.js` — state load/migrate round trips through `loadRun`.

## Rebuild risks

1. **Shrinking the facade.** A rebuilder will want to collapse the 141 methods or merge the CLI and MCP surfaces. Both are documented anti-goals; the parity gate fails closed on any drift, and `collaborationReject` must stay a registered method even though it only forwards (src/orchestrator.ts:42-59).
2. **`parseArgv` flag-value rules.** The "a flag's value is never another flag" rule, the `--key=-value` and `--` escapes, the short-alias map, and repeated-key→array are all pinned; getting any one wrong silently drops user flags (src/orchestrator.ts:789-837, test/cli-arg-parsing-smoke.js).
3. **Persist order and the error paths.** Report-then-checkpoint on success; on `recordResult` failure the report is written but the checkpoint is NOT; on `commit` failure BOTH are written. Mixing these up changes what survives a crash (src/orchestrator/lifecycle-operations.ts:337-357, 456-460).
4. **Byte-exact report and help text.** `report.md` section headers, fallback lines, commit-row format, and the `formatHelp` 2-space/4-space indent rules are parsed by other tooling (parity help-token check, report bundles). Any reflow breaks them (src/orchestrator/report.ts, src/orchestrator.ts:931-981).
5. **Deterministic ids.** Run ids, node ids (`<runId>:task:<id>` etc.), loop-round ids (`@r<n>`), and commit reasons are replay keys; a new naming scheme breaks replay and eval comparison (src/orchestrator/lifecycle-operations.ts:167-199, 538-581, 666-689).
6. **The request cache must be reentrant and scoped.** Clearing it to `undefined` on nested exit (instead of restoring the outer map) loses in-flight mutations; leaking it across requests serves stale runs (src/orchestrator.ts:81-101).
7. **`persistState:false` is internal-only.** It must never be reachable from a CLI/MCP arg bag; exposing it would let a caller skip the durable write that every other invariant assumes (src/orchestrator/lifecycle-operations.ts:204-209).
8. **Fail-closed guards look optional but are not.** System-dir refusals, evidence-resolution refusal, the loop `maxRounds` cap, the unregistered-predicate stop, and the sandbox-error park are the safety floor; a rebuild that "simplifies" them passes bad results silently (src/orchestrator/lifecycle-operations.ts:263-277, 499-535, src/orchestrator/app-operations.ts:177-180).
