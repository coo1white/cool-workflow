// core/pipeline/drive-decide.ts — the drive's pure decisions: which tasks may
// run, retry or park, what the final status is. shell/drive.ts does the I/O.
export function makeStep(action, status, fields) {
    return { schemaVersion: 1, action, status, ...fields };
}
function tasksOf(run, phase) {
    const ids = new Set(phase.taskIds);
    return run.tasks.filter((task) => ids.has(task.id));
}
/** The first phase with work left; a phase that is not complete and has
 *  nothing pending or running blocks every phase after it (null). */
export function firstRunnablePhase(run) {
    for (const phase of run.phases) {
        const tasks = tasksOf(run, phase);
        if (tasks.some((task) => task.status === "running" || task.status === "pending"))
            return phase;
        if (!tasks.every((task) => task.status === "completed"))
            return null;
    }
    return null;
}
/** The first runnable phase's tasks, plus each next phase marked overlapPrevious. */
export function runnableTaskIds(run) {
    const first = firstRunnablePhase(run);
    if (!first)
        return new Set();
    const ids = new Set(first.taskIds);
    for (let i = run.phases.indexOf(first) + 1; i < run.phases.length && run.phases[i].overlapPrevious; i += 1) {
        for (const id of run.phases[i].taskIds)
            ids.add(id);
    }
    return ids;
}
export function updatePhaseStatuses(run) {
    for (const phase of run.phases) {
        const tasks = tasksOf(run, phase);
        if (tasks.length > 0 && tasks.every((task) => task.status === "completed"))
            phase.status = "completed";
        else if (tasks.some((task) => task.status === "running" || task.status === "completed"))
            phase.status = "running";
        else
            phase.status = "pending";
    }
}
/** The tasks the next round may start, in plan order, at most `width`. */
export function selectRoundTasks(run, width) {
    const ids = runnableTaskIds(run);
    return run.tasks.filter((task) => ids.has(task.id) && (task.status === "pending" || task.status === "running")).slice(0, Math.max(1, width));
}
/** Round width: a parallel phase runs up to maxConcurrentAgents at once. */
export function autoWidth(run) {
    const phase = firstRunnablePhase(run);
    if (!phase || phase.mode !== "parallel")
        return 1;
    const cap = Math.max(1, Math.floor(run.workflow.limits?.maxConcurrentAgents || 1));
    return Math.max(1, Math.min(cap, runnableTaskIds(run).size));
}
export function countCompleted(run) {
    return run.tasks.filter((task) => task.status === "completed").length;
}
export function countParked(run) {
    return run.tasks.filter((task) => task.status === "failed").length;
}
export const AGENT_PARKED_CODE = "agent-delegation-parked";
/** Tasks the drive parked after their retries; `--resume --run` opens them again. */
export function reopenableParkedTaskIds(run) {
    return run.tasks
        .filter((task) => task.status === "failed" && task.errors?.length && task.errors[task.errors.length - 1].code === AGENT_PARKED_CODE)
        .map((task) => task.id);
}
export const TERMINAL_COMMIT_REASON = "agent-delegation-drive";
export function hasTerminalCommit(run) {
    return run.commits.some((commit) => commit.reason.startsWith(TERMINAL_COMMIT_REASON));
}
export const BLOCKED_PHASE_GATE = "no eligible worker (a parked/failed worker blocks the phase gate)";
export const BLOCKED_NO_AGENT = "agent backend not configured (set CW_AGENT_COMMAND or pass --agent-command) — refusing rather than fabricating a completion";
/** Nothing left to start: commit, complete, or blocked by a parked task. */
export function terminalStep(run) {
    if (run.tasks.every((task) => task.status === "completed")) {
        if (!hasTerminalCommit(run))
            return { kind: "commit" };
        return { kind: "complete", step: makeStep("complete", "complete", { runId: run.id }) };
    }
    return { kind: "blocked", step: makeStep("blocked", "blocked", { runId: run.id, reason: BLOCKED_PHASE_GATE }) };
}
export const DEFAULT_SCHEDULING_POLICY = { maxAttempts: 3 };
export const TIMEOUT_PARK_NEXT_STEP = "raise CW_AGENT_TIMEOUT_MS (or --agent-timeout-ms) or check the agent command";
export function timeoutAttemptLimit(policy) {
    const raw = Number(policy.maxTimeoutAttempts ?? 1);
    return Math.max(1, Math.min(Number.isFinite(raw) ? Math.floor(raw) : 1, policy.maxAttempts));
}
/** A timeout parks at once (a second wait would cost the same again). */
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
export function shortDuration(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    const total = Math.round(ms / 1000);
    if (total < 60)
        return `${total}s`;
    const seconds = total % 60;
    return seconds ? `${Math.floor(total / 60)}m ${seconds}s` : `${Math.floor(total / 60)}m`;
}
export function shortHopReason(reason) {
    const timeout = /timed out after (\d+)ms/.exec(reason);
    if (timeout)
        return `timed out after ${shortDuration(Number(timeout[1]))}`;
    const dash = reason.indexOf(" — ");
    const tail = (dash >= 0 ? reason.slice(dash + 3) : reason).trim();
    return tail.length > 120 ? `${tail.slice(0, 119)}…` : tail;
}
export function hopRetryLine(label, phase, reason, attempts, policy, timedOutMs) {
    const max = timedOutMs ? timeoutAttemptLimit(policy) : policy.maxAttempts;
    return `✗ ${label} (${phase}) — ${shortHopReason(reason)}; trying again (${attempts + 1}/${max})`;
}
export const WAIT_NOTE = ", may take minutes…";
/** ", may take minutes…" goes on a process's first spawn or round line only. */
export function spawningAgentLine(task, waitNote) {
    return `→ ${task.id} (${task.phase}) — spawning agent${waitNote ? WAIT_NOTE : ""}`;
}
/** "20s" or "4m 10s". */
export function sinceText(ms) {
    const total = Math.round(ms / 1000);
    return total < 60 ? `${total}s` : `${Math.floor(total / 60)}m ${total % 60}s`;
}
/** The still-working line's note on how long the running agents have been
 *  quiet; "" when none is running. */
export function quietNote(jobs, now) {
    const running = jobs.filter((job) => !job.done && Number.isFinite(job.lastOutputAt));
    if (!running.length)
        return "";
    const quiet = sinceText(Math.max(0, now - Math.min(...running.map((job) => job.lastOutputAt))));
    return running.length === 1 ? ` (last output ${quiet} ago)` : ` (${running.length} agents running, longest without output ${quiet})`;
}
export function concurrentRoundLine(agents, waitNote) {
    return `» concurrent round: ${agents} agent${agents > 1 ? "s" : ""} spawning in parallel${waitNote ? WAIT_NOTE : ""}`;
}
export function finalDriveStatus(inputs) {
    if (inputs.parkedWorkers > 0 || inputs.lastStepStatus === "parked")
        return "parked";
    if (inputs.lastStepStatus === "blocked")
        return "blocked";
    return inputs.plannedWorkers > 0 && inputs.completedWorkers === inputs.plannedWorkers ? "complete" : "blocked";
}
