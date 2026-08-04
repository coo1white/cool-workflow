"use strict";
// core/pipeline/drive-decide.ts — driveStep/driveConcurrentRound's PURE
// decision core: task selection, terminal/gate logic, token-budget check,
// retry/park math, cache-key formulas.
//
// MILESTONE 6+7 (combined; the big one — see plugins/cool-workflow/project/docs/rebuild/PLAN.md Open risk 9).
// Every branch here is a pure function of already-loaded run state; it
// does not itself spawn a process or touch disk. shell/drive.ts is the
// thin imperative loop that calls these functions once per step and
// performs the actual spawn/commit/cache-write IO the decision names.
//
// Evidence: SPEC/pipeline-run.md "Drive loop — src/drive.ts", "Drive
// internals a rebuild must copy", "`--incremental` and the result
// cache".
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SCHEDULING_POLICY = exports.MAX_SUB_WORKFLOW_DEPTH = exports.DRIVE_SCHEMA_VERSION = void 0;
exports.makeStep = makeStep;
exports.selectDriveTask = selectDriveTask;
exports.countCompleted = countCompleted;
exports.countParked = countParked;
exports.verdictVerifierNodeId = verdictVerifierNodeId;
exports.exitCodeFromEvidence = exitCodeFromEvidence;
exports.hasTerminalCommit = hasTerminalCommit;
exports.terminalOrConfigStep = terminalOrConfigStep;
exports.retryOrPark = retryOrPark;
exports.priorAttempts = priorAttempts;
exports.maxIterations = maxIterations;
exports.autoWidth = autoWidth;
exports.roundWidth = roundWidth;
exports.finalDriveStatus = finalDriveStatus;
exports.cacheFileName = cacheFileName;
exports.defaultCacheKey = defaultCacheKey;
exports.incrementalCacheKey = incrementalCacheKey;
exports.incrementalDelegationDigest = incrementalDelegationDigest;
const dispatch_1 = require("./dispatch");
const hash_1 = require("../hash");
exports.DRIVE_SCHEMA_VERSION = 1;
exports.MAX_SUB_WORKFLOW_DEPTH = 4;
function makeStep(action, status, fields) {
    return { schemaVersion: 1, action, status, ...fields };
}
/** The task the next drive step would advance: a running task first,
 *  else the next pending task of the first runnable phase. */
function selectDriveTask(run) {
    const phase = (0, dispatch_1.firstRunnablePhase)(run);
    if (!phase)
        return undefined;
    const taskIds = new Set(phase.taskIds);
    const phaseTasks = run.tasks.filter((task) => taskIds.has(task.id));
    return phaseTasks.find((task) => task.status === "running") || phaseTasks.find((task) => task.status === "pending");
}
function countCompleted(run) {
    return run.tasks.filter((task) => task.status === "completed").length;
}
function countParked(run) {
    return run.tasks.filter((task) => task.status === "failed").length;
}
/** The completed verdict/synthesis task's verifierNodeId, if any. */
function verdictVerifierNodeId(run) {
    const verdict = run.tasks.find((task) => /^verdict[:/]|^synthesis[:/]/i.test(task.id) && task.status === "completed");
    return verdict?.verifierNodeId;
}
function exitCodeFromEvidence(evidence) {
    const entry = evidence.find((line) => line.startsWith("exitCode:"));
    if (!entry)
        return null;
    const raw = entry.slice("exitCode:".length);
    return raw === "null" ? null : Number(raw);
}
/** Whether a commit already exists whose reason starts with
 *  "agent-delegation-drive" (the once-only terminal-commit check). */
function hasTerminalCommit(run) {
    return (run.commits || []).some((commit) => commit.reason && commit.reason.startsWith("agent-delegation-drive"));
}
/** terminalOrConfigStep's pure decision half. Returns a DriveStep only
 *  for the non-advancing outcomes (terminal commit/complete, blocked
 *  phase, blocked token budget, blocked unconfigured agent); returns
 *  `{kind: undefined}` when there is a ready task to actually process. */
function terminalOrConfigStep(run, selected, agentConfigured, tokenBudget) {
    if (!selected) {
        const allComplete = run.tasks.every((task) => task.status === "completed");
        if (allComplete) {
            if (!hasTerminalCommit(run)) {
                return { kind: "commit", verifierNodeId: verdictVerifierNodeId(run) };
            }
            return { kind: "complete", step: makeStep("complete", "complete", { runId: run.id }) };
        }
        return {
            kind: "blocked",
            step: makeStep("blocked", "blocked", { runId: run.id, reason: "no eligible worker (a parked/failed worker blocks the phase gate)" }),
        };
    }
    if (tokenBudget && tokenBudget.budget > 0 && tokenBudget.spent >= tokenBudget.budget) {
        return {
            kind: "blocked",
            step: makeStep("blocked", "blocked", {
                runId: run.id,
                taskId: selected.id,
                phase: selected.phase,
                reason: `token budget exhausted: ${tokenBudget.spent} recorded tokens >= budget ${tokenBudget.budget} — refusing to spawn further agents`,
            }),
        };
    }
    if (!agentConfigured) {
        return {
            kind: "blocked",
            step: makeStep("blocked", "blocked", {
                runId: run.id,
                taskId: selected.id,
                phase: selected.phase,
                reason: "agent backend not configured (set CW_AGENT_COMMAND/CW_AGENT_ENDPOINT or pass --agent-command/--agent-endpoint) — refusing rather than fabricating a completion",
            }),
        };
    }
    return { kind: undefined };
}
exports.DEFAULT_SCHEDULING_POLICY = { maxAttempts: 3 };
/** `retryOrPark` — adds one attempt; at `attempts >= maxAttempts` parks
 *  with `parkedReason = "<reason> (attempt <n>/<max>)"`. */
function retryOrPark(priorAttempts, policy, reason) {
    const attempts = priorAttempts + 1;
    if (attempts >= policy.maxAttempts) {
        return { status: "parked", attempts, parkedReason: `${reason} (attempt ${attempts}/${policy.maxAttempts})` };
    }
    return { status: "retryable", attempts };
}
/** `handleHop`'s attempt-accounting rule: prior attempts = max(in-memory
 *  count, the worker scope's persisted retryCount). */
function priorAttempts(inMemoryAttempts, persistedRetryCount) {
    return Math.max(inMemoryAttempts, persistedRetryCount);
}
// ---------------------------------------------------------------------------
// Loop iteration bound.
// ---------------------------------------------------------------------------
/** `maxIterations = (plannedWorkers + maxLoopExpansion) * (maxAttempts +
 *  1) + 5`. */
function maxIterations(plannedWorkers, loopExpansion, policy) {
    return (plannedWorkers + loopExpansion) * (policy.maxAttempts + 1) + 5;
}
/** Round width per iteration: an explicit concurrency > 1 wins; else
 *  autoWidth for a first-runnable parallel phase. */
function autoWidth(run) {
    const phase = (0, dispatch_1.firstRunnablePhase)(run);
    if (!phase || phase.mode !== "parallel")
        return 1;
    const cap = Math.max(1, Math.floor(run.workflow.limits?.maxConcurrentAgents || 1));
    return Math.max(1, Math.min(cap, phase.taskIds.length));
}
function roundWidth(run, concurrency) {
    return concurrency && concurrency > 1 ? concurrency : autoWidth(run);
}
function finalDriveStatus(inputs) {
    if (inputs.once) {
        if (inputs.completedWorkers === inputs.plannedWorkers && inputs.committed)
            return "complete";
        if (inputs.lastStepStatus === "parked" || inputs.lastStepStatus === "blocked")
            return inputs.lastStepStatus;
        return "in-progress";
    }
    if (inputs.exhaustedMaxIterations)
        return "blocked";
    if (inputs.parkedWorkers > 0 || inputs.lastStepStatus === "parked")
        return "parked";
    if (inputs.lastStepStatus === "blocked")
        return "blocked";
    return "complete";
}
// ---------------------------------------------------------------------------
// Result cache key formulas.
// ---------------------------------------------------------------------------
/** Cache file path (relative to `<run.cwd>/.cw/cache/worker-results/`).
 *  Actual path join / atomic write is shell-side. */
function cacheFileName(taskId, digest) {
    return `${safeFileNamePart(taskId)}-${digest.replace(/^sha256:/, "").slice(0, 32)}.md`;
}
/** Kept in sync with shell/fs-atomic.ts's `safeFileName` by the same
 *  regex (this pure module cannot import the shell-side impure copy);
 *  both are pinned by SPEC/pipeline-run.md's cache-file-path line, which
 *  names it `safeFileName` explicitly — the charset MUST include `:` so
 *  a task id like `golden:path` keeps its colon in the cache filename. */
function safeFileNamePart(value) {
    return String(value).replace(/[^a-zA-Z0-9_.:-]+/g, "_");
}
/** Default (no `--incremental`) cache key. `undefined` disables caching
 *  for this call (no keyInput, empty keyValue, or an unavailable
 *  completedResultsDigest upstream). */
function defaultCacheKey(workflowId, taskId, keyInput, keyValue, promptDigest, completedResultsDigest) {
    if (!keyInput || !keyValue || !keyValue.trim())
        return undefined;
    if (completedResultsDigest === undefined)
        return undefined;
    return (0, hash_1.sha256)(JSON.stringify({
        schemaVersion: 1,
        workflowId,
        taskId,
        keyInput,
        keyValue: keyValue.trim(),
        promptDigest,
        completedResultsDigest,
    }));
}
/** `--incremental` cache key (schemaVersion 2 — never collides with
 *  schemaVersion 1). `undefined` disables caching (an upstream result is
 *  unavailable). */
function incrementalCacheKey(workflowId, taskId, promptDigest, runInputsDigest, delegationDigest, upstreamResultsDigest) {
    if (upstreamResultsDigest === undefined)
        return undefined;
    return (0, hash_1.sha256)((0, hash_1.stableStringify)({
        schemaVersion: 2,
        workflowId,
        taskId,
        promptDigest,
        runInputsDigest,
        delegationDigest,
        upstreamResultsDigest,
    }));
}
/** The delegation digest folded into the incremental cache key. */
function incrementalDelegationDigest(model, agentType, sandboxProfileId, command, strippedArgs, endpoint) {
    return (0, hash_1.sha256)((0, hash_1.stableStringify)({
        model,
        agentType,
        sandboxProfileId,
        command,
        args: strippedArgs,
        endpoint,
    }));
}
