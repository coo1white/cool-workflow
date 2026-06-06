"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.nextDispatchTasks = nextDispatchTasks;
exports.createDispatchManifest = createDispatchManifest;
exports.firstRunnablePhase = firstRunnablePhase;
exports.updatePhaseStatuses = updatePhaseStatuses;
exports.formatDispatchTask = formatDispatchTask;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("./state");
function nextDispatchTasks(run, limit) {
    const runnablePhase = firstRunnablePhase(run);
    if (!runnablePhase)
        return [];
    const max = Number(limit || run.workflow.limits.maxConcurrentAgents || 4);
    const runnableTaskIds = new Set(runnablePhase.taskIds);
    return run.tasks
        .filter((task) => task.status === "pending" && runnableTaskIds.has(task.id))
        .slice(0, max)
        .map(formatDispatchTask);
}
function createDispatchManifest(run, limit) {
    const tasks = nextDispatchTasks(run, limit);
    if (!tasks.length) {
        return {
            schemaVersion: 1,
            runId: run.id,
            dispatchId: null,
            tasks: [],
            manifestPath: null
        };
    }
    const dispatchId = createDispatchId();
    const manifestPath = node_path_1.default.join(run.paths.dispatchesDir, `${dispatchId}.json`);
    node_fs_1.default.mkdirSync(run.paths.dispatchesDir, { recursive: true });
    const taskIds = new Set(tasks.map((task) => task.id));
    const createdAt = new Date().toISOString();
    for (const task of run.tasks) {
        if (taskIds.has(task.id)) {
            task.status = "running";
            task.loopStage = "act";
            task.dispatchId = dispatchId;
            task.dispatchedAt = createdAt;
        }
    }
    const manifest = {
        schemaVersion: 1,
        runId: run.id,
        dispatchId,
        createdAt,
        phase: tasks[0].phase,
        instructions: "Spawn one worker per task when the user explicitly authorized agent/parallel/background work. Save each final summary as Markdown and record it with `cw.js result <run-id> <task-id> <file>`.",
        tasks: run.tasks.filter((task) => taskIds.has(task.id)).map(formatDispatchTask),
        manifestPath
    };
    run.dispatches.push({
        id: dispatchId,
        phase: manifest.phase || "",
        taskIds: tasks.map((task) => task.id),
        manifestPath,
        createdAt
    });
    updatePhaseStatuses(run);
    (0, state_1.writeJson)(manifestPath, manifest);
    return manifest;
}
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
function updatePhaseStatuses(run) {
    for (const phase of run.phases) {
        const phaseTasks = run.tasks.filter((task) => phase.taskIds.includes(task.id));
        if (phaseTasks.every((task) => task.status === "completed")) {
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
function formatDispatchTask(task) {
    return {
        id: task.id,
        kind: task.kind,
        phase: task.phase,
        status: task.status,
        taskPath: task.taskPath,
        prompt: task.prompt
    };
}
function createDispatchId() {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
    return `dispatch-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}
