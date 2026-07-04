// shell/dispatch.ts — createDispatchManifest: the imperative wrapper
// around core/pipeline/dispatch.ts's pure decision helpers.
//
// MILESTONE 6+7 (combined). Byte-exact port of the old build's
// src/dispatch.ts's IO half (worker-scope allocation, manifest file
// write, state-node append). Multi-agent attachment and custom sandbox
// profile persistence at dispatch (H7) are milestone 9's scope and are
// no-ops here.
//
// Evidence: SPEC/pipeline-run.md "Dispatch — src/dispatch.ts".

import * as fs from "node:fs";
import * as path from "node:path";
import { WorkflowRun } from "../core/state/types";
import { formatDispatchId, formatDispatchTask, nextDispatchTasks, updatePhaseStatuses } from "../core/pipeline/dispatch";
import type { DispatchTask } from "../core/pipeline/dispatch";
import { DEFAULT_PIPELINE_CONTRACT_ID } from "../core/pipeline/contract";
import { createStateNode, transitionStateNode } from "../core/state/state-node";
import { appendRunNode, writeRunNode } from "./node-store";
import { writeJson } from "./fs-atomic";
import { allocateWorkerScope, writeWorkerManifest, getWorkerScope } from "./worker-isolation";
import { resolveBackendSelection } from "./execution-backend/registry";
import { DEFAULT_SANDBOX_PROFILE_ID, resolveSandboxProfileById, sandboxContextForValidation } from "./sandbox-profile";
import { BackendSelection, ResolvedSandboxPolicy, SandboxAttestation } from "./execution-backend/types";

export interface DispatchManifest {
  schemaVersion: 1;
  runId: string;
  dispatchId: string | null;
  createdAt?: string;
  phase?: string;
  instructions?: string;
  tasks: DispatchTask[];
  manifestPath: string | null;
  stateNodeId?: string;
  workerIndexPath?: string;
  sandboxProfileId: string;
  sandboxPolicy?: ResolvedSandboxPolicy;
  backendId: string;
  backendSelection: BackendSelection;
  backendAttestation?: SandboxAttestation;
}

export interface DispatchOptions {
  sandboxProfileId?: string;
  backendId?: string;
}

export function createDispatchManifest(run: WorkflowRun, limit?: number, options: DispatchOptions = {}): DispatchManifest {
  const sandboxProfileId = String(options.sandboxProfileId || DEFAULT_SANDBOX_PROFILE_ID);
  resolveSandboxProfileById(sandboxProfileId, sandboxContextForValidation(run.cwd));
  const backendSelection = resolveBackendSelection(options.backendId);
  const tasks = nextDispatchTasks(run, limit);

  if (!tasks.length) {
    return { schemaVersion: 1, runId: run.id, dispatchId: null, tasks: [], manifestPath: null, sandboxProfileId, backendId: backendSelection.backendId, backendSelection };
  }

  const now = new Date().toISOString();
  const dispatchId = formatDispatchId((run.dispatches?.length || 0) + 1, now, /^(1|true|yes|on)$/i.test(process.env.CW_DETERMINISTIC_RUN_IDS || ""));
  const manifestPath = path.join(run.paths.dispatchesDir, `${dispatchId}.json`);
  fs.mkdirSync(run.paths.dispatchesDir, { recursive: true });
  const taskIds = new Set(tasks.map((t) => t.id));

  let sandboxPolicy: ResolvedSandboxPolicy | undefined;
  let backendAttestation: SandboxAttestation | undefined;
  for (const task of run.tasks) {
    if (!taskIds.has(task.id)) continue;
    const taskSandboxProfileId = String(options.sandboxProfileId || task.sandboxProfileId || DEFAULT_SANDBOX_PROFILE_ID);
    task.status = "running";
    task.loopStage = "act";
    task.dispatchId = dispatchId;
    task.dispatchedAt = now;
    const scope = allocateWorkerScope(run, task, { dispatchId, sandboxProfileId: taskSandboxProfileId, backendId: backendSelection.backendId, status: "running", metadata: { dispatchId, phase: task.phase } });
    sandboxPolicy = sandboxPolicy || scope.sandboxPolicy;
    backendAttestation = backendAttestation || scope.backendAttestation;
  }

  const selectedRunTasks = run.tasks.filter((t) => taskIds.has(t.id));
  for (const task of selectedRunTasks) {
    const worker = task.workerId ? getWorkerScope(run, String(task.workerId)) : undefined;
    if (worker) writeWorkerManifest(run, worker);
  }

  const dispatchNode = appendRunNode(
    run,
    createStateNode({
      id: `${run.id}:dispatch:${dispatchId}`,
      kind: "dispatch",
      status: "running",
      loopStage: "act",
      inputs: { taskIds: tasks.map((t) => t.id), phase: tasks[0].phase, sandboxProfileId },
      outputs: { dispatchId, sandboxProfileId },
      artifacts: [{ id: "dispatch", kind: "json", path: manifestPath }],
      parents: tasks.map((t) => `${run.id}:task:${t.id}`),
      contractId: DEFAULT_PIPELINE_CONTRACT_ID,
      metadata: { sandboxProfileId, sandboxPolicy },
    })
  );

  for (const task of run.tasks) {
    if (!taskIds.has(task.id) || !task.stateNodeId) continue;
    const node = (run.nodes || []).find((n) => n.id === task.stateNodeId);
    if (node && node.status === "pending") {
      appendRunNode(run, transitionStateNode(node, { status: "running", loopStage: "act" }));
    }
  }

  run.dispatches.push({ id: dispatchId, phase: tasks[0].phase || "", taskIds: tasks.map((t) => t.id), manifestPath, createdAt: now, stateNodeId: dispatchNode.id, workerIds: selectedRunTasks.filter((t) => t.workerId).map((t) => String(t.workerId)), sandboxProfileId, backendId: backendSelection.backendId });
  updatePhaseStatuses(run);

  const manifest: DispatchManifest = {
    schemaVersion: 1,
    runId: run.id,
    dispatchId,
    createdAt: now,
    phase: tasks[0].phase,
    instructions: "Spawn one worker per task when the user explicitly authorized agent/parallel/background work. Save each final summary as Markdown and record it with `cw.js result <run-id> <task-id> <file>`.",
    tasks: selectedRunTasks.map(formatDispatchTask),
    manifestPath,
    stateNodeId: dispatchNode.id,
    workerIndexPath: run.paths.workersDir ? path.join(run.paths.workersDir, "index.json") : undefined,
    sandboxProfileId,
    sandboxPolicy,
    backendId: backendSelection.backendId,
    backendSelection,
    backendAttestation,
  };
  writeJson(manifestPath, manifest);
  return manifest;
}

export { writeRunNode };
