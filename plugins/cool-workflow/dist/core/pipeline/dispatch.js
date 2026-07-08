"use strict";
// core/pipeline/dispatch.ts — nextDispatchTasks, firstRunnablePhase,
// updatePhaseStatuses, formatDispatchTask, dispatch-id formatting.
//
// MILESTONE 6+7 (combined). Byte-exact port of the PURE parts of the old
// build's src/dispatch.ts (the decision half — worker-scope allocation,
// manifest file writes, and multi-agent attachment are shell-side, see
// shell/worker-isolation.ts and shell/drive.ts).
//
// Evidence: SPEC/pipeline-run.md "Dispatch — src/dispatch.ts".
Object.defineProperty(exports, "__esModule", { value: true });
exports.firstRunnablePhase = firstRunnablePhase;
exports.updatePhaseStatuses = updatePhaseStatuses;
exports.formatDispatchTask = formatDispatchTask;
exports.nextDispatchTasks = nextDispatchTasks;
exports.formatDispatchId = formatDispatchId;
/** `firstRunnablePhase(run)` — walks phases in order; a phase with a
 *  running task, or one with a pending task, is the runnable phase; a
 *  phase not fully completed and with nothing pending/running blocks
 *  everything after it (`null`). */
function firstRunnablePhase(run) {
    for (const phase of run.phases) {
        const phaseTasks = run.tasks.filter((task) => phase.taskIds.includes(task.id));
        if (phaseTasks.some((task) => task.status === "running"))
            return phase;
        if (phaseTasks.some((task) => task.status === "pending"))
            return phase;
        if (!phaseTasks.every((task) => task.status === "completed"))
            return null;
    }
    return null;
}
/** `updatePhaseStatuses(run)` — completed when every task is completed,
 *  running when some task is running or completed, else pending. */
function updatePhaseStatuses(run) {
    for (const phase of run.phases) {
        const phaseTasks = run.tasks.filter((task) => phase.taskIds.includes(task.id));
        if (phaseTasks.length > 0 && phaseTasks.every((task) => task.status === "completed")) {
            phase.status = "completed";
        }
        else if (phaseTasks.some((task) => task.status === "running" || task.status === "completed")) {
            phase.status = "running";
        }
        else {
            phase.status = "pending";
        }
    }
}
/** `formatDispatchTask(task)` — projection with workerDir/workerResultPath
 *  derived from workerManifestPath. */
function formatDispatchTask(task) {
    const workerManifestPath = task.workerManifestPath;
    return {
        id: task.id,
        kind: task.kind,
        phase: task.phase,
        status: task.status,
        taskPath: task.taskPath,
        prompt: task.prompt,
        workerId: task.workerId,
        workerManifestPath,
        workerDir: workerManifestPath ? dirnamePosix(workerManifestPath) : undefined,
        workerResultPath: task.workerId && workerManifestPath ? joinPosix(dirnamePosix(workerManifestPath), "result.md") : undefined,
        sandboxProfileId: task.sandboxProfileId,
        sandboxPolicy: task.sandboxPolicy,
        backendId: task.backendId,
        backendAttestation: task.backendAttestation,
        multiAgent: task.multiAgent,
    };
}
/** `nextDispatchTasks(run, limit?)` — pending tasks of the first runnable
 *  phase, capped, mapped through formatDispatchTask. `??`, not `||`: an
 *  explicit `limit: 0` (or a configured `maxConcurrentAgents: 0`) means
 *  "dispatch nothing", not "no limit was given" — `0 || fallback` used to
 *  silently replace a real zero with the fallback. Negative numbers are
 *  clamped to 0 before reaching `.slice()`, which otherwise treats a
 *  negative end index as "drop that many from the end" instead of "cap at
 *  this many". */
function nextDispatchTasks(run, limit) {
    const runnablePhase = firstRunnablePhase(run);
    if (!runnablePhase)
        return [];
    const max = Math.max(0, Math.floor(limit ?? run.workflow.limits.maxConcurrentAgents ?? 4));
    const runnableTaskIds = new Set(runnablePhase.taskIds);
    return run.tasks
        .filter((task) => task.status === "pending" && runnableTaskIds.has(task.id))
        .slice(0, max)
        .map(formatDispatchTask);
}
/** Dispatch id: `dispatch-<STAMP>-<seq>` (STAMP = ISO with `-`/`:`
 *  stripped, sub-second cut); `CW_DETERMINISTIC_RUN_IDS` ⇒
 *  `dispatch-<seq>`. `seq` is the 4-digit per-run position. */
function formatDispatchId(seq, now, deterministic) {
    const padded = String(seq).padStart(4, "0");
    if (deterministic)
        return `dispatch-${padded}`;
    const stamp = now.replace(/[-:]/g, "").replace(/\..+/, "Z");
    return `dispatch-${stamp}-${padded}`;
}
// Node path helpers kept dependency-free (no "node:path" import — this
// module stays pure per the core/shell split) since workerManifestPath
// values are always POSIX-style disk paths produced by shell/.
function dirnamePosix(p) {
    const idx = p.lastIndexOf("/");
    return idx >= 0 ? p.slice(0, idx) : p;
}
function joinPosix(a, b) {
    return a.endsWith("/") ? `${a}${b}` : `${a}/${b}`;
}
