import fs from "node:fs";
import path from "node:path";
import {
  RunTask,
  StateNodeError,
  WorkerBoundaryViolation,
  WorkerIsolationOptions,
  WorkerIsolationStatus,
  WorkerManifest,
  WorkerOutputRecord,
  WorkerScope,
  WorkflowRun
} from "./types";
import { safeFileName, saveCheckpoint, writeJson } from "./state";
import { DEFAULT_PIPELINE_CONTRACT_ID } from "./pipeline-contract";
import { recordFeedback } from "./error-feedback";
import { appendRunNode, createStateNode, linkStateNodes, recordNodeError } from "./state-node";
import {
  DEFAULT_SANDBOX_PROFILE_ID,
  effectiveSandboxWritePaths,
  sandboxPolicyForWorker,
  upsertRunSandboxPolicy,
  validateSandboxWrite
} from "./sandbox-profile";
import { attestSandbox, getBackendDescriptor, resolveBackendSelection } from "./execution-backend";
import { recordTrustAuditEvent } from "./trust-audit";
import {
  compactMetadata,
  countBy,
  isBoundaryViolation,
  isStateNodeError,
  mergeScopes,
  structuredError,
  unique
} from "./worker-isolation/helpers";
import {
  WORKER_MANIFEST_FILE,
  WORKER_SCOPE_FILE,
  createWorkerId,
  manifestPath,
  workerArtifacts,
  workerScopePath
} from "./worker-isolation/paths";
import { validateWorkerScope } from "./validation";
import { acceptWorkerResult } from "./worker-accept/acceptance";
import { blackboardLinkage } from "./worker-accept/blackboard-linkage";
import { fanOutWorkerOutput } from "./worker-accept/blackboard-fanout";
import { attestWorkerDelegation, recordWorkerDelegationLedger } from "./worker-accept/telemetry-ledger";
import { validateWorkerResult } from "./worker-accept/validation";
import { recordWorkerCompletion, runWorkerVerify } from "./worker-accept/verifier-completion";

export const WORKER_ISOLATION_SCHEMA_VERSION = 1;

export interface RecordWorkerFailureOptions extends WorkerIsolationOptions {
  code?: string;
  path?: string;
  retryable?: boolean;
  retryCount?: number;
}

export function allocateWorkerScope(
  run: WorkflowRun,
  task: RunTask,
  options: WorkerIsolationOptions = {}
): WorkerScope {
  ensureWorkerState(run);
  const existing = task.workerId ? getWorkerScope(run, task.workerId) : undefined;
  if (existing) {
    // Retry detection: re-allocating a worker for the same task
    if (existing.status === "failed" || existing.status === "orphaned") {
      existing.retryCount = (existing.retryCount || 0) + 1;
      existing.updatedAt = new Date().toISOString();
      existing.status = options.status || "allocated";
      existing.errors = [];
      upsertWorkerScope(run, existing);
      writeWorkerIndex(run);
    }
    return existing;
  }

  const now = new Date().toISOString();
  const workerId = options.workerId || createWorkerId(run, task.id);
  const workerDir = path.join(workerRoot(run), safeFileName(workerId));
  const inputPath = path.join(workerDir, "input.md");
  const resultPath = path.join(workerDir, "result.md");
  const artifactsDir = path.join(workerDir, "artifacts");
  const logsDir = path.join(workerDir, "logs");
  const sandboxProfileId = options.sandboxProfileId || options.policy?.sandboxProfileId || DEFAULT_SANDBOX_PROFILE_ID;
  const sandboxPolicy = sandboxPolicyForWorker(sandboxProfileId, {
    cwd: run.cwd,
    runDir: run.paths.runDir,
    workerDir,
    inputPath,
    resultPath,
    artifactsDir,
    logsDir,
    extraReadPaths: options.policy?.readPaths || [],
    extraWritePaths: [...(options.policy?.writePaths || []), ...(options.policy?.allowedPaths || [])],
    allowArtifacts: options.policy?.allowArtifacts,
    allowLogs: options.policy?.allowLogs,
    // H7: persisted custom profile definitions so a custom logical id resolves
    // against THIS worker's context (worker-specific path tokens bind correctly).
    customProfiles: run.customSandboxProfiles
  });
  const allowedPaths = effectiveSandboxWritePaths(sandboxPolicy);
  upsertRunSandboxPolicy(run, sandboxPolicy);

  // Execution backend selection (mechanism vs policy): the worker scope records
  // WHICH backend was selected + its sandbox attestation. The dispatch path is a
  // delegate-host execution (the host runs the worker), so the backend enforces
  // only CW's own worker-output acceptance and attests the rest — reproducing
  // pre-v0.1.29 behavior exactly for the default (node) backend. Only recorded
  // when a backend was explicitly selected.
  const backendSelection =
    options.backendSelection || (options.backendId ? resolveBackendSelection(options.backendId) : undefined);
  const backendId = backendSelection?.backendId;
  const backendAttestation = backendId
    ? options.backendAttestation || attestSandbox(getBackendDescriptor(backendId), sandboxPolicy, { mode: "delegate-host" })
    : undefined;

  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  const scope: WorkerScope = {
    schemaVersion: WORKER_ISOLATION_SCHEMA_VERSION,
    id: workerId,
    runId: run.id,
    taskId: task.id,
    dispatchId: options.dispatchId || task.dispatchId,
    createdAt: now,
    updatedAt: now,
    status: options.status || "allocated",
    workerDir,
    inputPath,
    resultPath,
    artifactsDir,
    logsDir,
    allowedPaths,
    sandboxProfileId: sandboxPolicy.id,
    sandboxPolicy,
    backendId,
    backendSelection,
    backendAttestation,
    stateNodeId: task.stateNodeId,
    feedbackIds: [],
    errors: [],
    multiAgent: options.multiAgent,
    metadata: compactMetadata({
      ...options.metadata,
      multiAgent: options.multiAgent,
      phase: task.phase,
      kind: task.kind,
      taskPath: task.taskPath
    })
  };

  writeWorkerInput(run, task, scope);
  writeWorkerManifest(run, scope);
  upsertWorkerScope(run, scope);
  recordTrustAuditEvent(run, {
    kind: "worker.sandbox-profile",
    decision: "recorded",
    source: "runtime-derived",
    workerId: scope.id,
    taskId: task.id,
    sandboxProfileId: sandboxPolicy.id,
    policySnapshot: sandboxPolicy,
    metadata: { dispatchId: scope.dispatchId, workerDir: scope.workerDir, allowedPaths }
  });
  if (backendId && backendAttestation) {
    recordTrustAuditEvent(run, {
      kind: "worker.backend",
      decision: backendAttestation.status === "refused" ? "denied" : "recorded",
      source: "runtime-derived",
      workerId: scope.id,
      taskId: task.id,
      sandboxProfileId: sandboxPolicy.id,
      policySnapshot: sandboxPolicy,
      metadata: {
        backendId,
        backendSelection,
        attestationStatus: backendAttestation.status,
        enforced: backendAttestation.enforced,
        attested: backendAttestation.attested,
        unenforceable: backendAttestation.unenforceable,
        dispatchId: scope.dispatchId
      }
    });
  }
  task.workerId = scope.id;
  task.workerManifestPath = manifestPath(scope);
  task.sandboxProfileId = sandboxPolicy.id;
  task.sandboxPolicy = sandboxPolicy;
  task.backendId = backendId;
  task.backendSelection = backendSelection;
  task.backendAttestation = backendAttestation;
  writeWorkerIndex(run);
  if (options.persist !== false) saveCheckpoint(run);
  return scope;
}

export function writeWorkerManifest(run: WorkflowRun, scope: WorkerScope): WorkerManifest {
  const task = run.tasks.find((candidate) => candidate.id === scope.taskId);
  const sandboxPolicy = scope.sandboxPolicy || sandboxPolicyForBoundary(run, scope);
  const sandboxProfileId = scope.sandboxProfileId || sandboxPolicy.id;
  const scopePath = workerScopePath(scope);
  const workerManifestPath = manifestPath(scope);
  const manifest: WorkerManifest = {
    schemaVersion: WORKER_ISOLATION_SCHEMA_VERSION,
    id: scope.id,
    runId: scope.runId,
    taskId: scope.taskId,
    dispatchId: scope.dispatchId,
    createdAt: scope.createdAt,
    updatedAt: scope.updatedAt,
    status: scope.status,
    workerDir: scope.workerDir,
    scopePath,
    manifestPath: workerManifestPath,
    inputPath: scope.inputPath,
    resultPath: scope.resultPath,
    artifactsDir: scope.artifactsDir,
    logsDir: scope.logsDir,
    allowedPaths: scope.allowedPaths,
    sandboxProfileId,
    sandboxPolicy,
    sandbox: sandboxPolicy
      ? {
          profileId: sandboxPolicy.id,
          policy: sandboxPolicy,
          enforcedByCW: sandboxPolicy.enforcement.enforcedByCW,
          hostRequired: sandboxPolicy.enforcement.hostRequired
        }
      : undefined,
    backendId: scope.backendId,
    backendSelection: scope.backendSelection,
    backendAttestation: scope.backendAttestation,
    retryCount: scope.retryCount,
    backend:
      scope.backendId && scope.backendAttestation
        ? {
            id: scope.backendId,
            locality: scope.backendAttestation.locality,
            kind: scope.backendAttestation.kind,
            enforces: scope.backendAttestation.enforced,
            attests: scope.backendAttestation.attested,
            attestation: scope.backendAttestation
          }
        : undefined,
    instructions: [
      "Read input.md before doing work.",
      "Write the final Markdown result to result.md.",
      "Write worker-local artifacts under artifacts/ and logs under logs/.",
      `Sandbox profile: ${sandboxProfileId}.`,
      "CW enforces profile validation and worker result acceptance only.",
      "The agent host must enforce OS file access, process execution, network access, and environment filtering.",
      "Do not edit shared run state files directly; CW records accepted results."
    ],
    taskPath: task?.taskPath,
    prompt: task?.prompt,
    stateNodeId: scope.stateNodeId,
    resultNodeId: scope.resultNodeId,
    feedbackIds: scope.feedbackIds,
    errors: scope.errors,
    output: scope.output,
    multiAgent: scope.multiAgent,
    blackboard: blackboardManifest(run, scope),
    metadata: scope.metadata
  };
  writeJson(workerManifestPath, manifest);
  return manifest;
}

export function syncWorkerScopeFromTask(run: WorkflowRun, workerId: string): WorkerScope | undefined {
  const scope = getWorkerScope(run, workerId);
  if (!scope) return undefined;
  const task = run.tasks.find((candidate) => candidate.id === scope.taskId);
  if (!task?.multiAgent) return scope;
  const updated: WorkerScope = {
    ...scope,
    updatedAt: new Date().toISOString(),
    multiAgent: task.multiAgent,
    metadata: compactMetadata({
      ...(scope.metadata || {}),
      multiAgent: task.multiAgent
    })
  };
  return updateWorkerScope(run, updated);
}

export function listWorkerScopes(run: WorkflowRun, options: { status?: WorkerScope["status"] } = {}): WorkerScope[] {
  ensureWorkerState(run);
  const scopes = loadWorkerScopesFromDisk(run);
  run.workers = mergeScopes(run.workers || [], scopes);
  const listed = run.workers || [];
  return options.status ? listed.filter((scope) => scope.status === options.status) : listed;
}

export function getWorkerScope(run: WorkflowRun, workerId: string): WorkerScope | undefined {
  ensureWorkerState(run);
  const existing = (run.workers || []).find((scope) => scope.id === workerId);
  if (existing) return existing;
  const file = path.join(workerRoot(run), safeFileName(workerId), WORKER_SCOPE_FILE);
  if (!fs.existsSync(file)) return undefined;
  let scope: WorkerScope;
  try {
    scope = validateWorkerScope(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (error) {
    // A present-but-corrupt scope fails closed with context, not a raw
    // SyntaxError/validation throw bubbling up from deep in the call stack.
    throw new Error(`Corrupt worker scope ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  upsertWorkerScope(run, scope);
  return scope;
}

export function recordWorkerOutput(
  run: WorkflowRun,
  workerId: string,
  resultPath: string,
  options: WorkerIsolationOptions = {}
): WorkerOutputRecord {
  // Accept-path orchestrator. The recorded order + side effects of these ordered
  // steps are load-bearing (replay determinism + the hash-chained audit/telemetry
  // ledgers cross-link by parent event ids), so each helper runs exactly where it
  // did before and mutates the shared `accept` context in place. Do NOT reorder.
  const accept = validateWorkerResult(run, workerId, resultPath, options, {
    requireWorkerScope,
    requireWorkerTask,
    validateWorkerBoundary,
    recordWorkerFailure
  });
  const delegation = attestWorkerDelegation(accept, { recordWorkerFailure });
  acceptWorkerResult(accept, delegation);
  recordWorkerDelegationLedger(accept, delegation);
  runWorkerVerify(accept);
  recordWorkerCompletion(accept, delegation, { updateWorkerScope });
  fanOutWorkerOutput(accept);
  if (options.persist !== false) saveCheckpoint(run);
  return accept.output;
}

export function recordWorkerFailure(
  run: WorkflowRun,
  workerId: string,
  error: unknown,
  options: RecordWorkerFailureOptions = {}
): WorkerScope {
  const scope = requireWorkerScope(run, workerId);
  const task = requireWorkerTask(run, scope);
  const structured = normalizeWorkerError(error, scope, options);
  const failureNodeId = `${run.id}:worker:${safeFileName(workerId)}:failure:${scope.errors.length + 1}`;
  let failureNode = recordNodeError(
    createStateNode({
      id: failureNodeId,
      kind: "error",
      status: "pending",
      loopStage: "adjust",
      inputs: { workerId, taskId: task.id, dispatchId: scope.dispatchId },
      artifacts: workerArtifacts(scope),
      parents: task.stateNodeId ? [task.stateNodeId] : [],
      contractId: DEFAULT_PIPELINE_CONTRACT_ID,
      metadata: { workerId, taskId: task.id, dispatchId: scope.dispatchId, workerDir: scope.workerDir, sandboxProfileId: scope.sandboxProfileId }
    }),
    structured
  );
  if (task.stateNodeId) {
    const parent = run.nodes?.find((candidate) => candidate.id === task.stateNodeId);
    if (parent) {
      const linked = linkStateNodes(parent, failureNode);
      appendRunNode(run, linked[0]);
      failureNode = linked[1];
    }
  }
  appendRunNode(run, failureNode);
  task.status = "failed";
  task.loopStage = "adjust";
  const feedback = recordFeedback(
    run,
    {
      source: "pipeline-runner",
      error: structured,
      nodeId: failureNode.id,
      taskId: task.id,
      path: structured.path,
      retryable: structured.retryable,
      artifacts: failureNode.artifacts,
      metadata: {
        workerId,
        dispatchId: scope.dispatchId,
        workerDir: scope.workerDir,
        sandboxProfileId: scope.sandboxProfileId,
        sandboxPolicy: scope.sandboxPolicy,
        allowedPaths: scope.allowedPaths,
        details: structured.details
      }
    },
    { persist: false }
  );
  recordTrustAuditEvent(run, {
    kind: "worker.failure",
    decision: structured.code === "worker-boundary-violation" || structured.code.startsWith("sandbox-") ? "denied" : "failed",
    source: structured.code.startsWith("sandbox-") || structured.code === "worker-boundary-violation" ? "cw-validated" : "runtime-derived",
    workerId,
    taskId: task.id,
    nodeId: failureNode.id,
    feedbackIds: [feedback.id],
    sandboxProfileId: scope.sandboxProfileId,
    policySnapshot: scope.sandboxPolicy,
    normalizedPath: structured.path,
    metadata: {
      code: structured.code,
      dispatchId: scope.dispatchId
    }
  });
  updateWorkerScope(run, {
    ...scope,
    updatedAt: new Date().toISOString(),
    status: structured.code === "worker-boundary-violation" || structured.code.startsWith("sandbox-") ? "rejected" : "failed",
    retryCount: typeof options.retryCount === "number" ? options.retryCount : scope.retryCount,
    feedbackIds: unique([...(scope.feedbackIds || []), feedback.id]),
    errors: [...(scope.errors || []), structured]
  });
  if (options.persist !== false) saveCheckpoint(run);
  return requireWorkerScope(run, workerId);
}

export function recordWorkerRetryAttempt(
  run: WorkflowRun,
  workerId: string,
  attempts: number,
  reason: string,
  options: WorkerIsolationOptions = {}
): WorkerScope {
  const scope = requireWorkerScope(run, workerId);
  const updated = updateWorkerScope(run, {
    ...scope,
    updatedAt: new Date().toISOString(),
    retryCount: attempts,
    metadata: compactMetadata({
      ...scope.metadata,
      agentDelegationAttempts: attempts,
      agentDelegationLastFailure: reason
    })
  });
  if (options.persist !== false) saveCheckpoint(run);
  return updated;
}

export function validateWorkerBoundary(
  run: WorkflowRun,
  workerId: string,
  options: WorkerIsolationOptions & { path?: string } = {}
): WorkerBoundaryViolation | null {
  const scope = requireWorkerScope(run, workerId);
  const rawPath = String(options.path || scope.resultPath);
  const policy = sandboxPolicyForBoundary(run, scope, options);
  const violation = validateSandboxWrite(policy, rawPath, workerId);
  if (!violation) {
    // Write paths are enforced by CW at this boundary. Command and network limits
    // are declared in the sandbox policy but enforced by the execution backend
    // (the host/container runtime). Record the policy split transparently so the
    // audit trail shows what CW checked vs what was delegated to the host.
    recordTrustAuditEvent(run, {
      kind: "worker.sandbox-boundary",
      decision: "allowed",
      source: "cw-validated",
      workerId,
      taskId: scope.taskId,
      sandboxProfileId: policy.id,
      policyRef: `execute=${policy.execute.mode} network=${policy.network.mode} env.inherit=${policy.env.inherit}`,
      command: policy.execute.mode,
      networkTarget: policy.network.mode,
      metadata: {
        enforced_by_cw: ["write-paths"],
        delegated_to_host: ["execute", "network", "env"],
        env_inherit: policy.env.inherit
      }
    });
  }
  return violation;
}

export function summarizeWorkers(run: WorkflowRun): {
  total: number;
  byStatus: Record<string, number>;
  manifestPaths: string[];
  failed: Array<{ id: string; status: string; feedbackIds: string[] }>;
} {
  const workers = listWorkerScopes(run);
  return {
    total: workers.length,
    byStatus: countBy(workers, (scope) => scope.status),
    manifestPaths: workers.map(manifestPath),
    failed: workers
      .filter((scope) => scope.status === "failed" || scope.status === "rejected")
      .map((scope) => ({ id: scope.id, status: scope.status, feedbackIds: scope.feedbackIds || [] }))
  };
}

// ---- Worker orphan reclamation (v0.1.57) ----------------------------------
// BSD discipline (jails): stuck processes get killed. Workers with a timeout
// that have been running too long are marked as `orphaned`. The caller can
// then decide whether to retry or park. Reclamation is deterministic: pure
// function of current time + worker state.

export interface ReclaimOrphansResult {
  runId: string;
  reclaimed: number;
  orphans: Array<{ workerId: string; taskId: string; elapsedMs: number; timeoutMs: number }>;
}

export function reclaimOrphans(run: WorkflowRun, now?: string): ReclaimOrphansResult {
  const nowMs = now ? Date.parse(now) : Date.now();
  if (!Number.isFinite(nowMs)) throw new Error("Invalid reclaim 'now': " + String(now));
  const orphans: ReclaimOrphansResult["orphans"] = [];
  const activeStatuses = new Set<WorkerIsolationStatus>(["allocated", "running"]);
  for (const scope of run.workers || []) {
    if (!activeStatuses.has(scope.status)) continue;
    if (!scope.timeoutMs || scope.timeoutMs <= 0) continue;
    const createdAtMs = Date.parse(scope.createdAt);
    if (!Number.isFinite(createdAtMs)) continue;
    const elapsedMs = nowMs - createdAtMs;
    if (elapsedMs < scope.timeoutMs) continue;
    scope.status = "orphaned";
    scope.updatedAt = new Date(nowMs).toISOString();
    scope.errors.push({
      code: "worker-orphaned",
      message: `Worker exceeded timeout of ${scope.timeoutMs}ms (elapsed: ${elapsedMs}ms).`,
      at: new Date(nowMs).toISOString(),
      retryable: true
    });
    upsertWorkerScope(run, scope);
    orphans.push({ workerId: scope.id, taskId: scope.taskId, elapsedMs, timeoutMs: scope.timeoutMs });
  }
  if (orphans.length) {
    writeWorkerIndex(run);
  }
  return { runId: run.id, reclaimed: orphans.length, orphans };
}

function ensureWorkerState(run: WorkflowRun): void {
  run.paths.workersDir = run.paths.workersDir || path.join(run.paths.runDir, "workers");
  fs.mkdirSync(run.paths.workersDir, { recursive: true });
  run.workers = run.workers || [];
}

function writeWorkerInput(run: WorkflowRun, task: RunTask, scope: WorkerScope): void {
  const lines = [
    `# Worker ${scope.id}`,
    "",
    `- Run: ${run.id}`,
    `- Task: ${task.id}`,
    `- Dispatch: ${scope.dispatchId || ""}`,
    `- Result: ${scope.resultPath}`,
    `- Artifacts: ${scope.artifactsDir}`,
    `- Logs: ${scope.logsDir}`,
    `- Sandbox Profile: ${scope.sandboxProfileId || DEFAULT_SANDBOX_PROFILE_ID}`,
    ...(scope.multiAgent
      ? [
          `- Multi-Agent Run: ${scope.multiAgent.runId}`,
          `- Agent Group: ${scope.multiAgent.groupId}`,
          `- Agent Role: ${scope.multiAgent.roleId}`,
          `- Agent Membership: ${scope.multiAgent.membershipId || ""}`,
          `- Agent Fanout: ${scope.multiAgent.fanoutId || ""}`
        ]
      : []),
    "",
    "## Task",
    "",
    task.prompt,
    "",
    "## Boundary",
    "",
    "- Write the final Markdown result to result.md.",
    "- Keep extra files under artifacts/ or logs/.",
    `- Read paths: ${(scope.sandboxPolicy?.readPaths || []).join(", ") || "none"}.`,
    `- Write paths: ${effectiveSandboxWritePaths(sandboxPolicyForBoundary(run, scope)).join(", ") || "none"}.`,
    "- CW enforces result acceptance. The host is responsible for OS/process/network/environment sandbox enforcement.",
    "- Do not mutate state.json, nodes/, feedback/, dispatches/, or commits/ directly.",
    ""
  ];
  fs.writeFileSync(scope.inputPath, lines.join("\n"), "utf8");
}

function upsertWorkerScope(run: WorkflowRun, scope: WorkerScope): WorkerScope {
  ensureWorkerState(run);
  const scopes = run.workers || [];
  const index = scopes.findIndex((candidate) => candidate.id === scope.id);
  run.workers = index >= 0 ? scopes.map((candidate) => (candidate.id === scope.id ? scope : candidate)) : [...scopes, scope];
  writeWorkerScope(scope);
  return scope;
}

function updateWorkerScope(run: WorkflowRun, scope: WorkerScope): WorkerScope {
  const updated = upsertWorkerScope(run, scope);
  writeWorkerManifest(run, updated);
  writeWorkerIndex(run);
  return updated;
}

function writeWorkerScope(scope: WorkerScope): void {
  writeJson(workerScopePath(scope), scope);
}

function writeWorkerIndex(run: WorkflowRun): void {
  ensureWorkerState(run);
  writeJson(path.join(workerRoot(run), "index.json"), {
    schemaVersion: WORKER_ISOLATION_SCHEMA_VERSION,
    runId: run.id,
    workers: (run.workers || []).map((scope) => ({
      id: scope.id,
      taskId: scope.taskId,
      dispatchId: scope.dispatchId,
      status: scope.status,
      workerDir: scope.workerDir,
      manifestPath: manifestPath(scope),
      resultPath: scope.resultPath,
      sandboxProfileId: scope.sandboxProfileId,
      backendId: scope.backendId,
      multiAgent: scope.multiAgent,
      feedbackIds: scope.feedbackIds
    }))
  });
}

function loadWorkerScopesFromDisk(run: WorkflowRun): WorkerScope[] {
  ensureWorkerState(run);
  if (!fs.existsSync(workerRoot(run))) return [];
  return fs
    .readdirSync(workerRoot(run), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(workerRoot(run), entry.name, WORKER_SCOPE_FILE))
    .filter((file) => fs.existsSync(file))
    .map((file) => {
      // One corrupt/partially-written worker.json must not blank the whole
      // listing (summarizeWorkers/listWorkerScopes) — skip it with a diagnostic
      // and surface every worker that IS readable.
      try {
        return validateWorkerScope(JSON.parse(fs.readFileSync(file, "utf8")));
      } catch (error) {
        process.stderr.write(`cw: skipping unreadable worker scope ${file}: ${error instanceof Error ? error.message : String(error)}\n`);
        return undefined;
      }
    })
    .filter((scope): scope is WorkerScope => scope !== undefined);
}

function requireWorkerScope(run: WorkflowRun, workerId: string): WorkerScope {
  const scope = getWorkerScope(run, workerId);
  if (!scope) throw new Error(`Unknown worker for run ${run.id}: ${workerId}`);
  return scope;
}

function requireWorkerTask(run: WorkflowRun, scope: WorkerScope): RunTask {
  const task = run.tasks.find((candidate) => candidate.id === scope.taskId);
  if (!task) throw new Error(`Unknown task for worker ${scope.id}: ${scope.taskId}`);
  return task;
}

function workerRoot(run: WorkflowRun): string {
  return run.paths.workersDir || path.join(run.paths.runDir, "workers");
}

function sandboxPolicyForBoundary(
  run: WorkflowRun,
  scope: WorkerScope,
  options: WorkerIsolationOptions = {}
) {
  if (scope.sandboxPolicy && !options.policy && !options.sandboxProfileId) return scope.sandboxPolicy;
  const profileId = options.sandboxProfileId || options.policy?.sandboxProfileId || scope.sandboxProfileId || DEFAULT_SANDBOX_PROFILE_ID;
  // H7: when the scope.sandboxPolicy snapshot is LOST, this re-resolves the policy
  // by its logical profileId against the WORKER's paths (scope.workerDir etc.). For
  // a CUSTOM profile the bundled lookup would throw not-found; threading
  // run.customSandboxProfiles lets resolveSandboxProfileById re-resolve the persisted
  // DEFINITION here — re-enforcing the same policy with worker-correct path tokens
  // (NOT the dispatch-time paths), so a legitimate worker write is not falsely denied.
  return sandboxPolicyForWorker(profileId, {
    cwd: run.cwd,
    runDir: run.paths.runDir,
    workerDir: scope.workerDir,
    inputPath: scope.inputPath,
    resultPath: scope.resultPath,
    artifactsDir: scope.artifactsDir,
    logsDir: scope.logsDir,
    extraReadPaths: options.policy?.readPaths || [],
    extraWritePaths: [
      ...(options.policy?.writePaths || []),
      ...(options.policy?.allowedPaths || []),
      ...(!scope.sandboxPolicy ? scope.allowedPaths || [] : [])
    ],
    allowArtifacts: options.policy?.allowArtifacts,
    allowLogs: options.policy?.allowLogs,
    customProfiles: run.customSandboxProfiles
  });
}

function blackboardManifest(run: WorkflowRun, scope: WorkerScope): WorkerManifest["blackboard"] {
  const linkage = blackboardLinkage(run, scope);
  if (!linkage.blackboardId) return undefined;
  const root = run.paths.blackboardDir || path.join(run.paths.runDir, "blackboard");
  return {
    id: linkage.blackboardId,
    topicIds: linkage.topicIds,
    indexPath: path.join(root, "index.json"),
    messagesPath: path.join(root, "messages.jsonl"),
    topicsDir: path.join(root, "topics"),
    contextsDir: path.join(root, "contexts"),
    artifactsDir: path.join(root, "artifacts"),
    instructions: [
      "Use the blackboard as shared coordination context.",
      "Read index.json and the relevant topic/context/artifact files before synthesizing.",
      "Cite blackboard artifact refs or message refs in result evidence when relevant.",
      "Do not edit blackboard files directly; CW records accepted worker output into the blackboard."
    ]
  };
}

function normalizeWorkerError(error: unknown, scope: WorkerScope, options: RecordWorkerFailureOptions): StateNodeError {
  if (isBoundaryViolation(error)) {
    return structuredError(error.code, error.message, {
      path: error.path,
      retryable: false,
      details: { allowedPaths: error.allowedPaths, workerId: scope.id, taskId: scope.taskId, sandboxProfileId: scope.sandboxProfileId }
    });
  }
  if (isStateNodeError(error)) {
    return {
      ...error,
      at: error.at || new Date().toISOString(),
      path: options.path || error.path,
      retryable: options.retryable ?? error.retryable ?? false,
      details: compactMetadata({ ...(error.details || {}), workerId: scope.id, taskId: scope.taskId })
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return structuredError(options.code || "worker-runtime-error", message, {
    path: options.path,
    retryable: options.retryable ?? false,
    details: { workerId: scope.id, taskId: scope.taskId }
  });
}
