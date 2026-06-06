import fs from "node:fs";
import path from "node:path";
import { DispatchManifest, DispatchTask, RunPhase, RunTask, WorkflowRun } from "./types";
import { writeJson } from "./state";

export function nextDispatchTasks(run: WorkflowRun, limit?: number): DispatchTask[] {
  const runnablePhase = firstRunnablePhase(run);
  if (!runnablePhase) return [];
  const max = Number(limit || run.workflow.limits.maxConcurrentAgents || 4);
  const runnableTaskIds = new Set(runnablePhase.taskIds);
  return run.tasks
    .filter((task) => task.status === "pending" && runnableTaskIds.has(task.id))
    .slice(0, max)
    .map(formatDispatchTask);
}

export function createDispatchManifest(run: WorkflowRun, limit?: number): DispatchManifest {
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
  const manifestPath = path.join(run.paths.dispatchesDir, `${dispatchId}.json`);
  fs.mkdirSync(run.paths.dispatchesDir, { recursive: true });
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

  const manifest: DispatchManifest = {
    schemaVersion: 1,
    runId: run.id,
    dispatchId,
    createdAt,
    phase: tasks[0].phase,
    instructions:
      "Spawn one worker per task when the user explicitly authorized agent/parallel/background work. Save each final summary as Markdown and record it with `cw.js result <run-id> <task-id> <file>`.",
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
  writeJson(manifestPath, manifest);
  return manifest;
}

export function firstRunnablePhase(run: WorkflowRun): RunPhase | null {
  for (const phase of run.phases) {
    const phaseTasks = run.tasks.filter((task) => phase.taskIds.includes(task.id));
    if (phaseTasks.some((task) => task.status === "running")) return phase;
    if (phaseTasks.some((task) => task.status === "pending")) return phase;
    if (!phaseTasks.every((task) => task.status === "completed")) return null;
  }
  return null;
}

export function updatePhaseStatuses(run: WorkflowRun): void {
  for (const phase of run.phases) {
    const phaseTasks = run.tasks.filter((task) => phase.taskIds.includes(task.id));
    if (phaseTasks.every((task) => task.status === "completed")) {
      phase.status = "completed";
    } else if (phaseTasks.some((task) => task.status === "running" || task.status === "completed")) {
      phase.status = "running";
    } else {
      phase.status = "pending";
    }
  }
}

export function formatDispatchTask(task: RunTask): DispatchTask {
  return {
    id: task.id,
    kind: task.kind,
    phase: task.phase,
    status: task.status,
    taskPath: task.taskPath,
    prompt: task.prompt
  };
}

function createDispatchId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  return `dispatch-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}
