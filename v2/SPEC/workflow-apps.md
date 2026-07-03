# workflow-apps

## Scope

This file covers the workflow app model: the authoring API (`src/workflow-api.ts`), the app framework — load, check, sum up, templates (`src/workflow-app-framework.ts`), the shared capability core with the `quickstart` wrapper (`src/capability-core.ts`), the CLI/MCP capability registry (`src/capability-registry.ts`), app discovery and the `app` verbs (`src/orchestrator/app-operations.ts`, one level out), the eight shipped apps under `apps/`, and the two legacy files under `workflows/`.

## Public surface

### Authoring API (`src/workflow-api.ts`)

All are exported functions. App entry files get them as one object argument (a "factory" call); library users can `require` them from `dist/workflow-app-framework`.

- `workflow(definition)` — takes an object with at least `id`, `title`, `phases`. Gives back a full `WorkflowDefinition` with defaults folded in: `limits` defaults to `{ maxAgents: 20, maxConcurrentAgents: 4 }` (given fields win), `inputs` defaults to `[]`, `summary` defaults to `""`. Throws on a missing `id`/`title` or a non-array `phases`. (src/workflow-api.ts:9-23)
- `phase(name, tasks, options)` — gives back `{ id: slugify(name), name, status: "pending", tasks, ...options }`. Throws when `name` is empty or `tasks` is not an array. (src/workflow-api.ts:25-35)
- `parallel(name, tasks, options)` — sugar over `phase()` that sets `mode: "parallel"`. The drive loop then runs the phase's tasks as one batch, up to `limits.maxConcurrentAgents` at a time. A plain `phase()` stays sequential. (src/workflow-api.ts:37-43)
- `loop(name, tasks, spec, options)` — sugar over `phase()` that sets `loop: { maxRounds, until }`. `spec.maxRounds` must be a number >= 1 (floored); `spec.until` must be `{ kind: "predicate", ref }` with a non-empty `ref`, or `{ kind: "budget-target", target }` with `target > 0`. Throws otherwise. (src/workflow-api.ts:49-66)
- `agent(id, prompt, options)` — a task of kind `"agent"`. (src/workflow-api.ts:81-83)
- `artifact(id, prompt, options)` — a task of kind `"artifact"`. (src/workflow-api.ts:101-103)
- `subWorkflow(id, appId, options)` — a task of kind `"agent"` with a `subWorkflow: { appId, inputs?, bindResult? }` field. When no `prompt` option is given, the prompt is `Delegate to sub-workflow app: ${appId}`. Throws `subWorkflow task ${id} requires an appId` when `appId` is empty. `bindResult` is `"report"` or `"verdict-result"`. (src/workflow-api.ts:88-99, src/types/workflow-app.ts:52-62)
- `input(name, options)` — gives back `{ name, ...options }`; throws `input name is required` on an empty name. (src/workflow-api.ts:105-111)
- `createWorkflowApi()` — gives back `{ workflow, phase, parallel, loop, agent, artifact, subWorkflow, input }`. (src/workflow-api.ts:68-79)
- `slugify(value)` — trim, lower-case, turn runs of non `[a-z0-9]` into `-`, strip a leading/trailing `-`, fold `--`+ into `-`. (src/workflow-api.ts:130-137)
- Task building (`task()` inside): gives back `{ id, kind, prompt, status: "pending", sandboxProfileId, ...options }`. A string `sandboxProfile` option is taken as `sandboxProfileId` when `sandboxProfileId` is not a string. Throws `${kind} task id is required` / `${kind} task ${id} prompt is required`. (src/workflow-api.ts:113-128)

Task options carried through the plan: `requiresEvidence`, `sandboxProfileId`, `label`, `model`, `agentType`, `schema`, `resultCache` (`{ mode?: "read-write", keyInput, includeCompletedResults?: "previous-phases" }`), `subWorkflow`. (src/types/workflow-app.ts:22-71)

### App framework (`src/workflow-app-framework.ts`)

- `defineWorkflowApp(definition)` — checks the app in place (with `appPath: "inline"`) and gives it back; throws `WorkflowAppValidationError` when not valid. (src/workflow-app-framework.ts:52-55)
- `validateWorkflowApp(candidate, { appPath?, loadedWorkflow? })` — gives back `{ valid, appId?, appPath?, issues: [{ code, message, path? }] }`. Never throws. (src/workflow-app-framework.ts:57-110)
- `assertValidWorkflowApp(candidate, options)` — throws `WorkflowAppValidationError` (name `"WorkflowAppValidationError"`, message `Invalid workflow app: <issue messages joined by "; ">`, field `issues`). (src/workflow-app-framework.ts:42-50, 112-120)
- `validateWorkflowDefinition(candidate, issues, basePath, options)` — checks a bare workflow definition; used inside app checks. (src/workflow-app-framework.ts:122-151)
- `loadWorkflowAppFromEntrypoint(file, { exportName?, sourceKind? })` — `require()`s the file. If the export is a function, it is called with `{ ...createWorkflowApi(), defineWorkflowApp }`. The export (or its return) must be a workflow app, a workflow definition, or a factory. A bare workflow definition is wrapped by `createLegacyWorkflowApp` and marked `legacy: true`. Gives back `{ app, source, legacy }`. (src/workflow-app-framework.ts:153-175, 332-369)
- `loadWorkflowAppFromManifest(manifestPath)` — reads and JSON-parses the manifest, checks it, requires `workflow` to be an entrypoint object, resolves `entrypoint` against the manifest directory, loads the entrypoint, checks that an entrypoint-exported app matches the manifest on `schemaVersion`, `id`, `title`, `version`, then checks the joined app. `source.kind` is `"app-directory"` when the manifest file name is `app.json`, else `"app-manifest"`. (src/workflow-app-framework.ts:177-228)
- `summarizeWorkflowApp(record)` — gives back a `WorkflowAppSummary`: `{ id, title, summary, version, author, file, sourceKind, legacy, compatible, inputs, sandboxProfiles, phases: [{ id, name, taskCount }], taskCount }`. `file` prefers `entrypointPath`, then `manifestPath`, then `path`. `compatible` is true when re-checking the app makes no issue with code `workflow-app-incompatible`. (src/workflow-app-framework.ts:230-253, 685-687)
- `workflowAppRunMetadata(record)` — the short app record kept in run state: `{ schemaVersion, id, title, summary, version, author, compatibility, sandboxProfiles, source, metadata }`. (src/workflow-app-framework.ts:255-268)
- `createLegacyWorkflowApp(workflowDefinition, source)` — wraps a bare workflow: `version: "0.0.0"`, `compatibility: { maxVersion: CURRENT_COOL_WORKFLOW_VERSION, notes: "Compatibility wrapper for legacy .workflow.js factory files." }`, `metadata: { legacyWorkflow: true, sourcePath }`, `sandboxProfiles` from the workflow or the sorted set of task `sandboxProfileId`s. (src/workflow-app-framework.ts:270-292, 689-697)
- `renderWorkflowAppTemplate(id, title)`, `renderWorkflowAppManifestTemplate(id, title)`, `renderWorkflowAppEntrypointTemplate(id, title)` — the scaffolding text used by `app init`. The manifest template has `version: "0.1.0"`, `author: "COOLWHITE LLC"`, one required `question` input, `sandboxProfiles: ["readonly"]`, `compatibility: { minVersion: "0.1.9" }`, `workflow: { entrypoint: "workflow.js" }`. The entrypoint template is a factory with Map/Assess/Synthesize phases. (src/workflow-app-framework.ts:294-330)
- Constants (one level out): `WORKFLOW_APP_SCHEMA_VERSION = 1`, `CURRENT_COOL_WORKFLOW_VERSION = "0.1.98"`. (src/version.ts:1-2)

### App discovery and `app` verbs (`src/orchestrator/app-operations.ts`)

- Discovery reads two roots under the plugin root: `workflows/*.workflow.js` (sorted file names) and `apps/<dir>/app.json` (sorted). Both lists join and sort by app id, then by source path. Two records with the same app id throw: `Duplicate workflow app id ${id}: <pathA> and <pathB>`. (src/orchestrator/app-operations.ts:22-62, src/orchestrator.ts:76-77)
- `listWorkflows` (CLI `cw list`, MCP `cw_list`) — array of `{ id, title, summary, file }` over all discovered apps. (src/orchestrator/app-operations.ts:83-93)
- `listApps` (CLI `cw app list`, MCP `cw_app_list`; also feeds `cw search`) — array of `WorkflowAppSummary`. (src/orchestrator/app-operations.ts:95-97)
- `showApp` (CLI `cw app show <id>` and `cw info <id>`, MCP `cw_app_show`) — the summary plus `source`, an `app` block (schemaVersion, id, title, summary, version, author, inputs, sandboxProfiles, compatibility, metadata) and a `workflow` block (id, title, summary, limits, inputs, sandboxProfiles, phases with per-task `{ id, kind, requiresEvidence, sandboxProfileId }`). Throws `Workflow app not found: ${appId}` for an unknown id. (src/orchestrator/app-operations.ts:64-68, 99-137)
- `validateApp` (CLI `cw app validate <path-or-id>`, MCP `cw_app_validate`) — loads by path (directory → its `app.json`; `*.json` → manifest; other file → entrypoint) or falls back to id lookup; gives back the validation result plus `summary` on success, or `{ valid: false, appId: <target>, appPath: <resolved>, issues }` on a load error. CLI exit code is 1 when `valid` is false. (src/orchestrator/app-operations.ts:70-81, 141-160; src/cli/command-surface.ts:193-198)
- `initApp` (CLI `cw app init <id> [--title T] [--directory|--output D] [--force]`, MCP `cw_app_init`) — slugifies the id (empty → throw `App id must include at least one letter or digit`), writes `app.json` + `workflow.js` from the templates into `apps/<id>` (or the given directory), refuses system directories and existing files without `--force`, then re-checks the made app (throws `Generated workflow app is invalid` when not valid). Gives back `{ id, manifestPath, entrypointPath }`. (src/orchestrator/app-operations.ts:164-194)
- `packageApp` (CLI `cw app package <id> [--output P]`, MCP `cw_app_package`) — writes `{ schemaVersion: 1, app: <run metadata>, workflow, packagedAt: <ISO> }` to `.cw/packages/<id>-<version>.cwapp.json` by default. Gives back `{ id, version, path }`. (src/orchestrator/app-operations.ts:197-216)
- `plan` resolves an app by id via the same discovery (`runner.plan` → `loadWorkflowAppById`). (src/orchestrator.ts:153-155, 785-786)

### Plan-time input behavior (one level out, `src/orchestrator/lifecycle-operations.ts`)

- `--arg key=value` pairs fold into inputs; `repo` copies to `cwd` when `cwd` is not set. (src/orchestrator/lifecycle-operations.ts:465-480)
- A missing required input throws `Missing required input --${input.name}`. (src/orchestrator/lifecycle-operations.ts:482-488)
- Missing optional inputs are folded to the declared `default` or `""`, so a prompt never keeps a raw `{{name}}` placeholder. (src/orchestrator/lifecycle-operations.ts:68-71)
- Prompt rendering: `{{repo}}`, `{{question}}` are string-replaced; `{{invariant}}` gets the repeated values joined by `"; "`; then every input key `{{key}}` is replaced (arrays joined by `"; "`). (src/orchestrator/lifecycle-operations.ts:642-655)
- Run state keeps the app record at `state.json.workflow.app` (from `workflowAppRunMetadata`). (src/orchestrator/lifecycle-operations.ts:90-98)

### Shared capability core (`src/capability-core.ts`, app-related entries)

- `planSummary(runner, workflowId, options)` — plans a run and gives back `{ runId, workflowId, statePath, reportPath, pendingTasks }`. Backs `cw plan` and `cw_plan`. (src/capability-core.ts:68-81)
- `appRun(runner, args)` — takes `appId` (or `workflowId`), an `inputs` object, and an optional sandbox choice (`sandbox`/`sandboxProfile`/`sandboxProfileId`/`profileId`). Plans the run and gives back `{ runId, workflowId, appId, appVersion, statePath, reportPath, pendingTasks, operatorStatus, nextActions, sandboxProfileId, sandboxProfile }`. Backs `cw app run` and `cw_app_run`. (src/capability-core.ts:86-107, 1156-1166)
- `QUICKSTART_DEFAULT_APP = "architecture-review"`. (src/capability-core.ts:628)
- `quickstart(runner, args)` — the one-command path: plan(app) → `run --drive` → write report. CLI-only (`cw quickstart`, alias `cw audit-run`, shortcut `-q "question"`). App id comes from `appId|app|workflowId` or the default. Modes:
  - `--check` — read-only preflight, no writes. Local checks: `app`, `repo`, `repo-state`, `question`, `agent`, and `bundle-trust-key` when `--bundle` is set. Remote (`--link` or URL `--repo`) checks: `app`, `link`, `tooling`, `question`, `agent` — no fetch. (src/capability-core.ts:683-687, 841-1004)
  - `--preview` — plans a fresh run (or takes `--run <id>`) and gives back a read-only `DrivePreview`. (src/capability-core.ts:710-723)
  - default — drives to the end; `--once` advances one step; `--resume` without `--run` advances one step and prints a continue line, with `--run <id>` continues that run. (src/capability-core.ts:704-731)
  - `--link <url>` (or a URL in `--repo`) — the remote is turned into a local checkout before any plan; `sourceUrl`/`sourceCommit`/`sourceRef` become plan inputs; a `source.clone`/`source.download` trust-audit event is recorded best-effort. (src/capability-core.ts:669-702, 749-762)
  - `--bundle` — only after `status === "complete"`, seals the run via `reportBundle` (export + offline self-verify). Output paths resolve against the caller's cwd. On a not-complete run nothing is sealed and the hint says so. (src/capability-core.ts:764-790, 806-809)
  - With no `--repo`/`--cwd`/`--link`, the repo defaults to the caller's cwd. (src/capability-core.ts:677-681)
  - The report is always (re)written, even when the drive blocked or parked; the run's own repo is resolved from `statePath` (`<repo>/.cw/runs/<id>/state.json` → three directories up). (src/capability-core.ts:733-743)
- `collectRunFindings(runner, runId, baseDir?)` — best-effort compact findings rows re-parsed from each completed worker's `result.md` `cw:result` block; feeds the stderr run summary only. (src/capability-core.ts:646-665)
- CLI wiring: the question is asked on a TTY when `--question` is missing (`Question: ` on stderr); `--check` with `ok: false` and a `--bundle` result with `bundle.ok === false` both set exit code 1. (src/cli/command-surface.ts:212-249, 434-445)
- Vendor shorthand flags map to `--agent-command`: `-claude` → `builtin:claude`, `-codex` → `builtin:codex`, `-gemini` → `builtin:gemini`, `-deepseek` → `builtin:deepseek`. `-dir`/`--dir`/`-d` is an alias for `--repo` (explicit `--repo` wins). (src/cli/command-surface.ts:58-65)

### Capability registry (`src/capability-registry.ts`)

- `CAPABILITY_REGISTRY` — a static, read-only array of `CapabilityDescriptor` rows, deduped by capability id (last row wins). 209 rows at this version. Each row: `capability` (dot-namespaced id), `summary`, `entry` (the ONE shared core function), `surface` (`"both" | "cli-only" | "mcp-only"`), optional `cli: { path, caseTokens?, jsonMode }`, optional `mcp: { tool, requiredArgs? }`, optional `payloadIdentical`, optional `reason`. (src/capability-registry.ts:60-74, 126-594)
- `jsonMode` values: `"default"` (always prints canonical JSON), `"flag"` (human text; JSON under `--json`/`--format json`), `"human"` (no canonical JSON). (src/capability-registry.ts:28-31)
- `requiredArgs` groups are `"keyA|keyB"` strings: at least one key of each group must be present on the MCP call. (src/capability-registry.ts:44-47)
- Derivations: `declaredMcpTools()` (196 tools), `mcpCapabilityForTool`, `mcpCapabilityForId`, `mcpRequiredArgsForTool`, `mcpToolDefinition` (builds the tools/list entry; `inputSchema.additionalProperties` is always `true`; throws `MCP capability not declared: ${capabilityId}` and `MCP capability ${capabilityId} missing input schema properties.`), `declaredCliTokens()`, `declaredCliHelpTokens()` (top-level tokens plus aliases such as `audit-run`; `help` is removed). (src/capability-registry.ts:813-882)
- `requiresReason(cap)` — true when `surface !== "both"` or `payloadIdentical === false`. A reason-less exception is release-blocking. (src/capability-registry.ts:884-889, 995-999)
- Payload probe plan: three named lists — `GLOBAL_PAYLOAD_PROBE_CAPABILITIES` (7), `RUN_PAYLOAD_PROBE_CAPABILITIES` (23), `SCENARIO_PAYLOAD_PROBE_CAPABILITIES` (43) — plus one deferred group (111 entries) with a single shared reason string. `payloadIdenticalCapabilities()` (184) defaults every both-surface, dual-bound capability IN; a capability is out only with BOTH `payloadIdentical: false` AND a non-empty `reason` (fail closed). (src/capability-registry.ts:600-806, 903-916)
- `buildParityReport({ mcpTools, cliTokens, helpTokens? })` — gives back `{ ok, registrySize, missingMcpTools, undeclaredMcpTools, missingCliTokens, undeclaredCliTokens, helpMissingCliTokens, helpUndeclaredCliTokens, reasonlessExceptions, payloadProbeUnclassified, payloadProbeDuplicateClassifications, payloadProbeInvalidClassifications, registryLint }`. `ok` is true only when every list is empty. `lintRegistry` flags duplicate capability ids, duplicate MCP tools, and surface/binding mismatches. (src/capability-registry.ts:951-1032)
- App-scope registry rows: `list`→`cw_list`, `app.list`→`cw_app_list`, `app.show`→`cw_app_show`, `app.validate`→`cw_app_validate`, `app.init`→`cw_app_init`, `app.package`→`cw_app_package`, `app.run`→`cw_app_run` (requiredArgs `["appId"]`), `plan`→`cw_plan` (requiredArgs `["workflowId"]`), and the CLI-only rows `info`, `search`, `quickstart` (caseTokens `["quickstart", "audit-run"]`), each with a recorded `reason`. (src/capability-registry.ts:161-214, 311-316, 503-510)

### Shipped apps (each `apps/<id>/app.json` + `workflow.js`)

All eight use `workflow: { entrypoint: "workflow.js" }` and a factory export. Phase names below flow through `slugify` into phase ids (for example `Inspect PR` → `inspect-pr`).

1. `architecture-review` — v `0.1.98`, minVersion `0.1.30`. Inputs: `repo` (path, required), `question` (string, required), `invariant` (string, repeated), `focus` (default `"the overall architecture"`). `sandboxProfiles: ["readonly"]`. Limits 40/6. Phases: `parallel("Map", …)` with 6 agents (`map:server-api`, `map:web-client`, `map:db-security`, `map:deploy-config`, `map:jobs-operators`, `map:transport-core`), `parallel("Assess", …)` with 6 agents (`assess:security`, `assess:data-correctness`, `assess:failure-modes`, `assess:scale-ops`, `assess:maintainability`, `assess:domain`), `phase("Verify", …)` with 1 agent `verify:p0-p2-risks` (`requiresEvidence: true`), `phase("Verdict", …)` with 1 artifact `verdict:synthesis` (`requiresEvidence: true`). 14 tasks. All tasks `sandboxProfileId: "readonly"`. (apps/architecture-review/workflow.js:25-115)
2. `architecture-review-fast` — v `0.1.98`, minVersion `0.1.79`. Adds inputs `sourceContext` (path, default `""`) and `sourceContextDigest` (string, default `""`); `focus` default is `"the highest-risk runtime and operator paths"`. Limits 12/4. Phases: `parallel("Map")` with `map:runtime-surface`, `map:operator-surface`; `parallel("Assess")` with `assess:risks`, `assess:runtime-speed`; `phase("Verify")` with `verify:p0-p2-risks` (`requiresEvidence: true`); `phase("Verdict")` with artifact `verdict:fast-synthesis` (`requiresEvidence: true`). 6 tasks. Every task carries `label`, `sandboxProfileId: "readonly"`, and `resultCache: { mode: "read-write", keyInput: "sourceContextDigest" }`; Assess/Verify/Verdict add `includeCompletedResults: "previous-phases"`. Model hints come from env `CW_ARCHITECTURE_REVIEW_FAST_MODEL` (Map/Assess) and `CW_ARCHITECTURE_REVIEW_STRONG_MODEL` (Verify/Verdict); an empty env var means no `model` field. Workflow `metadata: { mode: "fast", fullReviewApp: "architecture-review" }`. (apps/architecture-review-fast/workflow.js:1-168)
3. `pr-review-fix-ci` — v `0.1.98`, minVersion `0.1.30`. Inputs: `repo` (required), `pr`, `branch`, `base`, `ci`, `mode`. `sandboxProfiles: ["readonly", "workspace-write"]`. Limits 12/4. Sequential phases: `Inspect PR` (2 agents: `inspect:change-scope`, `inspect:review-surface`), `Inspect CI` (`inspect:ci-failures`), `Diagnose` (`diagnose:root-causes`, evidence), `Fix Plan or Patch` (`patch:review-or-fix`, the ONLY task with `sandboxProfileId: "workspace-write"`), `Verify` (`verify:outcomes`, evidence), `Summary` (artifact `summary:review`, evidence). 8 tasks. (apps/pr-review-fix-ci/workflow.js:30-89)
4. `research-synthesis` — v `0.1.98`, minVersion `0.1.30`. Inputs: `question` (required), `source` (repeated), `scope`, `freshness`. `sandboxProfiles: ["readonly", "locked-down"]`. Limits 12/4. Sequential phases: `Scope` (`scope:claims`, `locked-down`), `Investigate` (`investigate:primary-sources`, `investigate:counterpoints`, both `readonly`), `Cross-check` (`cross-check:evidence`), `Verify` (`verify:claims`, evidence), `Synthesize` (artifact `synthesis:report`, evidence, `locked-down`). 6 tasks. (apps/research-synthesis/workflow.js:23-75)
5. `release-cut` — v `0.1.98`, minVersion `0.1.30`. Inputs: `repo` (required), `version` (required), `previousVersion`, `releaseBranch`, `dryRun` (boolean). `sandboxProfiles: ["readonly", "workspace-write"]`. Limits 12/4. Sequential phases: `Preflight` (`preflight:repo-state`), `Version Audit` (`audit:versions`), `Changelog and Notes` (`notes:update`, `workspace-write`), `Package` (`package:artifacts`, `workspace-write`), `Verify` (`verify:package`, evidence), `Release Verdict` (artifact `verdict:release`, evidence). 6 tasks. (apps/release-cut/workflow.js:27-81)
6. `end-to-end-golden-path` — v `0.1.98`, minVersion `0.1.9`. One input `question` (required). Limits 1/1. One phase `Golden Path` with one agent `golden:path` (`requiresEvidence: true`, `readonly`). The deterministic integration-proof app (`npm run golden-path`). (apps/end-to-end-golden-path/workflow.js:10-32, docs/end-to-end-golden-path.7.md:1-116)
7. `pdca-blackboard-loop` — v `0.1.0`, minVersion `0.1.30`. Inputs: `goal` (required), `repo`, `acceptance`. `sandboxProfiles: ["readonly", "workspace-write"]`. Limits 4/1. Sequential phases: `Plan` (`planner:plan`), `Do` (`builder:build`, evidence, `workspace-write`), `Check` (`auditor:audit`, evidence), `Act` (`planner:next`, evidence). 4 tasks. (apps/pdca-blackboard-loop/workflow.js:18-58)
8. `workflow-app-framework-demo` — v `0.1.0`, minVersion `0.1.9`, title `Workflow App framework Demo`. One input `question` (required). Limits 6/2. Phases: `Inspect` (`inspect:contract`), `Implement` (`implement:change`, `workspace-write`), `Verify` (artifact `verify:evidence`, evidence). 3 tasks. `metadata: { example: true }`. (apps/workflow-app-framework-demo/workflow.js:10-43)

### Legacy workflow files (`workflows/`)

- `workflows/architecture-review.workflow.js` — factory giving a bare workflow with id `legacy-architecture-review`, limits 40/6, inputs `repo` (required), `question` (required), `invariant` (repeated), and the 14-task Map/Assess/Verify/Verdict shape with `legacy-` task-id prefixes. Loaded as `legacy: true`, version `0.0.0`. (workflows/architecture-review.workflow.js:1-84)
- `workflows/research-synthesis.workflow.js` — factory giving id `legacy-research-synthesis`, limits 12/4, inputs `question` (required), `source` (repeated), phases Scope/Investigate/Verify/Synthesize, 5 tasks with `legacy-` prefixes. (workflows/research-synthesis.workflow.js:1-47)
- The public ids `architecture-review` and `research-synthesis` belong to the app directories; the legacy files must keep their `legacy-` ids or discovery throws on the duplicate. (docs/canonical-workflow-apps.7.md:152-162, src/orchestrator/app-operations.ts:51-60)

## Exact outputs

All CLI JSON goes to stdout via `JSON.stringify(value, null, 2)` plus a newline. (src/cli/io.ts:17-19)

`cw list` (one element shown):

```json
[
  {
    "id": "architecture-review",
    "title": "Architecture Review",
    "summary": "Map a repository architecture, assess risks, verify important findings, and synthesize an evidence-backed verdict.",
    "file": "<abs>/apps/architecture-review/workflow.js"
  }
]
```

`cw app list` — array of summaries; the key set and order per element:

```json
{
  "id": "...", "title": "...", "summary": "...", "version": "...",
  "author": "...", "file": "...", "sourceKind": "app-directory",
  "legacy": false, "compatible": true,
  "inputs": [ { "name": "...", "type": "...", "required": true } ],
  "sandboxProfiles": ["readonly"],
  "phases": [ { "id": "map", "name": "Map", "taskCount": 6 } ],
  "taskCount": 14
}
```

(src/workflow-app-framework.ts:233-252)

`cw app validate` failure shape (exit code 1):

```json
{
  "valid": false,
  "appId": "...",
  "appPath": "...",
  "issues": [
    { "code": "workflow-task-duplicate", "message": "Duplicate workflow task id: map:context", "path": "<appPath>.workflow.phases.0.tasks.1.id" }
  ]
}
```

(src/workflow-app-framework.ts:104-109, 725-736; docs/workflow-app-framework.7.md:173-186)

`cw plan <id> …`:

```json
{
  "runId": "...",
  "workflowId": "...",
  "statePath": "<repo>/.cw/runs/<run-id>/state.json",
  "reportPath": "<repo>/.cw/runs/<run-id>/report.md",
  "pendingTasks": 14
}
```

(src/capability-core.ts:68-81)

`cw app run <id>` / `cw_app_run` adds: `appId`, `appVersion`, `operatorStatus` (`{ runId, workflowId, appId, appVersion, loopStage, activePhase, blocked, blockedReasons, pendingTasks, runningTasks, completedTasks, nextActions }`), `nextActions`, `sandboxProfileId`, `sandboxProfile`. (src/capability-core.ts:94-106, 153-168)

`cw app init`:

```json
{ "id": "my-app", "manifestPath": ".../my-app/app.json", "entrypointPath": ".../my-app/workflow.js" }
```

(src/orchestrator/app-operations.ts:193)

`cw app package`:

```json
{ "id": "architecture-review", "version": "0.1.98", "path": "<base>/.cw/packages/architecture-review-0.1.98.cwapp.json" }
```

(src/orchestrator/app-operations.ts:204-215)

`cw quickstart` default result (`QuickstartResult`, keys in this order):

```json
{
  "schemaVersion": 1,
  "appId": "architecture-review",
  "runId": "...",
  "workflowId": "architecture-review",
  "status": "complete",
  "plannedWorkers": 14,
  "completedWorkers": 14,
  "parkedWorkers": 0,
  "commitId": "...",
  "reportPath": "...",
  "statePath": "...",
  "agentConfigured": true,
  "steps": [ { "schemaVersion": 1, "runId": "...", "action": "dispatch", "status": "ok" } ],
  "hint": "..."
}
```

`resumedFrom`, `bundle`, and `remote` keys are present ONLY on their paths, so the default payload stays byte-identical. `status` is one of `"complete" | "parked" | "blocked" | "in-progress"`. (src/capability-core.ts:811-838, src/types/drive.ts:69-112)

Quickstart hint strings, byte-exact:

```text
agent backend not configured — set CW_AGENT_COMMAND (e.g. "claude -p") or pass --agent-command, then re-run. The one command DELEGATES worker execution to YOUR agent; it never executes a model itself.
a worker parked past its retry budget — inspect: cw run show <run-id>
the drive is blocked — inspect: cw run drive <run-id>
one step advanced — continue: cw quickstart <app-id> --run <run-id> --resume
one step advanced (--once) — continue: cw quickstart <app-id> --run <run-id> --once
--bundle skipped: the run did not complete (status=<status>); no bundle was sealed.
```

(src/capability-core.ts:792-809; with `--bundle`, the resume line ends with ` --bundle`)

`cw quickstart --check` result:

```json
{
  "schemaVersion": 1,
  "mode": "check",
  "ok": true,
  "appId": "architecture-review",
  "repo": "/abs/path",
  "checks": [ { "name": "app", "status": "ok", "detail": "Workflow app architecture-review is available." } ],
  "nextCommand": "cw quickstart architecture-review --repo /abs/path --question '...'"
}
```

Check names and byte-exact detail/fix strings (local mode): `app` ok `Workflow app ${appId} is available.` / blocked `Workflow app ${appId} is not available.` with fix ``Run `cw app list` and choose one of the listed app ids.``; `repo` ok `Repository path is readable (${repo}).` / blocked `Repository path is not readable (${repo}).` fix `Pass --repo PATH for a readable repository directory.`; `repo-state` ok `Run state location is writable.` / blocked `Run state location is not writable.` fix `Use a writable repo, fix directory permissions, or pass --repo to a writable checkout.`; `question` ok `Question is set.` / blocked `Question is missing.` fix `Pass --question TEXT.`; `agent` ok `Agent backend is configured.` / blocked `No agent backend is configured.` fix `Pass --agent-command "claude -p", set $CW_AGENT_COMMAND, or use --agent-command builtin:claude.`; `bundle-trust-key` ok `Bundle trust public key is configured.` / blocked (with `--strict-signatures`) `Strict signature verification needs a public trust key.` fix `Pass --with-trust-key PATH or set $CW_AGENT_ATTEST_PUBKEY.` / warn `No public trust key is configured; unsigned or unkeyed bundles may verify with reduced signature proof.` fix `Pass --with-trust-key PATH to embed the public key.`. (src/capability-core.ts:841-947)

Remote check extra names: `link` ok `Remote source is a valid ${kind} URL (${url}).` / blocked `Remote source is not usable: ${reason}.` fix `Pass a git URL (https/ssh/git/file or git@host:repo).`; `tooling` ok `git is available to clone the remote.` / blocked `git was not found on PATH.` fix `Install git, then re-run.`. Its `nextCommand` is `cw quickstart <app> --link <url>[ --question <q>]`. (src/capability-core.ts:953-1003)

`nextCommand` words are shell-quoted only when they do not match `/^[A-Za-z0-9_./:@%+=,-]+$/`; else wrapped in single quotes with `'` turned into `'\''`. (src/capability-core.ts:1006-1022)

`cw quickstart --preview` gives a `DrivePreview`: `{ schemaVersion: 1, runId, workflowId, plannedWorkers, pendingWorkers, completedWorkers, parkedWorkers, nextAction, nextTaskId?, nextPhase?, agentConfigured }`. Byte-stable across two calls. (src/types/drive.ts:138-153)

Report header lines carrying the app identity:

```text
- Workflow App: <id>@<version>
- Workflow App Source: <manifest-or-entrypoint-path>
```

(src/orchestrator/report.ts:41-42)

`cw info <id>` human text (stdout; `--json` gives the `showApp` payload):

```text
cw info <id>
  Title: ...
  Version: ...
  Summary: ...
  Author: ...
  Compatible: yes
  Inputs:
    - repo (path, required) — Repository path to inspect.
  Sandbox: readonly
  Phases: 4 phases, 14 tasks
  Run: cw quickstart <id> --repo . --question "..."
```

(src/orchestrator.ts:899-929)

`cw search <keyword>` human text: header `${n} workflow${s} matching "${keyword}"`, then `  <id> — <title>` with a dimmed summary cut at 120 chars plus `…`; empty result gives `No workflows matched "${keyword}".` plus a tip line. `--json` gives `[{ id, title, summary }]`. Missing keyword throws `Missing search keyword.` plus a tip. (src/orchestrator.ts:889-897, src/cli/command-surface.ts:135-146)

Exit codes: `0` on success. `1` when `app validate` gives `valid: false`; when `quickstart --check` gives `ok: false`; when a `--bundle` result carries `bundle.ok === false`. Thrown errors also end non-zero. (src/cli/command-surface.ts:193-198, 240-248)

## Files on disk

- `apps/<app-id>/app.json` — the app manifest (see any shipped app above for the exact shape). `workflow.entrypoint` must be a relative path with no `..` parts. (src/workflow-app-framework.ts:538-551)
- `apps/<app-id>/workflow.js` — plain CommonJS runtime JavaScript (not TypeScript), loaded with `require()`. (src/workflow-app-framework.ts:338-340)
- `workflows/<name>.workflow.js` — legacy factory files, same loader, wrapped as legacy apps. (src/orchestrator/app-operations.ts:22-29)
- `.cw/packages/<id>-<version>.cwapp.json` — `app package` output: `{ "schemaVersion": 1, "app": { …run metadata… }, "workflow": { …full definition… }, "packagedAt": "<ISO>" }`. (src/orchestrator/app-operations.ts:206-214)
- `<repo>/.cw/runs/<run-id>/state.json` — run state; `workflow.app` holds the `workflowAppRunMetadata` record (id, title, version, compatibility, sandboxProfiles, source, metadata). (src/orchestrator/lifecycle-operations.ts:90-98, docs/workflow-app-framework.7.md:244-248)
- `<repo>/.cw/runs/<run-id>/report.md` — the run report with the `Workflow App:` lines. (src/orchestrator/report.ts:41-42)
- Templates written by `app init`: `app.json` from `renderWorkflowAppManifestTemplate`, `workflow.js` from `renderWorkflowAppEntrypointTemplate`. (src/orchestrator/app-operations.ts:186-188)

## Invariants and error behavior

- App loading fails closed: a broken app throws `WorkflowAppValidationError`; CW never quietly turns a broken app into a workflow that can run. (src/workflow-app-framework.ts:112-120, docs/workflow-app-framework.7.md:161-188)
- `schemaVersion` must be exactly `1` (`workflow-app-schema-version`). App id and workflow id must match `/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/` (`workflow-app-id`, `workflow-id`). `version` must be semver `/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/` (`workflow-app-version`). (src/workflow-app-framework.ts:73-81, 385-403, 713-715)
- Workflow id/title must equal app id/title when both exist (`workflow-app-id-mismatch`, `workflow-app-title-mismatch`). App `inputs`, when present with an inline workflow, must be JSON-equal to `workflow.inputs` (`workflow-app-inputs-mismatch`). (src/workflow-app-framework.ts:138-143, 468-477)
- Limits: `maxAgents` and `maxConcurrentAgents` must be positive integers with `maxConcurrentAgents <= maxAgents` (`workflow-limits`); the total task count must not pass `limits.maxAgents` (message `Workflow defines ${n} tasks but limits.maxAgents is ${m}`). (src/workflow-app-framework.ts:412-428, 576-578)
- Input names must match `/^[A-Za-z][A-Za-z0-9_-]*$/`, be unique, and `type` must be one of `string|number|boolean|path|json`; `required`/`repeated` must be boolean (`workflow-input-*` codes). (src/workflow-app-framework.ts:430-466)
- Sandbox profile references must be non-empty, unique, and one of the bundled ids `default`, `locked-down`, `readonly`, `workspace-write` (`workflow-sandbox-profile-unknown` message lists the bundled ids). A task `sandboxProfileId` must also be listed in the app `sandboxProfiles` when that list exists (`workflow-task-sandbox-profile`). (src/workflow-app-framework.ts:479-506, 654-663; src/sandbox-profile.ts:38-101)
- Phases must be a non-empty array; each phase needs a well-formed unique id (`/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/`), a name, and a non-empty `tasks` array. Task ids match `/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/` and are unique across the whole workflow; `kind` must be `agent` or `artifact`; `prompt` is required; `requiresEvidence` must be boolean. (src/workflow-app-framework.ts:553-663)
- A `loop` phase needs an integer `maxRounds >= 1` and a valid `until` (`workflow-phase-loop*` codes). The predicate need not be registered at check time; a missing predicate stops the loop fail-closed at run time (`loop predicate "<ref>" not registered — stopping fail-closed`). (src/workflow-app-framework.ts:605-623, src/orchestrator/lifecycle-operations.ts:529-535)
- Compatibility gates against the running version: `minVersion` above `0.1.98` or `maxVersion` below it makes the `workflow-app-incompatible` issue (messages `Workflow app requires Cool Workflow >= X; current is Y` / `Workflow app supports Cool Workflow <= X; current is Y`), so the app fails to load and `compatible` reads false. `workflowSchemaVersion`, when set, must be `1`. Semver compare drops pre-release/build parts. (src/workflow-app-framework.ts:508-536, 699-715)
- Manifest errors are typed: missing file → `workflow-app-manifest-not-found`; bad JSON → `workflow-app-manifest-json`; `workflow` not an entrypoint object → `workflow-app-entrypoint`; entrypoint file missing → `workflow-app-entrypoint-not-found`; named export missing → `workflow-app-entrypoint-export`; entrypoint app fields differing from the manifest → `workflow-app-manifest-mismatch`. (src/workflow-app-framework.ts:177-228, 332-383)
- Two sources with one app id stop discovery with `Duplicate workflow app id …` — every `list`/`plan`/`show` then fails, so a duplicate cannot shadow. (src/orchestrator/app-operations.ts:51-60)
- The quickstart delegates worker runs to the operator's agent backend only. With no agent configured the drive is `status: "blocked"` with `agentConfigured: false`; CW never makes up a completion. (src/capability-core.ts:630-639, src/types/drive.ts:83-85)
- `--bundle` seals only a run with `status === "complete"`; the CLI exits 1 when the sealed bundle does not self-verify. (src/capability-core.ts:764-790, src/cli/command-surface.ts:243-248)
- Remote review fails closed before any plan: a bad URL, blocked scheme, or clone failure throws in `materializeRemote`, and `--check` never fetches. (src/capability-core.ts:688-702, 949-957)
- `app init` and `run export` refuse system directories (regex `/^\/(etc|bin|sbin|usr|Library|System|Applications|boot|dev|proc|sys|root|var\/log|var\/run)\//`; messages `Refusing to create app in a system directory: …` / `Refusing to write archive to a system directory: …`). (src/orchestrator/app-operations.ts:176-180, src/capability-core.ts:292-296)
- Parity is fail-closed: a capability live on one surface and absent or undeclared on the other, a reason-less exception, or an unclassified payload-probe capability blocks release. (src/capability-registry.ts:1-24, 995-1015)

## Edge cases

- A factory entrypoint runs at load time with the full API (including `parallel`, `loop`, `subWorkflow`, `defineWorkflowApp`); `exportName` selects a named export first, and a function export is called. Loading uses Node's `require` cache, so a changed file in one process needs a cache drop. (src/workflow-app-framework.ts:332-354)
- A bare workflow export (no app wrapper) still loads: it becomes a legacy app with `version: "0.0.0"` and `legacy: true` in every summary. (src/workflow-app-framework.ts:163-175, 270-292)
- `isWorkflowEntrypoint` treats any object with an `entrypoint` key and no `phases` key as an entrypoint; an object with `phases` is taken as an inline workflow. (src/workflow-app-framework.ts:681-683)
- `architecture-review-fast` reads its two model env vars at module load time (top of `workflow.js`), not per call; an empty or unset var leaves `model` out of the task. (apps/architecture-review-fast/workflow.js:1-2, 153-156)
- `quickstart` with no `--repo`/`--cwd`/`--link` reviews the caller's cwd; cross-directory calls resolve the report against the run's own repo from `statePath`, never against the caller's cwd. (src/capability-core.ts:677-681, 733-743)
- On a TTY, missing `--question` prompts `Question: ` on stderr; non-TTY skips the prompt. (src/cli/command-surface.ts:434-445)
- `-q "question"` as the first token becomes `quickstart` with the question consumed from positionals, so it is never mis-read as an app id. (src/cli/command-surface.ts:86-93)
- Missing optional inputs render as their default or `""` — so `{{focus}}` in `architecture-review` becomes `the overall architecture` when not given, and no literal `{{name}}` leaks into a worker prompt. (src/orchestrator/lifecycle-operations.ts:68-71)
- Repeated inputs (`invariant`, `source`) render joined by `"; "` in prompts. (src/orchestrator/lifecycle-operations.ts:642-655)
- `plan` accepts an injected deterministic `runId` (used by sub-workflow tasks) but strips `runId` from the recorded inputs. (src/orchestrator/lifecycle-operations.ts:74-80)
- Loop expansion appends round phases with ids `<origin>@r<N>` and task ids `<task>@r<N>`, records one `loop-control` node per round boundary, expands at most one loop boundary per accept, and caps at `maxRounds`. `budget-target` loops stop when recorded attested tokens reach the target. (src/orchestrator/lifecycle-operations.ts:499-604)
- `CAPABILITY_REGISTRY` dedupes by id with last-declaration-wins, so there is no load-order registration step that can go dead. (src/capability-registry.ts:588-594)
- `quickstart` result keys `resumedFrom`/`bundle`/`remote` use conditional spread so the default JSON has no `null`/absent-key noise. (src/capability-core.ts:826-838)
- `collectRunFindings` skips a garbled or missing `result.md` and an unloadable run without failing — the stderr summary just loses rows. (src/capability-core.ts:646-665)

## Evidence

Key claims and their anchors (paths relative to `plugins/cool-workflow/`):

- Authoring API defaults and throws: src/workflow-api.ts:9-137
- Framework validation, loaders, templates, legacy wrapper: src/workflow-app-framework.ts:42-330, 332-741
- Version constants: src/version.ts:1-2
- Bundled sandbox profile ids: src/sandbox-profile.ts:35-107
- App discovery, list/show/validate/init/package: src/orchestrator/app-operations.ts:22-225; runner wiring src/orchestrator.ts:62-155, 785-786
- Plan-time input folding + prompt rendering + run-state app metadata: src/orchestrator/lifecycle-operations.ts:62-120, 465-488, 606-655
- Loop expansion mechanism: src/orchestrator/lifecycle-operations.ts:490-604
- planSummary/appRun/quickstart/check/hints: src/capability-core.ts:66-107, 628-1022
- Quickstart/drive result shapes: src/types/drive.ts:12-153
- App/workflow type shapes: src/types/workflow-app.ts:1-209
- Capability registry table, probe plan, parity report: src/capability-registry.ts:26-1033
- CLI dispatch, printJson, exit codes, prompts, aliases: src/cli/command-surface.ts:43-250, 434-445; src/cli/io.ts:1-25
- `cw info` / `cw search` rendering: src/orchestrator.ts:889-929
- Report app header lines: src/orchestrator/report.ts:41-42
- Shipped app contracts: apps/*/app.json and apps/*/workflow.js (all lines; see per-app pointers above)
- Legacy files: workflows/architecture-review.workflow.js:1-84, workflows/research-synthesis.workflow.js:1-47
- Man-page contract: docs/workflow-app-framework.7.md, docs/canonical-workflow-apps.7.md, docs/capability-topology-registry.7.md, docs/end-to-end-golden-path.7.md

## Pinned by tests

- `test/workflow-app-framework-smoke.js` — `cw list` has canonical + legacy + demo ids; canonical plan `pendingTasks`; `state.json.workflow.app.id`/`version` (`0.1.98`); validation failure shapes.
- `test/canonical-workflow-apps-smoke.js` — validates, shows, and plans every canonical app with sample inputs (per-app minVersion table).
- `test/quickstart-smoke.js` — happy path, fail-closed no-agent block, `--preview` byte-stable, default app is `architecture-review`, `audit-run` alias.
- `test/quickstart-check-smoke.js`, `test/quickstart-no-agent-smoke.js`, `test/quickstart-bundle-smoke.js`, `test/quickstart-corpus-smoke.js`, `test/quickstart-readme-path-smoke.js` — `--check` payload/exit, blocked hint, `--bundle` gating and exit 1, corpus review, cross-directory report path.
- `test/cli-mcp-parity-smoke.js`, `test/mcp-surface-registry-smoke.js`, `test/cli-jsonmode-parity-smoke.js`, `test/parity-doc-sync-smoke.js`, `test/cw-help-per-command-smoke.js` — registry vs live CLI/MCP surfaces, jsonMode, help tokens, generated parity doc.
- `test/mcp-app-surface-smoke.js`, `test/mcp-tool-call-coverage-smoke.js` — `cw_app_*` tools over MCP stdio.
- `test/end-to-end-golden-path-smoke.js` (`npm run golden-path`) — the `end-to-end-golden-path` app through plan → dispatch → worker → candidate → verifier-gated commit → report.
- `test/pdca-blackboard-loop-smoke.js` — the PDCA app end to end.
- `test/architecture-review-fast-smoke.js`, `test/architecture-review-fast-phase-cache-smoke.js`, `test/architecture-review-fast-automation-smoke.js` — fast app shape, result-cache keys, wrapper script.
- `test/concurrent-workflow-dsl-smoke.js` — `parallel()` DSL; `test/loop-bounded-expansion-smoke.js`, `test/budget-scaling-loop-smoke.js` — `loop()` expansion + budget-target; `test/sub-workflow-nesting-smoke.js`, `test/concurrent-subworkflow-cache-nesting-smoke.js` — `subWorkflow()` tasks.
- `test/headline-commands-smoke.js`, `test/dogfood-architecture-review-smoke.js` — README headline commands and the default review on a real repo.
- `scripts/parity-check.js --check` (release gate) and `npm run canonical-apps` (scripts/canonical-apps.js) — registry parity and the canonical app matrix.

## Rebuild risks

1. Dropping the fail-closed byte rules of the quickstart payload: `resumedFrom`/`bundle`/`remote` must be ABSENT (not null) on default paths, and the hint strings are exact — tests and operators parse them.
2. Making the capability registry a runtime registration system. It is a static declared table; a self-register step was removed because the snapshot made it silently dead. Rebuild it as data plus a fail-closed parity check, not a dispatcher.
3. Getting `compatible` wrong: it is derived by re-validating and looking ONLY for `workflow-app-incompatible` issues; `minVersion`/`maxVersion` compare against `0.1.98` with pre-release parts cut off. An off-by-one here silently hides or breaks apps.
4. Legacy id shadowing: the legacy `.workflow.js` files load under `legacy-*` ids; giving them the public ids makes discovery throw on duplicates and every `cw list`/`plan` breaks. The duplicate check compares by app id across BOTH roots after a two-key sort.
5. Prompt rendering order and joins: `{{repo}}`/`{{question}}`/`{{invariant}}` are replaced first, then every input key; arrays join with `"; "`; missing optionals fold to `default ?? ""`. A rebuild that leaves `{{name}}` in prompts or joins with `,` changes worker inputs.
6. Validation issue codes and messages are a contract (`workflow-task-duplicate`, `workflow-app-incompatible`, …) with dotted `path` strings built by `joinPath`; tools and tests match on them byte-for-byte.
7. Sandbox checks are three-layer: bundled-id check on app lists, on workflow lists, AND task-vs-app-list containment. Missing the third layer lets a task use a profile the app never declared.
8. `quickstart --check` must stay zero-write and `--preview` read-only + byte-stable; the remote variant must validate URL shape WITHOUT fetching. Any write or fetch in these paths breaks the preflight contract and the parity probes.
