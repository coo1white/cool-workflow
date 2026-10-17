// core/pipeline/drive-decide.ts — driveStep/driveConcurrentRound's PURE
// decision core: task selection, terminal/gate logic, token-budget check,
// retry/park math, cache-key formulas.
//
// Every branch here is a pure function of already-loaded run state; it
// does not itself spawn a process or touch disk. shell/drive.ts is the
// thin imperative loop that calls these functions once per step and
// performs the actual spawn/commit/cache-write IO the decision names.
//
// Evidence: SPEC/pipeline-run.md "Drive loop — drive module", "Drive
// internals a rebuild must copy", "`--incremental` and the result
// cache".
import { firstRunnablePhase, runnableTaskIds } from "./dispatch.js";
import { stableStringify, sha256 } from "../hash.js";
import { isVerdictTaskId } from "../trust/evidence-grounding.js";
export const DRIVE_SCHEMA_VERSION = 1;
export const MAX_SUB_WORKFLOW_DEPTH = 4;
export function makeStep(action, status, fields) {
    return { schemaVersion: 1, action, status, ...fields };
}
/** The task the next drive step would advance: a running task first,
 *  else the next pending task of the first runnable phase (and of any
 *  phase that overlaps it). */
export function selectDriveTask(run) {
    const taskIds = runnableTaskIds(run);
    if (!taskIds.size)
        return undefined;
    const phaseTasks = run.tasks.filter((task) => taskIds.has(task.id));
    return phaseTasks.find((task) => task.status === "running") || phaseTasks.find((task) => task.status === "pending");
}
export function countCompleted(run) {
    return run.tasks.filter((task) => task.status === "completed").length;
}
export function countParked(run) {
    return run.tasks.filter((task) => task.status === "failed").length;
}
/** The error code handleHop records when a worker's agent hop fails past
 *  its retry budget. */
export const AGENT_PARKED_CODE = "agent-delegation-parked";
/** The tasks a resume may run again: failed tasks whose worker's LAST
 *  error is the retry-budget park. A worker stopped for any other reason
 *  (a sandbox or boundary violation, a rejected result) stays failed. */
export function reopenableParkedTaskIds(run) {
    const workers = run.workers || [];
    return run.tasks
        .filter((task) => {
        if (task.status !== "failed" || !task.workerId)
            return false;
        const errors = workers.find((worker) => worker.id === task.workerId)?.errors || [];
        return errors.length > 0 && errors[errors.length - 1].code === AGENT_PARKED_CODE;
    })
        .map((task) => task.id);
}
/** The completed verdict/synthesis task's verifierNodeId, if any. */
export function verdictVerifierNodeId(run) {
    const verdict = run.tasks.find((task) => isVerdictTaskId(task.id) && task.status === "completed");
    return verdict?.verifierNodeId;
}
export function exitCodeFromEvidence(evidence) {
    const entry = evidence.find((line) => line.startsWith("exitCode:"));
    if (!entry)
        return null;
    const raw = entry.slice("exitCode:".length);
    return raw === "null" ? null : Number(raw);
}
/** Whether a commit already exists whose reason starts with
 *  "agent-delegation-drive" (the once-only terminal-commit check). */
export function hasTerminalCommit(run) {
    return (run.commits || []).some((commit) => commit.reason && commit.reason.startsWith("agent-delegation-drive"));
}
/** terminalOrConfigStep's pure decision half. Returns a DriveStep only
 *  for the non-advancing outcomes (terminal commit/complete, blocked
 *  phase, blocked token budget, blocked unconfigured agent); returns
 *  `{kind: undefined}` when there is a ready task to actually process. */
export function terminalOrConfigStep(run, selected, agentConfigured, tokenBudget) {
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
export const DEFAULT_SCHEDULING_POLICY = { maxAttempts: 3 };
/** What a timeout park tells the person to do (0.3.3). */
export const TIMEOUT_PARK_NEXT_STEP = "raise CW_AGENT_TIMEOUT_MS (or --agent-timeout-ms) or check the agent command";
/** The try count a timed-out hop gets: maxTimeoutAttempts (default 1), at least 1, never above maxAttempts. */
export function timeoutAttemptLimit(policy) {
    const raw = Number(policy.maxTimeoutAttempts ?? 1);
    return Math.max(1, Math.min(Number.isFinite(raw) ? Math.floor(raw) : 1, policy.maxAttempts));
}
/** `retryOrPark` — adds one attempt; at `attempts >= maxAttempts` parks
 *  with `parkedReason = "<reason> (attempt <n>/<max>)"`. A timed-out hop
 *  (`timedOutMs` set) parks at min(maxTimeoutAttempts ?? 1, maxAttempts). */
export function retryOrPark(priorAttempts, policy, reason, timedOutMs) {
    const attempts = priorAttempts + 1;
    if (timedOutMs && timedOutMs > 0) {
        const limit = timeoutAttemptLimit(policy);
        if (attempts >= limit) {
            const tries = attempts > limit ? String(attempts) : `${attempts}/${limit}`;
            return { status: "parked", attempts, parkedReason: `${reason} (attempt ${tries}; limit ${shortDuration(timedOutMs)}) — not tried again: ${TIMEOUT_PARK_NEXT_STEP}` };
        }
        return { status: "retryable", attempts };
    }
    if (attempts >= policy.maxAttempts) {
        return { status: "parked", attempts, parkedReason: `${reason} (attempt ${attempts}/${policy.maxAttempts})` };
    }
    return { status: "retryable", attempts };
}
/** A time limit in ms as short text: `10m`, `1m 30s`, `45s`, `500ms`. */
export function shortDuration(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    const total = Math.round(ms / 1000);
    if (total < 60)
        return `${total}s`;
    const seconds = total % 60;
    return seconds ? `${Math.floor(total / 60)}m ${seconds}s` : `${Math.floor(total / 60)}m`;
}
/** The short "why" for the `[drive] ✗` retry line: a timeout becomes
 *  `timed out after 10m`; any other reason keeps the text after its first
 *  ` — ` (the part past the task label and refusal kind), cut to 120
 *  characters. New in 0.3.3. */
export function shortHopReason(reason) {
    const timeout = /timed out after (\d+)ms/.exec(reason);
    if (timeout)
        return `timed out after ${shortDuration(Number(timeout[1]))}`;
    const dash = reason.indexOf(" — ");
    const tail = (dash >= 0 ? reason.slice(dash + 3) : reason).trim();
    return tail.length > 120 ? `${tail.slice(0, 119)}…` : tail;
}
/** `handleHop`'s retry progress line, without the `[drive] ` lead:
 *  `✗ <label> (<phase>) — <why>; trying again (<next>/<max>)`, where
 *  `attempts` is the count of tries so far. New in 0.3.3. */
export function hopRetryLine(label, phase, reason, attempts, policy, timedOutMs) {
    const max = timedOutMs ? timeoutAttemptLimit(policy) : policy.maxAttempts;
    return `✗ ${label} (${phase}) — ${shortHopReason(reason)}; trying again (${attempts + 1}/${max})`;
}
/** `handleHop`'s attempt-accounting rule: prior attempts = max(in-memory
 *  count, the worker scope's persisted retryCount). */
export function priorAttempts(inMemoryAttempts, persistedRetryCount) {
    return Math.max(inMemoryAttempts, persistedRetryCount);
}
// ---------------------------------------------------------------------------
// Loop iteration bound.
// ---------------------------------------------------------------------------
/** `maxIterations = (plannedWorkers + maxLoopExpansion) * (maxAttempts +
 *  1) + 5`. */
export function maxIterations(plannedWorkers, loopExpansion, policy) {
    return (plannedWorkers + loopExpansion) * (policy.maxAttempts + 1) + 5;
}
/** Round width per iteration: an explicit concurrency > 1 wins; else
 *  autoWidth for a first-runnable parallel phase. */
export function autoWidth(run) {
    const phase = firstRunnablePhase(run);
    if (!phase || phase.mode !== "parallel")
        return 1;
    const cap = Math.max(1, Math.floor(run.workflow.limits?.maxConcurrentAgents || 1));
    return Math.max(1, Math.min(cap, runnableTaskIds(run).size));
}
export function roundWidth(run, concurrency) {
    return concurrency && concurrency > 1 ? concurrency : autoWidth(run);
}
export function finalDriveStatus(inputs) {
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
export function cacheFileName(taskId, digest) {
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
export function defaultCacheKey(workflowId, taskId, keyInput, keyValue, promptDigest, completedResultsDigest) {
    if (!keyInput || !keyValue || !keyValue.trim())
        return undefined;
    if (completedResultsDigest === undefined)
        return undefined;
    return sha256(JSON.stringify({
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
export function incrementalCacheKey(workflowId, taskId, promptDigest, runInputsDigest, delegationDigest, upstreamResultsDigest) {
    if (upstreamResultsDigest === undefined)
        return undefined;
    return sha256(stableStringify({
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
export function incrementalDelegationDigest(model, agentType, sandboxProfileId, command, strippedArgs, endpoint) {
    return sha256(stableStringify({
        model,
        agentType,
        sandboxProfileId,
        command,
        args: strippedArgs,
        endpoint,
    }));
}
