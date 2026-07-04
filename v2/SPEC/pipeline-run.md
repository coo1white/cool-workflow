# pipeline-run

## Scope

This spec covers the step cycle `plan -> dispatch -> result -> verify -> commit`, the `run --drive` loop with `--once` / `--incremental` / `--concurrency`, `subWorkflow` and `loop()` expansion, blocked/park states, and resume-after-interrupt. Files: `src/pipeline-runner.ts`, `src/pipeline-contract.ts`, `src/dispatch.ts`, `src/drive.ts`, `src/commit.ts`, `src/result-normalize.ts`, `src/loop-expansion.ts`, `src/harness.ts`, `src/error-feedback.ts`, plus one level out: `src/state-node.ts`, `src/scheduling.ts`, `src/orchestrator/lifecycle-operations.ts`, `src/capability-core.ts`, `src/types/drive.ts`, `src/types/pipeline.ts`, `src/worker-isolation.ts`.

## Public surface

### Pipeline kernel — `src/pipeline-runner.ts`

- `createPipelineRunner(defaultOptions?: PipelineRunnerOptions)` — makes an object with `getRunContract`, `getRunNode`, `findRunnablePipelineStages`, `runPipelineStage`, `advancePipeline`, `failPipelineStage`. Per-call options are merged over the defaults (`{ ...defaultOptions, ...options }`). (src/pipeline-runner.ts:29-44)
- `getRunContract(run, contractId?)` — gives back the run contract with that id. With no id it uses `"cw.pipeline.default"`. If the run has no contract with the default id, it makes the default contract and puts it on the run (`upsertRunContract`). An unknown non-default id throws `Unknown pipeline contract for run <run-id>: <id>`. A found contract is re-validated with `validatePipelineContract` first. (src/pipeline-runner.ts:46-57)
- `getRunNode(run, nodeId)` — finds a node in `run.nodes` or throws `Unknown state node for run <run-id>: <node-id>`. (src/pipeline-runner.ts:59-63)
- `findRunnablePipelineStages(run, contract?)` — for every node × every stage, keeps the pair only when the node's `kind` is in `stage.acceptedInputKinds`, its `status` is in `stage.acceptedInputStatuses`, all `requiredArtifacts` are present (match by artifact `id` OR `kind`), all `requiredEvidence` is present (match by evidence `id` OR `source`; any evidence-requirement with an empty evidence list fails), and the verifier gate passes. Gives back `RunnablePipelineStage[]` = `{runId, contractId, stageId, inputNodeId, outputKind}`. (src/pipeline-runner.ts:65-85, 264-289)
- `runPipelineStage(run, stageId, inputNodeId, options?)` — the one-step engine. It checks the input node against the contract (`assertNodeSatisfiesContract`), makes the output node with kind `stage.producedOutputKind`, moves it to `options.outputStatus` (default: `"committed"` when the stage output kind is `"commit"`, else `"completed"`), links parent/child, appends both nodes to the run (each node is also written to `nodes/<id>.json`), and persists a checkpoint unless `options.persist === false`. When the target status is `"committed"` the node is first created as `"verified"` then transitioned (any other target starts at `"pending"`). Returns `PipelineStageRunResult` with `status: "advanced"`. A thrown `PipelineContractError` is turned into `failPipelineStage`; any other error re-throws untouched. (src/pipeline-runner.ts:120-178, 259-262, 299-301)
- `advancePipeline(run, options?)` — takes the first runnable stage list; if empty gives `status: "idle"` with `stages: []`. Else runs the runnable pairs in order: the first `"advanced"` result stops with `status: "advanced"`. On a failed result it stops with `status: "failed"` unless `contract.failurePolicy.autoAdvance` is true, in which case it keeps trying the rest and only then reports `"failed"`. (src/pipeline-runner.ts:87-118)
- `failPipelineStage(run, stageId, inputNode, error, options?)` — builds a structured `StateNodeError` (from `PipelineContractError.structured` or `{code:"pipeline-stage-error", message, at, nodeId, retryable}`). Failure-node keeping is decided by `options.preserveFailureNode ?? stage.failure?.preserveFailureNode ?? contract.failurePolicy?.preserveFailureNodes ?? false`. When kept, an error node (kind `stage.failure?.failureKind || "error"`, `metadata.preserved: true`) is linked + appended and one feedback record is written (`source: "pipeline-runner"`); the result has `outputNodeId`. When not kept, no node/feedback is written and `outputNodeId` is `undefined`. Returns `PipelineStageFailure` with `status: "failed"`. `retryable` defaults from `stage.failure?.retryable ?? contract.failurePolicy?.retryableByDefault ?? false`. (src/pipeline-runner.ts:180-250, 295-297, 303-319)

### Default contract — `src/pipeline-contract.ts`

- `DEFAULT_PIPELINE_CONTRACT_ID = "cw.pipeline.default"`. (src/pipeline-contract.ts:3)
- `createDefaultPipelineContract()` — `schemaVersion: 1`, title `"Cool Workflow Default Pipeline"`, six stages (exact accept rules in Exact outputs below): `plan`, `dispatch`, `result`, `verify`, `commit`, `report`. Policies: `artifactPolicy: { root: ".cw/runs/<run-id>", requireReadablePaths: true }`, `evidencePolicy: { highPriorityRequiresEvidence: true }`, `failurePolicy: { preserveFailureNodes: true, retryableByDefault: false }`, `commitPolicy: { requiresVerifierGate: true, acceptedVerifierStatuses: ["verified"] }`, `compatibility: { minSchemaVersion: 1, maxSchemaVersion: 1 }`. (src/pipeline-contract.ts:5-91)

### Dispatch — `src/dispatch.ts`

- `nextDispatchTasks(run, limit?)` — the pending tasks of the first runnable phase, capped at `Number(limit || run.workflow.limits.maxConcurrentAgents || 4)`, mapped through `formatDispatchTask`. (src/dispatch.ts:28-37)
- `createDispatchManifest(run, limit?, options?)` — options: `sandboxProfileId`/`sandbox`, `backendId`, `multiAgentRunId`, `multiAgentGroupId`, `multiAgentRoleId`, `multiAgentFanoutId`. Resolves the sandbox profile (throws on a bad one), persists a custom file-loaded profile definition onto `run.customSandboxProfiles` keyed by its logical id (a different definition under the same id throws `Sandbox profile id collision: "<id>" is already defined by a different custom profile (source: <abs-path>). Use a unique id in each custom profile file.`), and resolves the backend once (`resolveBackendSelection`, default `node`, or `CW_BACKEND` / `--backend`). With no dispatchable task it gives `{schemaVersion:1, runId, dispatchId: null, tasks: [], manifestPath: null, sandboxProfileId, backendId, backendSelection}` and writes nothing. Else it: marks each selected task `status:"running"`, `loopStage:"act"`, sets `dispatchId`/`dispatchedAt`, allocates a worker scope per task, appends one dispatch state node (id `<run-id>:dispatch:<dispatch-id>`, kind `dispatch`, status `running`, artifact `{id:"dispatch", kind:"json", path: manifestPath}`, parents = the task nodes), moves each task's own state node `pending -> running`, pushes a `RunDispatch` record onto `run.dispatches`, refreshes phase statuses, and writes the manifest JSON to `dispatches/<dispatch-id>.json`. (src/dispatch.ts:39-175, 234-264)
- `firstRunnablePhase(run)` — walks phases in order; a phase with a `running` task, or one with a `pending` task, is the runnable phase; a phase not fully `completed` and with nothing pending/running blocks everything after it (`return null`). (src/dispatch.ts:177-185)
- `updatePhaseStatuses(run)` — a phase is `completed` when every task is completed, `running` when some task is running or completed, else `pending`. (src/dispatch.ts:187-198)
- `formatDispatchTask(task)` — projection with `workerDir = dirname(workerManifestPath)` and `workerResultPath = <workerDir>/result.md`. (src/dispatch.ts:200-218)
- Dispatch id: `dispatch-<STAMP>-<seq>` where STAMP is the ISO time with `-`/`:` stripped and sub-second cut (`20260703T101500Z` form) and seq is the 4-digit, per-run position (`0001`...). With env `CW_DETERMINISTIC_RUN_IDS` matching `/^(1|true|yes|on)$/i` the id is just `dispatch-<seq>` (e.g. `dispatch-0001`). (src/dispatch.ts:225-232)

### Drive loop — `src/drive.ts`

- `drive(runner, runId, options?)` -> `DriveResult`. Options: `once`, `now` (injected clock, default `new Date().toISOString()`), `agentConfig` (else resolved from `options.args` by `resolveAgentConfig`: flags > env > `$CW_HOME/agent-config.json`), `policy` (normalized over `DEFAULT_SCHEDULING_POLICY`), `args`, `concurrency` (>1 selects the concurrent round driver), `incremental`, `depth` (sub-workflow nesting, default 0), `visitedAppIds` (cycle path). (src/drive.ts:56-82, 785-794)
- `MAX_SUB_WORKFLOW_DEPTH = 4` and `DRIVE_SCHEMA_VERSION = 1` are exported. (src/drive.ts:54, 85)
- `driveStep(ctx)` — one deterministic step: select the task (a `running` task first, else the next `pending` task of the first runnable phase), then either a terminal/config gate step or `processSelectedTask`. (src/drive.ts:90-95, 146-152)
- `driveConcurrentRound(ctx, limit)` — one concurrent round inside one cached in-memory run (`runner.loadWithCache`, re-entrant). Dispatches each batch task sequentially with `persistState:false`, spawns all spawn-style agent children in one concurrent window (`prepareAgentSpawn` + `runAgentBatchOutcomes`; per-job env is the sandbox-filtered env plus every process env key matching `/^(CW_|ANTHROPIC_|OPENAI_|GEMINI_|DEEPSEEK_|CODEX_|GOOGLE_|COHERE_|MISTRAL_|OLLAMA_|AZURE_|AWS_)/i`), then settles + accepts in deterministic batch order regardless of wall-clock finish order. At round end it flushes once: `commitState(run, "concurrent-round:<n>-tasks")` + `writeReport` + `saveCheckpoint`. Cache-hit tasks and endpoint-only agents get no prepared outcome and settle through the serial path. If no step was produced the round degrades to one `driveStep`. (src/drive.ts:486-604)
- `drivePreview(runner, runId, args?)` -> `DrivePreview` — read-only. `nextAction` is `"commit"` when no task is selectable and all tasks are completed, `"blocked"` when no task is selectable otherwise or the agent is unconfigured, `"dispatch"` for a pending selected task, `"fulfill"` for a running one. (src/drive.ts:927-961)
- Env `CW_DRIVE_PROGRESS` — `0` forces progress lines off, `1` forces them on; default is on only when stderr is a TTY. All progress goes to stderr with prefix `[drive] `; stdout stays data. (src/drive.ts:137-142)

### Drive internals a rebuild must copy

- Terminal/gate logic (`terminalOrConfigStep`): when no task is selectable and every task is `completed`, commit once with reason `"agent-delegation-drive: audited verdict committed"` — verifier-gated on the verdict task's `verifierNodeId` when a completed task id matches `/^verdict[:/]|^synthesis[:/]/i`, else `allowUnverifiedCheckpoint: true`. The step is `action:"commit", status:"complete", reason:"committed <commit-id>"`. If such a commit already exists (any commit whose `reason` starts with `"agent-delegation-drive"`), the step is `action:"complete", status:"complete"`. When no task is selectable but tasks are not all completed the step is `action:"blocked", status:"blocked"`, reason `"no eligible worker (a parked/failed worker blocks the phase gate)"`. (src/drive.ts:157-176, 105-108)
- Token budget: when `run.workflow.limits.tokenBudget` is a number > 0 and `deriveUsageTotals(run).totals.totalTokens >= budget`, the step is blocked with reason `token budget exhausted: <spent> recorded tokens >= budget <budget> — refusing to spawn further agents`. Checked at step/round entry only, never between accepts of one round. (src/drive.ts:186-197, 517)
- Unconfigured agent (no `config.command` and no `config.endpoint`): blocked with reason `"agent backend not configured (set CW_AGENT_COMMAND/CW_AGENT_ENDPOINT or pass --agent-command/--agent-endpoint) — refusing rather than fabricating a completion"`. (src/drive.ts:132-134, 199-207)
- Per-task processing (`processSelectedTask`): a `pending` task is dispatched first (`runner.dispatch(runId, { limit: 1, backend: task.agentType || "agent" })`); a `running` task is a retry on the SAME worker scope (no re-dispatch). Failure reasons: `"dispatch produced no worker scope"`, `"no worker scope for task"` (both `action:"dispatch", status:"failed"`). Then: result-cache check; sub-workflow branch; else spawn through `runBackend` with `backendId: task.agentType || "agent"` and `delegation: {command, args, endpoint, model: task.model || config.model}`. A non-`"completed"` envelope is a failed hop with reason `agent hop <status>: <summary>`. A missing `result.md` is a failed hop with reason `"agent produced no result.md"`. Accept is `runner.recordWorkerOutput(runId, workerId, resultPath, { agentDelegation: {handle, model, promptDigest, command, args, exitCode, reportedUsage, usageSignature, usageTrustPublicKey}, requireAttestedTelemetry })`; a throw becomes a failed hop `result.md rejected: <message>`. On success the step is `action:"accept", status:"ok"` with `backendId:"agent"`, `handleKind`, `reportedModel` (the agent-reported model, or `"unreported"`). (src/drive.ts:251-360)
- Retry/park (`handleHop`): prior attempts = max(in-memory count, the worker scope's persisted `retryCount`). `retryOrPark(entry, policy, now, reason)` adds one attempt; at `attempts >= policy.maxAttempts` (default 3) it parks with `parkedReason` = `<reason> (attempt <n>/<max>)`. Parked: `runner.recordWorkerFailure(runId, workerId, parkedReason, {code:"agent-delegation-parked", retryable:false, retryCount})` — this marks the task `status:"failed"` and the worker `failed`, so the phase gate stops; the step is `action:"park", status:"parked"` with `attempts`. Retryable: the task stays `running` (the scope is reused next step), `recordWorkerRetryAttempt` stores the attempt count + last reason on the worker scope, and the step is `action:"fulfill", status:"failed"`. (src/drive.ts:608-652; src/scheduling.ts:135-142; src/worker-isolation.ts:343-448)
- Loop control in `drive()`: iteration bound `maxIterations = (plannedWorkers + maxLoopExpansion(run0)) * (policy.maxAttempts + 1) + 5`. Round width per iteration: an explicit `concurrency > 1` wins; else `autoWidth` = for a first runnable phase with `mode === "parallel"`, `min(max(1, limits.maxConcurrentAgents || 1), phase.taskIds.length)`, else 1. The loop stops on `--once` after one round, or when the last step status is `"complete"`, `"parked"` or `"blocked"`. If the bound is hit without a terminal state, one extra step `action:"blocked", status:"blocked"` with reason `drive reached max iteration limit (<n>) before a terminal state` is appended and the result status is `"blocked"`. (src/drive.ts:796-894)
- Final `DriveResult.status`: with `--once` — `"complete"` when all planned workers completed AND an `agent-delegation-drive` commit exists, else the last step's `"parked"`/`"blocked"`, else `"in-progress"`. Without `--once` — `"blocked"` on bound exhaustion; else `"parked"` when any task is `failed` or the last step parked; else `"blocked"` when the last step blocked; else `"complete"`. (src/drive.ts:895-907)
- Phase-boundary progress: after each round, the first not-yet-complete phase is announced once as active, and each newly finished phase once, with `phaseProgressLine` — `==> <Title> ✓ (done/total)` finished, `==> <Title> ⇉ (done/total)` active parallel, `==> <Title> … (done/total)` active sequential (title = phase name with the first letter upper-case). (src/drive.ts:826-848, 872; src/term.ts:104-109)

### `--incremental` and the result cache

- Cache file: `<run.cwd>/.cw/cache/worker-results/<safeFileName(workflow.id)>/<safeFileName(task.id)>-<first 32 hex of key digest>.md`. Writes are atomic: `<file>.<pid>.tmp` then `fs.renameSync`. (src/drive.ts:362-371, 469-474)
- Default (no `--incremental`): only a task with `resultCache: { mode: "read-write", keyInput }` is cached. Key = `sha256(JSON.stringify({schemaVersion:1, workflowId, taskId, keyInput, keyValue, promptDigest, completedResultsDigest}))` where `keyValue = String(run.inputs[keyInput]).trim()` (empty ⇒ no cache) and `completedResultsDigest` is `""` unless `includeCompletedResults === "previous-phases"`, in which case it is the digest of all strictly-earlier-phase result bytes (`undefined` — no caching — when any earlier task is not completed/readable). (src/drive.ts:398-467)
- `--incremental` (`incremental: true`): EVERY task is keyed. Key = `sha256(stableStringify({schemaVersion:2, workflowId, taskId, promptDigest, runInputsDigest, delegationDigest, upstreamResultsDigest}))`. `delegationDigest` folds `{model: task.model || config.model || "", agentType: task.agentType || "agent", sandboxProfileId, command, args: stripSecretArgs(config.args), endpoint}`. `upstreamResultsDigest` is the sorted-by-id digest of every strictly-earlier-phase task's result bytes; `undefined` disables caching for that task. schemaVersion 2 keys never collide with schemaVersion 1 keys. (src/drive.ts:387-425, 449-462)
- On a hit: the cached bytes are copied into the worker's `result.md` and accepted through the normal `recordWorkerOutput` gate; the step is `action:"accept", status:"ok", handleKind:"result-cache", reason:"result cache hit"`. A rejected cached result is a failed hop `result cache rejected: <message>` (no silent fallback). On a fresh accepted result the bytes are written into the cache. (src/drive.ts:282-298, 348-350)

### Sub-workflow fulfillment (`task.subWorkflow`)

- Spec: `{ appId, inputs? (templates rendered against PARENT run.inputs via {{name}}), bindResult?: "report" | "verdict-result" }`. (src/types/workflow-app.ts:52-62; src/drive.ts:664-670)
- Guards run BEFORE any child state exists: depth `ctx.depth + 1 > 4` fails the hop with `sub-workflow depth limit exceeded (> 4)`; a child `appId` already on `[...visitedAppIds, parentAppId]` fails with `sub-workflow cycle detected: <a -> b -> ... -> a>`. Both go through the normal retry/park path. (src/drive.ts:684-691)
- Child run id is deterministic: `sub-<parent-run-id>-<safeFileName(task.id)>` (injected into `plan` as `options.runId`; `runId` is stripped from child inputs). Child inputs = `{repo: parent inputs.repo ?? parent cwd, cwd: parent cwd, question: parent inputs.question ?? "", ...rendered templates, runId}`. The child is driven with the same `now`, config, policy, `incremental`, `depth+1`, and the extended app path. (src/drive.ts:694-717; src/orchestrator/lifecycle-operations.ts:78-80)
- A child that does not end `"complete"` fails the parent hop with `sub-workflow <appId> did not complete (status: <status>)`. The bound bytes are the child's `report.md` (default) or, for `bindResult: "verdict-result"`, the completed verdict/synthesis task's result file; missing bytes fail with `sub-workflow <appId> produced no <report|verdict-result>`. The bytes are written to the parent worker's `result.md` and accepted through the SAME `recordWorkerOutput` gate (a gate throw fails with `sub-workflow result rejected by parent gate: <msg>`). After accept, best-effort provenance (never un-does the accept): one `worker.sub-workflow` trust-audit event with `{subWorkflowAppId, subRunId, childReportDigest, childAuditVerified, bindResult}`, and `task.subRunId` / `task.subRunDir` are set. Success step: `action:"accept", status:"ok", handleKind:"sub-workflow", reason:"sub-workflow <appId> → <child-run-id>"`. (src/drive.ts:680-781)

### `loop()` expansion — `src/loop-expansion.ts` + `maybeExpandLoop`

- `registerLoopPredicate(name, fn)` / `getLoopPredicate(name)` / `hasLoopPredicate(name)` — a registry of NAMED pure predicates `(ctx) => {done, reason}`; re-registering a name overwrites. Context: `{round, roundResults, allResults, usageTotals, inputs}`. Built-ins: `"no-new-findings"` (done when every result of the round has no findings; reasons `"no-new-findings: the latest round produced no findings"` / `"no-new-findings: the latest round still has findings"`) and `"single-round"` (always `{done:true, reason:"single-round: stop after one round"}`). (src/loop-expansion.ts:19-63)
- `maxLoopExpansion(run)` — static worst case: sum over loop origin phases of `(maxRounds - 1) * round-1 task count`; 0 with no loop phases. Feeds the drive iteration bound. (src/loop-expansion.ts:70-79; src/drive.ts:807)
- Expansion itself lives in `maybeExpandLoop(run)` (called from `recordWorkerOutput` after each accepted result, at most ONE loop boundary per call): when the LATEST round phase of a not-done loop is fully completed, evaluate the stop rule — `until: {kind:"budget-target", target}` stops when recorded `totalTokens >= target` (reason `budget-target: <spent>/<target> recorded tokens`); `until: {kind:"predicate", ref}` runs the registered predicate, and an unregistered ref stops with reason `loop predicate "<ref>" not registered — stopping fail-closed`. `done = decision.done || round >= maxRounds`. One `loop-control` node is always recorded: id `<run-id>:loop-control:<origin-phase-id>:r<round>`, kind `loop-control`, status `completed`, outputs `{round, done, atCap, reason}`. When done, `origin.loopDone = true`. When not done: clone the round-1 template tasks as `<base-id>@r<next-round>` into a fresh phase `id: <origin-id>@r<next-round>`, name `<origin name> (round <n>)`, spliced right after the latest round phase; write the task files; run a `plan` pipeline stage per new task (mirrors `plan()`); refresh phase statuses. (src/orchestrator/lifecycle-operations.ts:490-604)

### Commit gate — `src/commit.ts`

- `commitState(run, input)` — input is a reason string (checkpoint path) or `CommitStateOptions {reason, verifierNodeId?, candidateId?, selectionId?, verifierGated?, allowUnverifiedCheckpoint?, source?: "runtime"|"cli"|"manual", metadata?}`. An empty reason becomes `"manual"`. The commit is verifier-gated when any of `verifierNodeId`/`candidateId`/`selectionId`/`verifierGated` is set, OR when the reason has the form `result:<task-id>` and that task has a `verifierNodeId` (auto-gate). (src/commit.ts:17-26, 149-156, 171-199, 578-582)
- Gate resolution order (errors keep this order): selection pass, candidate pass, `commit-verifier-required` check, verifier-node lookup, verifier grounding pass, rationale pass, review-gate pass. All error codes are listed under Exact outputs. When any error exists, the commit throws `CommitGateError` (name `"CommitGateError"`, `structured` = first error, `feedbackId`, `stateNodeId`) after writing one error node `id: <run-id>:commit-gate-failed:<0001…>` (kind `error`, status `failed` after `recordNodeError`, `metadata.failures` = all errors) linked under the selection/verifier nodes, plus one feedback record (`source` is `"cli"` when `options.source === "cli"`, else `"verifier"`; `stageId: "commit"`; `retryable: false`). (src/commit.ts:55-60, 514-567)
- On success: commit id `state-<seq 0001…>` (position in the append-only commit log); snapshot `commits/<id>.json` holding `{commit, run}`; `run.commits.push(commit)`. A gated commit records a `commit.gate` trust-audit event (`decision:"accepted"`, `source:"cw-validated"`) and one commit state node made through the pipeline `commit` stage: id `<run-id>:commit:<commit-id>`, `outputStatus:"committed"`, `loopStage:"checkpoint"`, artifact `{id:"snapshot", kind:"json", path}`, evidence copied from the verifier node; a resolved selection node is linked as a second parent. A non-gated checkpoint records node `<run-id>:checkpoint:<commit-id>` (kind `commit`, status `completed`) and no audit event. `gitHead` is `git rev-parse HEAD` with a 5000 ms timeout; any failure yields `undefined`. (src/commit.ts:62-125, 452-512, 646-679)
- Verifier grounding: the node must be kind `verifier` and status `verified` and have evidence. The HARD no-false-green gate: a verifier whose backing result was an empty capture fails with `commit-rationale-empty-capture`. When the backing task requires evidence (or there is no 1:1 task — explicit candidate/selection commits), at least one evidence locator must be grounded (`hasGroundedEvidence` on `locator || path || summary || id`), and with env `CW_REQUIRE_RESOLVABLE_EVIDENCE` set, file-style locators must resolve on disk against `[run.cwd, process.cwd(), run.paths.runDir]`. (src/commit.ts:127-147, 332-391)
- Candidate/selection rules: a candidate must not be `rejected`/`failed`, must have scores, must be `verified`, must have a verified selection whose state node (kind `candidate`, status `verified`) exists and carries a `scoreId`; a requested verifier that differs from the linked one raises `commit-verifier-linkage-mismatch` (the requested one is kept). `latestSelectionForCandidate` picks by newest `selectedAt` (byte compare). (src/commit.ts:249-326, 584-604)
- Review gate: `reviewGateErrors` may ADD errors (required approvals); `commitReviewProvenance` is attached only when zero errors remain. (src/commit.ts:429-450)
- CLI wrapper (`orchestrator/lifecycle-operations.ts:437-461`): `commit <run-id>` maps flags `--verifier/--candidate/--selection/--reason/--allow-unverified-checkpoint`; `verifierGated = hasGateOption || !allowCheckpoint`, so a bare CLI commit without `--allow-unverified-checkpoint` fails closed.

### Result ingest — `src/result-normalize.ts`

- `normalizeResultEnvelope(markdown)` -> `{summary, findings, evidence}`. Pure (no fs/clock/random). Fence regex: `/```cw:result\s*([\s\S]*?)```/`. No fence: summary = first non-empty line that does not start with `#` or a code fence, findings `[]`, evidence = grounded locators harvested from the prose. A fence with bad JSON throws `Invalid cw:result JSON: <parser message>`. Summary keys tried in order: `summary`, `short_answer`, `shortAnswer`, `verdict`, `answer`, `conclusion`, else first non-empty line. Findings: a non-empty canonical `findings` array wins; else the first non-empty of `candidate_risks`, `candidateRisks`, `risks`, `ranked_risks`, `rankedRisks`, `top_risks`, `topRisks`, `issues`, `problems`, `concerns`. Every finding is normalized: id from `id|key|name|title` else `finding-<n>`; classification coerced into `real|conditional|non-issue|unknown` (`confirmed|true|valid` → `real`; `possible|maybe|potential` → `conditional`; "non"+"issue" → `non-issue`); severity: a `P0..P3` tag wins, else `CRIT|BLOCKER`→`P0`, `HIGH|SEV`→`P1`, `MED`→`P2`, `LOW|MINOR|NIT`→`P3`, else `none`; evidence from the per-finding keys (`evidence`, `evidence_paths`, `evidencePaths`, `locators`, `refs`, `files`, `location`, `locations`, `path`, `paths`, `line`, `lines`, `where`) or harvested from the whole finding object, cap 32. Top-level evidence: a non-empty canonical `evidence` array wins verbatim; else grounded locators harvested from the parsed JSON + findings + de-fenced prose — deduped, sorted, cap 256. (src/result-normalize.ts:22-201)
- `isEmptyCapture(envelope)` — true when findings AND evidence are both empty; drives the `captureWarning` metadata and the `worker.capture-warning` audit event on result intake, and the commit gate's `commit-rationale-empty-capture`. (src/result-normalize.ts:205-207; src/orchestrator/lifecycle-operations.ts:307-322)
- `firstNonEmptyLine(markdown)` exported. (src/result-normalize.ts:194-201)

### Task files — `src/harness.ts`

- `writeTaskFiles(run)` — writes `<tasksDir>/<safeFileName(task.id)>.md` for every task and sets `task.taskPath`. `renderTask(run, task)` produces the exact template shown under Exact outputs (heading, Workflow/Run/Phase/Kind lines, Inputs block, the rendered prompt, the Output Contract block with the `cw:result` fence example). (src/harness.ts:6-52)

### Error feedback — `src/error-feedback.ts`

- `ERROR_FEEDBACK_SCHEMA_VERSION = 1`. `createErrorFeedbackLoop(options?)` bundles the functions below. (src/error-feedback.ts:18, 45-59)
- `recordFeedback(run, input, options?)` — normalizes the error (a string → `code:"runtime-error"`; an `Error` → code from the message: `/Invalid cw:result JSON/`→`result-parse-error`, `/requires cw:result evidence/` or `/requires evidence/`→`missing-required-evidence`, `/Phase gate blocked/`→`phase-gate-blocked`, else `runtime-error`). Dedup: an existing unresolved record with the same `{code,message,nodeId,stageId,contractId,path}` is returned unchanged. New records get id `feedback-<classification>-<0001…>` (position in the append-only feedback log), status `open`, severity from the classification, and are written to `feedback/<id>.json` plus `feedback/index.json`; `saveCheckpoint` unless `options.persist === false`. (src/error-feedback.ts:109-168, 301-346, 417-432)
- `classifyFeedback(error, context?)` — fixed order: `missing-artifact` (code has `missing-artifact`/`artifact-path`), `missing-evidence`, `verifier-failure` (code has `verifier` OR `stageId === "verify"` OR `source === "verifier"`), `state-transition` (`illegal-transition`/`state-transition`), `contract-violation` (code has `contract`/`unexpected-node` OR a `contractId` is present), `sandbox-policy` (code starts `sandbox-`), `parse-error` (`parse`/`json`), `pipeline-failure` (`pipeline`), `runtime-error`, else `unknown`. Severity: `verifier-failure`/`contract-violation` → `high`; `sandbox-policy`/`state-transition`/`missing-evidence` → `medium`; `missing-artifact`/`parse-error`/`pipeline-failure` → `medium` if retryable else `low`; else `low`. (src/error-feedback.ts:170-186, 330-338)
- `collectRunErrors(run, options?)` — one feedback record per not-yet-seen node error across `run.nodes` (source `state-node`), deduped by the joined key (fields joined with `""`). (src/error-feedback.ts:61-107, 422-432)
- `createCorrectionTask(run, feedbackId, {verifierCommand?, guidance?})` — idempotent (an existing `correctionTaskId` returns as-is). Writes `tasks/<safeFileName("feedback:<id>")>.md` (template in Exact outputs), appends a task node `<run-id>:task:feedback:<id>` (kind `task`, status `pending`, loopStage `adjust`, `metadata.correctionTask: true`), and marks the record `tasked`. (src/error-feedback.ts:188-230, 375-406)
- `resolveFeedback(run, feedbackId, result)` — `status:"resolved"` REQUIRES a `nodeId` (`Feedback <id> cannot resolve without a verified node id`) that exists (`Feedback <id> resolution node not found: <nodeId>`) and is `verified` or `committed` (`Feedback <id> resolution node must be verified or committed`); anything else marks `rejected`. Evidence/artifacts are merged by id. (src/error-feedback.ts:232-266)
- `listFeedback(run, {status?, severity?, classification?})`, `getFeedback(run, id)`, `summarizeFeedback(run)` (`{total, byStatus, bySeverity, byClassification, artifacts}` where artifacts are the feedback JSON paths). Unknown id in `requireFeedback` throws `Unknown feedback id for run <run-id>: <feedback-id>`. (src/error-feedback.ts:268-299, 369-373)

### CLI / MCP surface (capability layer)

- `run <app|--run <id>> --drive [--once] [--now <iso>] [--incremental] [--concurrency N]` — capability `run.drive.step`, MCP tool `cw_run_drive_step`, entry `runDrive`. Without a run id an app id is required (`run --drive requires an app id (or --run <run-id> to continue)`); a fresh run is planned with the arg bag MINUS the runtime keys `once,now,preview,step,drive,json,format,run,runId,cwd,agentCommand,agent-command,agentArgs,agent-args,agentEndpoint,agent-endpoint,agentModel,agent-model,agentTimeoutMs,agent-timeout-ms,resume,incremental,concurrency,link,ref,branch,refresh` (so agent flags never leak into `run.inputs`). The drive runs with the run's repo as base dir (`withBaseDir`, no `process.chdir`). (src/capability-core.ts:559-625; src/capability-registry.ts:502)
- `run drive <run-id> [--json]` — capability `run.drive`, MCP tool `cw_run_drive`, entry `runDrivePreview`: read-only `DrivePreview`. (src/capability-core.ts:554-557; src/capability-registry.ts:501)
- `run resume <run-id> [--drive|--once]` — capability `run.resume`, MCP `cw_run_resume`. Default is read-only and byte-identical to the registry resume payload; with `--drive`/`--once` the SAME run is handed to `runDrive` (nothing re-planned) and the payload gains a `drive` field with the `DriveResult`. (src/capability-core.ts:246-258; src/capability-registry.ts:491)
- `quickstart` composes `plan -> runDrive -> report`; `--resume` without `--run` forces `once: true` and prints a continue line; with `--run <id>` it continues to completion and stamps `resumedFrom: <id>`. (src/capability-core.ts:667-731, 826-829; src/types/drive.ts:69-112)
- Agent config env vars read by `resolveAgentConfig`: `CW_AGENT_COMMAND`, `CW_AGENT_ENDPOINT`, `CW_AGENT_MODEL`, `CW_AGENT_TIMEOUT_MS`, `CW_AGENT_ATTEST_PUBKEY`, `CW_REQUIRE_ATTESTED_TELEMETRY` (flags > env > file). `builtin:<name>` commands expand from `builtin-templates.json`. (src/agent-config.ts:97-106, 174-222)
- Other env: `CW_DRIVE_PROGRESS` (see above), `CW_DETERMINISTIC_RUN_IDS` (deterministic dispatch/run ids), `CW_REQUIRE_RESOLVABLE_EVIDENCE` (strict commit evidence), `CW_BACKEND` (default backend selection).

## Exact outputs

### Default contract stage table (byte facts a rebuild must keep)

```json
{"id":"plan","acceptedInputKinds":["input"],"acceptedInputStatuses":["pending","completed"],"producedOutputKind":"task","requiredArtifacts":["state"]}
{"id":"dispatch","acceptedInputKinds":["task"],"acceptedInputStatuses":["pending"],"producedOutputKind":"dispatch","requiredArtifacts":["task"]}
{"id":"result","acceptedInputKinds":["dispatch"],"acceptedInputStatuses":["running","completed"],"producedOutputKind":"result","requiredArtifacts":["result"]}
{"id":"verify","acceptedInputKinds":["result","verifier"],"acceptedInputStatuses":["completed","verified"],"producedOutputKind":"verifier","requiredEvidence":["cw:result"]}
{"id":"commit","acceptedInputKinds":["verifier","commit"],"acceptedInputStatuses":["verified"],"producedOutputKind":"commit","verifierGate":{"required":true,"acceptedStatuses":["verified"],"requiredEvidence":true}}
{"id":"report","acceptedInputKinds":["commit","result","verifier"],"acceptedInputStatuses":["committed","completed","verified"],"producedOutputKind":"report","requiredArtifacts":["report"]}
```

(src/pipeline-contract.ts:10-63)

### DriveStep / DriveResult / DrivePreview JSON shapes

```ts
DriveStep = { schemaVersion: 1, runId, action: "dispatch"|"fulfill"|"accept"|"commit"|"park"|"blocked"|"complete",
  status: "ok"|"parked"|"blocked"|"failed"|"complete", taskId?, workerId?, phase?, backendId?: "agent",
  attempts?, handleKind?, reportedModel?, reason? }
DriveResult = { schemaVersion: 1, runId, workflowId, status: "complete"|"parked"|"blocked"|"in-progress",
  steps: DriveStep[], plannedWorkers, completedWorkers, parkedWorkers, commitId?, reportPath, statePath, agentConfigured }
DrivePreview = { schemaVersion: 1, runId, workflowId, plannedWorkers, pendingWorkers, completedWorkers,
  parkedWorkers, nextAction, nextTaskId?, nextPhase?, agentConfigured }
```

`plannedWorkers` is the task count AT DRIVE START (loop expansion grows tasks but not this number inside one drive call). `parkedWorkers` counts tasks with `status === "failed"`. (src/types/drive.ts:25-62, 138-153; src/drive.ts:97-103, 798, 909-922)

### Exact reason / message strings

```text
agent backend not configured (set CW_AGENT_COMMAND/CW_AGENT_ENDPOINT or pass --agent-command/--agent-endpoint) — refusing rather than fabricating a completion
no eligible worker (a parked/failed worker blocks the phase gate)
token budget exhausted: <spent> recorded tokens >= budget <budget> — refusing to spawn further agents
dispatch produced no worker scope
no worker scope for task
agent hop <status>: <summary>
agent produced no result.md
result.md rejected: <message>
result cache rejected: <message>
result cache hit
committed <commit-id>
drive reached max iteration limit (<maxIterations>) before a terminal state
sub-workflow depth limit exceeded (> 4)
sub-workflow cycle detected: <appA -> appB -> appA>
sub-workflow plan failed (<appId>): <message>
sub-workflow <appId> did not complete (status: <status>)
sub-workflow <appId> produced no <report|verdict-result>
sub-workflow result rejected by parent gate: <message>
sub-workflow <appId> → <child-run-id>
<reason> (attempt <n>/<maxAttempts>)          # retryOrPark parkedReason
run --drive requires an app id (or --run <run-id> to continue)
```

(src/drive.ts:175, 194, 205, 263, 270, 284, 289, 296, 316, 323, 345, 685, 690, 708, 719, 732, 740, 779, 892; src/scheduling.ts:139; src/capability-core.ts:609)

### Stderr progress lines (only when TTY or `CW_DRIVE_PROGRESS=1`)

```text
[drive] → <label> (<phase>) — dispatched, spawning agent, may take minutes…
[drive] → <label> (<phase>) — spawning agent, may take minutes…
[drive] ↺ <label> (<phase>) — accepting cached result
[drive] ⧉ <label> (<phase>) — sub-workflow <appId>…
[drive] ⇉ concurrent round: <n> agents spawning in parallel, may take minutes…
[drive] <n>. <action> <status> <taskId> model=<model> — <reason>
[drive] ==> <Phase title> ✓ (done/total)
[drive] ==> <Phase title> ⇉ (done/total)     # active parallel phase
[drive] ==> <Phase title> … (done/total)     # active sequential phase
```

(src/drive.ts:139-142, 284, 307, 598, 703, 856-867; src/term.ts:100-109)

### Commit-gate error codes (fixed strings)

```text
commit-verifier-required        commit-verifier-not-found      commit-verifier-wrong-kind
commit-verifier-not-verified    commit-rationale-empty-capture commit-verifier-missing-evidence
commit-verifier-evidence-ungrounded  commit-verifier-evidence-unresolvable
commit-selection-not-found      commit-selection-node-missing  commit-selection-not-verified
commit-candidate-not-found      commit-candidate-not-selectable commit-candidate-unscored
commit-candidate-not-verified   commit-candidate-selection-missing
commit-verifier-linkage-mismatch commit-rationale-incomplete   commit-gate-blocked
```

Example messages: `Verifier-gated commit requires --verifier, --candidate, or --selection` (with `details.hint: "Use --allow-unverified-checkpoint to write a non-gated checkpoint."`), `Verifier node not found: <id>`, `Node <id> is not a verifier node`, `Verifier node <id> is <status>`, `Verifier node <id> cannot back a commit: <captureWarning>`, `Verifier node <id> has no evidence`, `Verifier node <id> evidence is not grounded (needs a path-like locator, URL, or namespace:value token)`, `Verifier node <id> cites file evidence that does not resolve on disk: <list>`, `Commit selection not found: <id>`, `Selection <id> has no state node`, `Selection <id> is not a verified candidate selection`, `Selection <id> has no score evidence`, `Commit candidate not found: <id>`, `Candidate <id> is <status>`, `Candidate <id> has no score evidence`, `Candidate <id> is not verifier-gated`, `Candidate <id> has no verified selection`, `Candidate <id> selection <sel> is not verified`, `Candidate <id> selection <sel> has no score evidence`, `Requested verifier <a> is not linked to <candidate|selection> <id>`, `Verifier-gated commit cannot explain acceptance: <failure>`, `Verifier-gated commit blocked`. (src/commit.ts:205-208, 214, 254, 262, 266, 272, 286, 290, 295, 300, 306, 316, 322, 334, 340, 354, 360, 376, 384, 417, 515, 592)

### Pipeline / state-node contract error codes (thrown as `PipelineContractError`)

```text
illegal-transition        commit-without-verifier   invalid-contract-schema   invalid-contract-id
invalid-contract-title    invalid-contract-stages   invalid-contract-compatibility  incompatible-contract
invalid-contract-stage-id duplicate-contract-stage  invalid-contract-stage-name
invalid-contract-stage-kinds invalid-contract-stage-statuses invalid-contract-stage-output
unknown-contract-stage    unexpected-node-kind      unexpected-node-status
missing-required-artifact missing-artifact-path     missing-required-evidence
verifier-gate-blocked     verifier-gate-missing-evidence
pipeline-stage-error      # wrapper code for a non-contract error in failPipelineStage
```

Messages e.g.: `State node <id> cannot transition from <from> to <to>`, `State node <id> cannot be committed before it is verified`, `Stage <id> does not accept node kind <kind>`, `Stage <id> does not accept node status <status>`, `Node <id> is missing required artifact <name>`, `Node <id> artifact <artifactId> path does not exist`, `Node <id> is missing required evidence [<name>]`, `Stage <id> requires verifier status <list>`, `Stage <id> requires evidence before commit`. (src/state-node.ts:81-135, 137-164, 237-308; src/pipeline-runner.ts:313)

### Deterministic id formats

```text
dispatch-<STAMP>-0001            # STAMP e.g. 20260703T101500Z; CW_DETERMINISTIC_RUN_IDS=1 ⇒ dispatch-0001
state-0001                       # commit id = position in run.commits + 1, 4 digits
<run-id>:commit:<commit-id>      # gated commit node        <run-id>:checkpoint:<commit-id>  # checkpoint node
<run-id>:commit-gate-failed:0001 # blocked-commit node, counted per run
feedback-<classification>-0001   # feedback id = position in run.feedback + 1
<run-id>:dispatch:<dispatch-id>  <run-id>:task:<task-id>  <run-id>:result:<task-id>  <run-id>:verifier:<task-id>
<run-id>:loop-control:<origin-phase-id>:r<round>
<base-task-id>@r<round>          # loop round clone task id;  phase id: <origin-id>@r<round>
sub-<parent-run-id>-<safe-task-id>   # sub-workflow child run id
<kind>-<16 hex>                  # fallback node id: sha256 of {kind,loopStage,contractId,inputs,outputs}
```

(src/dispatch.ts:225-232; src/commit.ts:651-663; src/error-feedback.ts:417-420; src/orchestrator/lifecycle-operations.ts:539, 557, 574; src/drive.ts:694; src/state-node.ts:344-355)

### Dispatch manifest instructions string (verbatim)

```text
Spawn one worker per task when the user explicitly authorized agent/parallel/background work. Save each final summary as Markdown and record it with `cw.js result <run-id> <task-id> <file>`.
```

(src/dispatch.ts:117-118)

### Task file template (verbatim skeleton from `renderTask`)

```markdown
# <task.id>

- Workflow: <workflow.title>
- Run: <run.id>
- Phase: <task.phase>
- Kind: <task.kind>

## Inputs

- Repository: <inputs.repo || run.cwd>
- Question: <inputs.question || "">
- Invariants: <inputs.invariant joined with "; ">

## Task

<task.prompt>

## Output Contract

- Return a concise Markdown summary.
- Include concrete evidence paths and line numbers when applicable.
- Separate real, conditional, non-issue, and unknown findings when reviewing risk.
- For verification or verdict tasks, include a `cw:result` JSON fence with `findings` and `evidence`.
- Do not edit files unless the parent agent session explicitly assigned implementation work.

```cw:result
{
  "summary": "one sentence",
  "findings": [
    { "id": "finding-id", "classification": "real|conditional|non-issue|unknown", "severity": "P0|P1|P2|P3|none", "evidence": ["file-or-url:line"] }
  ],
  "evidence": ["file-or-url:line"]
}
```
```

(src/harness.ts:14-52)

### Correction task template (verbatim skeleton)

```markdown
# Correction Task: <feedback-id>

- Status: <status>
- Severity: <severity>
- Classification: <classification>
- Source: <source>
- Code: <code>
- Message: <message>
- Node: <nodeId or empty>
- Stage: <stageId or empty>
- Contract: <contractId or empty>
- Path: <path or empty>
- Retryable: yes|no

## Evidence

- <id>: <locator|path|summary|source>    # or the single line: No evidence recorded.

## Expected Verification

<verifierCommand or: Run the relevant verifier or smoke test and record the verified StateNode id.>

## Guidance

<guidance or: Retry only after explicit correction input. | Do not retry blindly.>
```

(src/error-feedback.ts:375-411)

### Exit codes

The functions in this area signal failure by throwing; the CLI layer maps an uncaught throw to a non-zero exit and `--json` payloads to exit 0. A blocked `quickstart --check` exits non-zero (documented gate). `drive()` itself never throws for blocked/parked — it reports them in `DriveResult.status`. (docs/agent-delegation-drive.7.md:188-192; src/drive.ts:895-907)

## Files on disk

All run-relative paths live under `<run.cwd>/.cw/runs/<run-id>/`.

```text
state.json                         # the whole WorkflowRun (authoritative; atomic write + fsync in state.ts)
nodes/<safeFileName(node-id)>.json # one JSON per StateNode, rewritten on every appendRunNode
dispatches/<dispatch-id>.json      # DispatchManifest (schemaVersion 1; keys: runId, dispatchId, createdAt, phase,
                                   #   instructions, tasks[], manifestPath, stateNodeId, workerIndexPath,
                                   #   sandboxProfileId, sandboxPolicy, backendId, backendSelection,
                                   #   backendAttestation?, multiAgent?)
commits/state-0001.json            # {commit, run} snapshot pair
tasks/<safeFileName(task-id)>.md   # task file (template above); correction tasks: tasks/feedback:<id>.md
results/<safeFileName(task-id)>.md # accepted result copy (recordResult path)
workers/index.json                 # worker index (workerIndexPath in the manifest)
workers/<worker-id>/result.md      # the file the agent must write (workerResultPath)
feedback/<feedback-id>.json        # one ErrorFeedbackRecord
feedback/index.json                # the whole run.feedback array
report.md                          # rendered report (writeReport)
```

Plus the repo-level result cache: `<run.cwd>/.cw/cache/worker-results/<safe-workflow-id>/<safe-task-id>-<32-hex>.md` (atomic `<file>.<pid>.tmp` + rename). A sub-workflow child run gets its own full run dir at `.cw/runs/sub-<parent-run-id>-<safe-task-id>/`. (src/state-node.ts:226-231; src/dispatch.ts:68-69, 121, 173; src/commit.ts:62-64, 119-122; src/error-feedback.ts:348-360; src/drive.ts:362-371, 469-474, 694; src/harness.ts:6-12)

Example dispatch manifest (shape):

```json
{
  "schemaVersion": 1,
  "runId": "architecture-review-20260703T101500Z-ab12cd",
  "dispatchId": "dispatch-20260703T101501Z-0001",
  "createdAt": "2026-07-03T10:15:01.000Z",
  "phase": "map",
  "instructions": "Spawn one worker per task when the user explicitly authorized agent/parallel/background work. Save each final summary as Markdown and record it with `cw.js result <run-id> <task-id> <file>`.",
  "tasks": [{ "id": "map:entrypoints", "kind": "map", "phase": "map", "status": "running",
              "taskPath": ".../tasks/map-entrypoints.md", "prompt": "...", "workerId": "...",
              "workerManifestPath": ".../workers/<id>/manifest.json", "workerDir": ".../workers/<id>",
              "workerResultPath": ".../workers/<id>/result.md", "sandboxProfileId": "readonly", "backendId": "agent" }],
  "manifestPath": ".../dispatches/dispatch-20260703T101501Z-0001.json",
  "stateNodeId": "<run-id>:dispatch:dispatch-20260703T101501Z-0001",
  "workerIndexPath": ".../workers/index.json",
  "sandboxProfileId": "readonly",
  "backendId": "agent"
}
```

## Invariants and error behavior

1. **Legal node transitions only.** `pending→[running,blocked,failed,completed,verified,rejected]`, `running→[completed,failed,blocked]`, `completed→[verified,rejected,failed]`, `failed→[pending,blocked]`, `blocked→[pending,failed]`, `verified→[committed,rejected]`, `rejected→[pending,failed]`, `committed→[]`; a same-status transition is always legal. `committed` is reachable ONLY from `verified` (double-checked: `commit-without-verifier`). (src/state-node.ts:81-99, 310-323)
2. **Commit fails closed.** A gated commit with ANY gate error throws `CommitGateError` — but first writes the `commit-gate-failed` error node and one feedback record, so every blocked try is visible on disk. Review-gate policy can only ADD errors, never relax the verifier gate. (src/commit.ts:55-60, 429-450, 514-567)
3. **No false green.** An accepted result with zero findings AND zero evidence is flagged (`captureWarning` metadata + `worker.capture-warning` audit event) at intake, and a verifier backed by such a result can NEVER back a gated commit (`commit-rationale-empty-capture`). (src/orchestrator/lifecycle-operations.ts:307-322; src/commit.ts:352-357)
4. **Drive fail-closed set.** Unconfigured agent ⇒ blocked (never a made-up completion). Token budget reached ⇒ blocked before the next spawn (blocked, not parked — the task is fine, the run is out of budget). A hop that exits non-zero / writes no `result.md` / writes a rejected `result.md` ⇒ failed hop; past the retry budget (`maxAttempts`, default 3) ⇒ parked terminal (`recordWorkerFailure` code `agent-delegation-parked`, `retryable:false`), and the parked task blocks the phase gate. Iteration-bound exhaustion ⇒ blocked, never `complete`. (src/drive.ts:157-207, 608-652, 889-894; src/scheduling.ts:27-35, 135-142)
5. **Phase gate ordering.** `firstRunnablePhase` walks phases in declaration order; any earlier phase with a failed (parked) task and nothing pending/running returns `null` and freezes the run in `blocked` until an operator acts. The serial driver takes a `running` task before a `pending` one (retries first). (src/dispatch.ts:177-185; src/drive.ts:90-95)
6. **Determinism.** `now` is injected; step order is the fixed phase/dispatch order; batch results are recorded in deterministic task order regardless of finish order; cache keys use `sha256` + `stableStringify` + byte-order sorts (`compareBytes`); commit/feedback/dispatch/loop-control ids are position- or content-based, not random. Two replays differ only in ISO timestamps. (src/drive.ts:486-543, 449-462; src/commit.ts:646-663; src/error-feedback.ts:413-420; src/dispatch.ts:220-232)
7. **Persistence and atomicity.** Every state write goes through the atomic temp-rename+fsync writer (`writeJson`/`saveCheckpoint` in `state.ts`). The pipeline runner persists per stage unless `persist: false`. A concurrent round defers all per-task persists (`persistState:false` / `deferPersist`) and flushes ONCE at round end (`commitState("concurrent-round:<n>-tasks")` + `writeReport` + `saveCheckpoint`); a crash mid-round loses at most that round's bookkeeping and forces a safe re-dispatch/re-spawn — never disk corruption or double counting. (src/pipeline-runner.ts:163, 291-293; src/drive.ts:486-543; src/orchestrator/lifecycle-operations.ts:204-251)
8. **Accept-path order is load-bearing.** `recordWorkerOutput` runs validate → attest delegation → accept → ledger → verify → completion → fan-out in exactly that order (audit chains cross-link by parent event ids). `maybeExpandLoop` runs after each accepted worker result and expands at most ONE loop boundary per call. (src/worker-isolation.ts:317-341; src/orchestrator/lifecycle-operations.ts:360-398, 490-498)
9. **Collect-all in a concurrent round.** A failed/hung/dirty hop never aborts its siblings; every hop settles and is recorded; failures park through the same `retryOrPark`. The token budget is NOT re-checked between accepts (finished work is never thrown away; overshoot is bounded by the round width; the next round blocks). (src/drive.ts:476-543)
10. **Sub-workflow honesty.** Depth (cap 4) and cycle checks fire BEFORE any child state is minted. The parent records exactly ONE `worker.sub-workflow` cross-link (child run id + report digest + the child's own audit verdict) — nothing summed or made up; a cross-link failure never un-does an accepted hop. (src/drive.ts:680-781)
11. **Loop bound is static.** The drive's iteration bound folds `maxLoopExpansion` (a pure function of the workflow declaration), so a loop can never spin the drive forever; `maxRounds` is a hard cap; an unregistered predicate stops the loop, it does not throw. (src/loop-expansion.ts:70-79; src/orchestrator/lifecycle-operations.ts:521-535)
12. **Bad input behavior.** Unknown run/contract/node/stage ids are hard throws (the caller cannot go on safely). Only `PipelineContractError` becomes a structured stage failure; any other throw from `runPipelineStage` propagates raw. A cw:result fence with bad JSON throws `Invalid cw:result JSON: …` at intake (fed back as feedback code `result-parse-error`). (src/pipeline-runner.ts:54, 61, 175, 255; src/result-normalize.ts:53-58; src/error-feedback.ts:322-328)

## Edge cases

- **Resume after interrupt.** Every drive step re-loads the run from `state.json` (`runner.loadRun` at step entry), so a killed drive resumes cleanly: `run resume <id> --drive/--once` or `run <app> --drive --run <id>` continues the SAME run — a `running` task is re-tried on its existing worker scope (no re-dispatch), a `pending` task dispatches fresh. `quickstart --resume` (no `--run`) advances exactly one step and prints the continue line; with `--run <id>` it finishes and echoes `resumedFrom`. (src/drive.ts:146-152, 255-260; src/capability-core.ts:246-258, 707-731)
- **Empty dispatch.** No runnable phase / no pending task ⇒ a manifest with `dispatchId: null`, `tasks: []`, `manifestPath: null` and NO file write, no state mutation. (src/dispatch.ts:53-65)
- **Already-committed terminal.** The terminal commit happens once per run; the check is "any commit whose reason starts with `agent-delegation-drive`". Repeated drives after completion return `action:"complete"` steps. (src/drive.ts:163-172)
- **Verdict-gated terminal commit.** Only a completed task whose id matches `/^verdict[:/]|^synthesis[:/]/i` supplies the verifier; otherwise the terminal commit is an explicit unverified checkpoint. (src/drive.ts:105-108, 165-169)
- **`exitCode` evidence parsing.** The agent hop's exit code rides in the envelope evidence as a line `exitCode:<n>`; `exitCode:null` maps to `null`. (src/drive.ts:110-115)
- **Fence-less but well-cited results.** Without a `cw:result` fence CW still harvests grounded locators from prose, so the envelope evidence is not empty for a cited report. Prose with spaces is never captured whole; only locator tokens (backtick spans, `file.ext:line`, URLs) are pulled. (src/result-normalize.ts:45-51, 147-180)
- **Concurrent + sub-workflow nesting.** The round cache is re-entrant: a `parallel()` phase's sub-workflow task recursively calls `drive()` on the same runner without clobbering the outer round's cached run. (src/drive.ts:486-498; test/concurrent-subworkflow-cache-nesting-smoke.js)
- **Loop-round tasks re-enter the drive count.** Loop expansion appends tasks mid-drive; the iteration bound already covers the worst case, but `plannedWorkers` in the result stays the initial count (status display). (src/drive.ts:798-807)
- **Feedback dedup across collect passes.** `collectRunErrors` and `recordFeedback` dedupe by the ``-joined key / by matching unresolved record fields, so re-running collect never duplicates records and id sequence numbers stay stable. (src/error-feedback.ts:61-129)
- **Custom sandbox profile durability.** A file-loaded custom profile definition is persisted into run state at dispatch so a worker can re-resolve it by logical id after the file path is gone; two different definitions under one id throw at dispatch. (src/dispatch.ts:234-264)
- **Old state migration.** Runs without `nodes`/`contracts`/`feedback` arrays are readable; loaders start the arrays up (`ensureFeedbackState`, `getRunContract` upserting the default contract on demand). (src/error-feedback.ts:301-305; src/pipeline-runner.ts:46-57; docs/pipeline-runner.7.md:128-135)
- **Concurrent batch selection.** The batch takes pending AND running tasks of the first runnable phase (width-capped), so retries share the round with fresh dispatches; a task consumed by an earlier accept in the same round is skipped on the settle pass. (src/drive.ts:504-533)
- **`--concurrency` forwarding.** The CLI flag reaches `drive()` (`concurrency: numberOption(args.concurrency)`); a phase authored `mode:"parallel"` gets concurrency with NO flag at all (auto width). (src/capability-core.ts:618-624; src/drive.ts:813-820)

## Evidence

Every claim above carries its pointer inline. Chief anchors: src/pipeline-runner.ts:29-319; src/pipeline-contract.ts:3-91; src/dispatch.ts:28-264; src/drive.ts:54-961; src/commit.ts:17-679; src/result-normalize.ts:22-207; src/loop-expansion.ts:19-79; src/harness.ts:6-57; src/error-feedback.ts:18-475; src/state-node.ts:21-355; src/scheduling.ts:27-157; src/orchestrator/lifecycle-operations.ts:62-604; src/capability-core.ts:246-258, 554-625, 667-731; src/capability-registry.ts:491-509; src/types/drive.ts:13-153; src/types/pipeline.ts:5-137; src/types/run.ts:18-134; src/types/workflow-app.ts:52-105; src/worker-isolation.ts:317-448; src/term.ts:100-109; docs/pipeline-runner.7.md; docs/agent-delegation-drive.7.md; docs/verifier-gated-commit.7.md; docs/error-feedback.7.md.

## Pinned by tests

- `test/pipeline-runner-smoke.js` — stage selection, contract checks, failure nodes.
- `test/pipeline-auto-advance-smoke.js` — `failurePolicy.autoAdvance` semantics.
- `test/state-node-smoke.js` — transition table + contract errors.
- `test/agent-delegation-drive-smoke.js` — the whole drive lifecycle with a stub agent (dispatch/fulfill/accept/commit, fail-closed unconfigured, park).
- `test/run-resume-drive-smoke.js` — `run resume <id> --drive/--once`; bare resume stays read-only.
- `test/incremental-resume-smoke.js` — `--incremental` prefix reuse + invalidation rules.
- `test/loop-bounded-expansion-smoke.js` — loop() rounds, `loop-control` nodes, `maxRounds` cap, unregistered predicate stop.
- `test/budget-scaling-loop-smoke.js` — `until:{kind:"budget-target"}` scaling under the token cap.
- `test/token-budget-enforcement-smoke.js` — budget block before spawn; never claw back finished work.
- `test/sub-workflow-nesting-smoke.js` — child plan+drive, bind report, depth/cycle guards.
- `test/concurrent-subworkflow-cache-nesting-smoke.js` — re-entrant round cache with nested drive.
- `test/parallel-onramp-smoke.js` — `mode:"parallel"` auto-width through the real surface.
- `test/drive-concurrency-flag-smoke.js` — `--concurrency N` actually forwarded.
- `test/concurrent-failure-semantics-smoke.js` — collect-all: hang + crash + dirty return in one round.
- `test/deferred-checkpoint-batching-smoke.js` — O(1) state flush per concurrent round.
- `test/drive-exhaustion-blocked-smoke.js` — iteration-bound exhaustion reports blocked, never complete.
- `test/verifier-gated-commit-smoke.js` — gate codes, checkpoint vs committed nodes.
- `test/result-normalize-smoke.js` — canonical pass-through, alt keys, prose harvest, caps.
- `test/error-feedback-smoke.js`, `test/error-feedback-resolution-smoke.js`, `test/feedback-ops-unit-smoke.js` — record/classify/task/resolve rules.
- `test/worker-retry-count-smoke.js` — persisted retry counts feeding `handleHop`.
- `test/end-to-end-golden-path-smoke.js`, `test/quickstart-no-agent-smoke.js`, `test/quickstart-smoke.js` — the composed plan→drive→report path and the no-agent fail-closed stop.
- `test/h7-custom-profile-persist-smoke.js` — custom sandbox profile persistence at dispatch.
- `test/architecture-review-fast-phase-cache-smoke.js` — opt-in result cache with `previous-phases` scope.

## Rebuild risks

1. **The park/block split.** Parked = the task failed past its retry budget (terminal, `task.status:"failed"`, blocks the phase). Blocked = nothing is wrong with the task (no agent config, token budget, phase gate, iteration bound). Mixing these breaks `DriveResult.status` and every operator recovery hint.
2. **The two commit worlds.** `status:"committed"` nodes only through the verifier-gated `commit` pipeline stage from a `verified` verifier node with grounded evidence; everything else is a `checkpoint` (`kind:"commit"`, `status:"completed"`, `verifierGated:false, checkpoint:true`). The CLI defaults to gated; the runtime string form defaults to checkpoint. Easy to get backwards.
3. **Attempt accounting.** `handleHop` takes `max(in-memory attempts, persisted worker retryCount)` then lets `retryOrPark` add one — so a resumed drive keeps counting from disk. Rebuilding with only in-memory counts makes an interrupted run retry forever.
4. **Cache-key completeness.** The `--incremental` key MUST fold the delegation digest (model/agent identity/backend/sandbox PROFILE ID — not the full policy) and the upstream RESULT bytes, or a model swap / changed upstream serves stale results. schemaVersion 1 and 2 caches must never collide.
5. **Deterministic recording order under concurrency.** Children run in wall-clock parallel but accepts are recorded in batch (task-id) order, with per-task re-reads from the SAME cached run object and ONE flush at round end. Recording in completion order breaks replay byte-stability.
6. **`plannedWorkers` freeze + iteration bound.** `plannedWorkers` is captured before the loop and never grows; the termination bound instead adds the STATIC `maxLoopExpansion`. Deriving either from runtime task counts breaks replay stability or terminates too early.
7. **Empty-capture and grounding gates.** Result intake accepts an empty capture (with a warning), but the COMMIT gate must hard-block it; evidence grounding applies only to evidence-requiring tasks and explicit candidate/selection commits; `CW_REQUIRE_RESOLVABLE_EVIDENCE` is opt-in. Getting the strictness on the wrong layer either blocks all runs or lets a 0-evidence review commit as green.
8. **Exact strings are contract.** Reasons like `no eligible worker (a parked/failed worker blocks the phase gate)`, the park suffix `(attempt <n>/<max>)`, the commit reason prefix `agent-delegation-drive` (the once-only terminal-commit check matches on this prefix!), and the id formats (`state-0001`, `dispatch-…-0001`, `feedback-<class>-0001`, `@r<n>` suffixes) are matched by tests and by the drive's own logic. Rewording breaks behavior, not just output.
