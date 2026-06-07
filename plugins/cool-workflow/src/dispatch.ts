import fs from "node:fs";
import path from "node:path";
import { DispatchManifest, DispatchTask, ResolvedSandboxPolicy, RunPhase, RunTask, WorkflowRun } from "./types";
import { writeJson } from "./state";
import { DEFAULT_PIPELINE_CONTRACT_ID } from "./pipeline-contract";
import { appendRunNode, createStateNode, transitionStateNode } from "./state-node";
import { allocateWorkerScope } from "./worker-isolation";
import { DEFAULT_SANDBOX_PROFILE_ID, resolveSandboxProfileById, sandboxContextForValidation } from "./sandbox-profile";

export interface DispatchOptions {
  sandboxProfileId?: string;
  sandbox?: string;
}

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

export function createDispatchManifest(run: WorkflowRun, limit?: number, options: DispatchOptions = {}): DispatchManifest {
  const requestedSandboxProfileId = options.sandboxProfileId || options.sandbox;
  const sandboxProfileId = String(requestedSandboxProfileId || DEFAULT_SANDBOX_PROFILE_ID);
  resolveSandboxProfileById(sandboxProfileId, sandboxContextForValidation(run.cwd));
  const tasks = nextDispatchTasks(run, limit);
  if (!tasks.length) {
    return {
      schemaVersion: 1,
      runId: run.id,
      dispatchId: null,
      tasks: [],
      manifestPath: null,
      sandboxProfileId
    };
  }

  const dispatchId = createDispatchId();
  const manifestPath = path.join(run.paths.dispatchesDir, `${dispatchId}.json`);
  fs.mkdirSync(run.paths.dispatchesDir, { recursive: true });
  const taskIds = new Set(tasks.map((task) => task.id));
  const createdAt = new Date().toISOString();
  const selectedSandboxProfileIds = new Set<string>();
  let sandboxPolicy: ResolvedSandboxPolicy | undefined;

  for (const task of run.tasks) {
    if (taskIds.has(task.id)) {
      const taskSandboxProfileId = String(requestedSandboxProfileId || task.sandboxProfileId || DEFAULT_SANDBOX_PROFILE_ID);
      selectedSandboxProfileIds.add(taskSandboxProfileId);
      task.status = "running";
      task.loopStage = "act";
      task.dispatchId = dispatchId;
      task.dispatchedAt = createdAt;
      const scope = allocateWorkerScope(run, task, {
        dispatchId,
        sandboxProfileId: taskSandboxProfileId,
        status: "running",
        persist: false,
        metadata: { dispatchId, phase: task.phase }
      });
      sandboxPolicy = sandboxPolicy || scope.sandboxPolicy;
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
    manifestPath,
    workerIndexPath: run.paths.workersDir ? path.join(run.paths.workersDir, "index.json") : undefined,
    sandboxProfileId: selectedSandboxProfileIds.size === 1 ? [...selectedSandboxProfileIds][0] : "mixed",
    sandboxPolicy: selectedSandboxProfileIds.size === 1 ? sandboxPolicy : undefined
  };

  const dispatchNode = appendRunNode(
    run,
    createStateNode({
      id: `${run.id}:dispatch:${dispatchId}`,
      kind: "dispatch",
      status: "running",
      loopStage: "act",
      inputs: { taskIds: tasks.map((task) => task.id), phase: manifest.phase, sandboxProfileId: manifest.sandboxProfileId },
      outputs: { dispatchId, sandboxProfileId: manifest.sandboxProfileId },
      artifacts: [{ id: "dispatch", kind: "json", path: manifestPath }],
      parents: tasks.map((task) => `${run.id}:task:${task.id}`),
      contractId: DEFAULT_PIPELINE_CONTRACT_ID,
      metadata: { sandboxProfileId: manifest.sandboxProfileId, sandboxPolicy: manifest.sandboxPolicy }
    })
  );
  manifest.stateNodeId = dispatchNode.id;

  for (const task of run.tasks) {
    if (!taskIds.has(task.id) || !task.stateNodeId) continue;
    const node = run.nodes?.find((candidate) => candidate.id === task.stateNodeId);
    if (node && node.status === "pending") {
      appendRunNode(run, transitionStateNode(node, { status: "running", loopStage: "act" }));
    }
  }

  run.dispatches.push({
    id: dispatchId,
    phase: manifest.phase || "",
    taskIds: tasks.map((task) => task.id),
    manifestPath,
    createdAt,
    stateNodeId: dispatchNode.id,
    workerIds: run.tasks.filter((task) => taskIds.has(task.id) && task.workerId).map((task) => String(task.workerId)),
    sandboxProfileId: manifest.sandboxProfileId
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
    prompt: task.prompt,
    workerId: task.workerId,
    workerManifestPath: task.workerManifestPath,
    workerDir: task.workerManifestPath ? path.dirname(task.workerManifestPath) : undefined,
    workerResultPath: task.workerId && task.workerManifestPath ? path.join(path.dirname(task.workerManifestPath), "result.md") : undefined,
    sandboxProfileId: task.sandboxProfileId,
    sandboxPolicy: task.sandboxPolicy
  };
}

function createDispatchId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  return `dispatch-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}
