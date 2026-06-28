import fs from "node:fs";
import path from "node:path";
import { DispatchManifest, DispatchTask, ResolvedSandboxPolicy, RunPhase, RunTask, SandboxProfileDefinition, WorkflowRun } from "./types";
import { writeJson } from "./state";
import { DEFAULT_PIPELINE_CONTRACT_ID } from "./pipeline-contract";
import { appendRunNode, createStateNode, transitionStateNode } from "./state-node";
import { allocateWorkerScope, syncWorkerScopeFromTask, writeWorkerManifest } from "./worker-isolation";
import {
  DEFAULT_SANDBOX_PROFILE_ID,
  isBundledSandboxProfileId,
  resolveSandboxProfileById,
  sandboxContextForValidation,
  validateSandboxProfileFile
} from "./sandbox-profile";
import { resolveBackendSelection } from "./execution-backend";
import { attachDispatchToMultiAgent } from "./multi-agent";

export interface DispatchOptions {
  sandboxProfileId?: string;
  sandbox?: string;
  backendId?: string;
  multiAgentRunId?: string;
  multiAgentGroupId?: string;
  multiAgentRoleId?: string;
  multiAgentFanoutId?: string;
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
  // H7: if the requested profile is a CUSTOM profile loaded from a FILE (non-bundled,
  // existing file), persist its DEFINITION on run.customSandboxProfiles keyed by the
  // definition's logical id. This makes the custom profile durable with run state so a
  // worker boundary can re-resolve it by logical id after a scope snapshot is lost
  // (re-resolving against the worker context, not the dispatch-time file path).
  persistCustomSandboxProfile(run, sandboxProfileId);
  // Resolve the execution backend once (mechanism vs policy): the kernel records
  // WHICH backend was selected; it never branches on which one. Defaults to node
  // (behavior-preserving) when no `--backend` flag / CW_BACKEND env is set.
  const backendSelection = resolveBackendSelection(options.backendId);
  const tasks = nextDispatchTasks(run, limit);
  if (!tasks.length) {
    return {
      schemaVersion: 1,
      runId: run.id,
      dispatchId: null,
      tasks: [],
      manifestPath: null,
      sandboxProfileId,
      backendId: backendSelection.backendId,
      backendSelection
    };
  }

  const dispatchId = createDispatchId(run);
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
        backendSelection,
        status: "running",
        persist: false,
        metadata: { dispatchId, phase: task.phase }
      });
      sandboxPolicy = sandboxPolicy || scope.sandboxPolicy;
    }
  }

  const selectedRunTasks = run.tasks.filter((task) => taskIds.has(task.id));
  const multiAgentAttachment = attachDispatchToMultiAgent(run, {
    multiAgentRunId: options.multiAgentRunId,
    groupId: options.multiAgentGroupId,
    roleId: options.multiAgentRoleId,
    fanoutId: options.multiAgentFanoutId,
    dispatchId,
    tasks: selectedRunTasks,
    sandboxProfileId: selectedSandboxProfileIds.size === 1 ? [...selectedSandboxProfileIds][0] : "mixed",
    concurrencyLimit: limit
  });
  for (const task of selectedRunTasks) {
    const worker = task.workerId ? syncWorkerScopeFromTask(run, task.workerId) : undefined;
    if (worker) writeWorkerManifest(run, worker);
  }

  const manifest: DispatchManifest = {
    schemaVersion: 1,
    runId: run.id,
    dispatchId,
    createdAt,
    phase: tasks[0].phase,
    instructions:
      "Spawn one worker per task when the user explicitly authorized agent/parallel/background work. Save each final summary as Markdown and record it with `cw.js result <run-id> <task-id> <file>`.",
    tasks: selectedRunTasks.map(formatDispatchTask),
    manifestPath,
    workerIndexPath: run.paths.workersDir ? path.join(run.paths.workersDir, "index.json") : undefined,
    sandboxProfileId: selectedSandboxProfileIds.size === 1 ? [...selectedSandboxProfileIds][0] : "mixed",
    sandboxPolicy: selectedSandboxProfileIds.size === 1 ? sandboxPolicy : undefined,
    backendId: backendSelection.backendId,
    backendSelection,
    backendAttestation: selectedRunTasks.find((task) => task.backendAttestation)?.backendAttestation,
    multiAgent: multiAgentAttachment.multiAgent
      ? {
          ...multiAgentAttachment.multiAgent,
          membershipIds: multiAgentAttachment.membershipIds
        }
      : undefined
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
      workerIds: selectedRunTasks.filter((task) => task.workerId).map((task) => String(task.workerId)),
      sandboxProfileId: manifest.sandboxProfileId,
      backendId: backendSelection.backendId,
      multiAgent: manifest.multiAgent
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
    sandboxPolicy: task.sandboxPolicy,
    backendId: task.backendId,
    backendAttestation: task.backendAttestation,
    multiAgent: task.multiAgent
  };
}

// Deterministic dispatch id (replay-determinism self-audit): the wall-clock stamp
// is an edge timestamp for human readability. Set CW_DETERMINISTIC_RUN_IDS=1 to
// use a content-hash-based id without wall-clock, so re-running the same workflow
// yields byte-identical dispatch ids. The suffix is a per-run sequence, so each
// dispatch still gets a distinct, monotonically increasing id.
function createDispatchId(run: WorkflowRun): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const seq = (run.dispatches?.length || 0) + 1;
  if (/^(1|true|yes|on)$/i.test(process.env.CW_DETERMINISTIC_RUN_IDS || "")) {
    return `dispatch-${String(seq).padStart(4, "0")}`;
  }
  return `dispatch-${stamp}-${String(seq).padStart(4, "0")}`;
}

// H7: persist a CUSTOM sandbox profile DEFINITION (loaded from a FILE at dispatch)
// onto run.customSandboxProfiles, keyed by the definition's logical id. Only fires
// for a non-bundled id that resolves to a readable, valid profile file. The
// resolveSandboxProfileById call above has already validated the file (it throws on
// invalid), so this re-parses only to recover the raw DEFINITION — we store the
// definition (not a resolved policy) so worker-specific path tokens re-bind to the
// correct worker context on every later re-resolve. Bundled ids and unknown ids are
// left untouched, so this never shadows a bundled profile or masks a fail-closed.
function persistCustomSandboxProfile(run: WorkflowRun, requested: string): void {
  if (!requested || isBundledSandboxProfileId(requested)) return;
  const absolute = path.resolve(requested);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return;
  const validation = validateSandboxProfileFile(requested, sandboxContextForValidation(run.cwd));
  if (!validation.valid || !validation.profile) return;
  let definition: SandboxProfileDefinition;
  try {
    definition = JSON.parse(fs.readFileSync(absolute, "utf8")) as SandboxProfileDefinition;
  } catch {
    return;
  }
  if (!definition || typeof definition !== "object" || typeof definition.id !== "string" || !definition.id) return;
  run.customSandboxProfiles = run.customSandboxProfiles || {};
  const previous = run.customSandboxProfiles[definition.id];
  if (previous && JSON.stringify(previous) !== JSON.stringify(definition)) {
    throw new Error(
      `Sandbox profile id collision: "${definition.id}" is already defined by a different custom profile ` +
      `(source: ${absolute}). Use a unique id in each custom profile file.`
    );
  }
  run.customSandboxProfiles[definition.id] = definition;
}
