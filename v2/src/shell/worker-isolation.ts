// shell/worker-isolation.ts — worker scope allocation, recordWorkerOutput's
// accept pipeline.
//
// MILESTONE 6+7 (combined). Byte-exact port of the old build's
// src/worker-isolation.ts's real-execution-path (allocateWorkerScope,
// writeWorkerManifest, recordWorkerOutput, recordWorkerFailure,
// recordWorkerRetryAttempt, the worker index) — the multi-agent/
// blackboard cross-linking (worker-accept/blackboard-*.ts) is milestone
// 9's scope and is a no-op here (no case in this milestone's gate
// exercises multi-agent linkage). The accept-path ORDER matches the old
// build: validate -> attest delegation -> accept -> verify -> completion.
//
// Evidence: SPEC/pipeline-run.md's worker-isolation references;
// exechard-evidence-triple-hygiene.case.js, exechard-model-attestation-
// unreported.case.js, exec-agent-secret-redaction.case.js pin the exact
// shapes here.

import * as fs from "node:fs";
import * as path from "node:path";
import { safeFileName, writeJson } from "./fs-atomic";
import { RunTask, StateEvidence, StateNodeError, WorkflowRun } from "../core/state/types";
import { appendRunNode } from "./node-store";
import { createStateNode, linkStateNodes, recordNodeError } from "../core/state/state-node";
import { DEFAULT_PIPELINE_CONTRACT_ID } from "../core/pipeline/contract";
import { normalizeResultEnvelope, isEmptyCapture, ResultEnvelope } from "../core/pipeline/result-normalize";
import { isGroundedEvidence } from "../core/trust/evidence-grounding";
import { normalizeEvidence, recordSandboxPathDecision, recordTrustAuditEvent } from "./trust-audit";
import {
  DEFAULT_SANDBOX_PROFILE_ID,
  effectiveSandboxWritePaths,
  sandboxPolicyForWorker,
  validateSandboxWrite,
} from "./sandbox-profile";
import { ResolvedSandboxPolicy } from "./execution-backend/types";
import { taskRequiresEvidence } from "./verifier";
import { runPipelineStage } from "../core/pipeline/runner";
import { sha256 } from "../core/hash";
import { resolveTrustPublicKey, verifyTelemetryAttestation } from "../core/trust/telemetry-attestation";
import { appendTelemetryAttestation } from "./telemetry-ledger-io";

export const WORKER_ISOLATION_SCHEMA_VERSION = 1;

export interface WorkerScope {
  schemaVersion: 1;
  id: string;
  runId: string;
  taskId: string;
  dispatchId?: string;
  createdAt: string;
  updatedAt: string;
  status: "allocated" | "running" | "completed" | "verified" | "failed" | "rejected" | "orphaned";
  workerDir: string;
  inputPath: string;
  resultPath: string;
  artifactsDir: string;
  logsDir: string;
  allowedPaths: string[];
  sandboxProfileId: string;
  sandboxPolicy: ResolvedSandboxPolicy;
  backendId?: string;
  stateNodeId?: string;
  resultNodeId?: string;
  feedbackIds: string[];
  errors: StateNodeError[];
  retryCount?: number;
  outputDigest?: string;
  outputSizeBytes?: number;
  usage?: Record<string, unknown>;
  output?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface AgentDelegationRecordInput {
  handle: { kind: string; ref: string; endpoint?: string; metadata?: Record<string, unknown> };
  model: string;
  promptDigest: string;
  command?: string;
  args?: string[];
  exitCode: number | null;
  reportedUsage?: Record<string, unknown>;
  usageSignature?: string;
  usageTrustPublicKey?: string;
}

export interface RecordWorkerOutputOptions {
  persist?: boolean;
  agentDelegation?: AgentDelegationRecordInput;
  requireAttestedTelemetry?: boolean;
}

export interface AllocateWorkerScopeOptions {
  dispatchId?: string;
  sandboxProfileId?: string;
  backendId?: string;
  status?: WorkerScope["status"];
  persist?: boolean;
  metadata?: Record<string, unknown>;
}

function workerRoot(run: WorkflowRun): string {
  return run.paths.workersDir || path.join(run.paths.runDir, "workers");
}

function ensureWorkerState(run: WorkflowRun): void {
  run.paths.workersDir = run.paths.workersDir || path.join(run.paths.runDir, "workers");
  fs.mkdirSync(run.paths.workersDir, { recursive: true });
  run.workers = run.workers || [];
}

function manifestPath(scope: WorkerScope): string {
  return path.join(scope.workerDir, "manifest.json");
}
function scopePath(scope: WorkerScope): string {
  return path.join(scope.workerDir, "worker.json");
}

/** Deterministic worker id: the task plus a PER-TASK sequence (count of
 *  worker scopes already allocated for THIS task + 1) — byte-exact port
 *  of the old build's src/worker-isolation/paths.ts:38-42. Re-running the
 *  same workflow yields byte-identical worker ids while retries of the
 *  SAME task still get a fresh, unique id (workerId is excluded from the
 *  snapshot source fingerprint, so this does not change replay digests). */
function createWorkerId(run: WorkflowRun, taskId: string): string {
  const prefix = `worker-${safeFileName(taskId)}-`;
  const seq = ((run.workers as unknown as WorkerScope[] | undefined) || []).filter((scope) => scope.id.startsWith(prefix)).length + 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

export function getWorkerScope(run: WorkflowRun, workerId: string): WorkerScope | undefined {
  ensureWorkerState(run);
  const existing = (run.workers as unknown as WorkerScope[] | undefined || []).find((s) => s.id === workerId);
  if (existing) return existing;
  const file = path.join(workerRoot(run), safeFileName(workerId), "worker.json");
  if (!fs.existsSync(file)) return undefined;
  const scope = JSON.parse(fs.readFileSync(file, "utf8")) as WorkerScope;
  upsertWorkerScope(run, scope);
  return scope;
}

function upsertWorkerScope(run: WorkflowRun, scope: WorkerScope): WorkerScope {
  ensureWorkerState(run);
  const scopes = (run.workers as unknown as WorkerScope[]) || [];
  const index = scopes.findIndex((s) => s.id === scope.id);
  run.workers = (index >= 0 ? scopes.map((s) => (s.id === scope.id ? scope : s)) : [...scopes, scope]) as unknown as WorkflowRun["workers"];
  writeJson(scopePath(scope), scope);
  return scope;
}

function writeWorkerIndex(run: WorkflowRun): void {
  ensureWorkerState(run);
  writeJson(path.join(workerRoot(run), "index.json"), {
    schemaVersion: WORKER_ISOLATION_SCHEMA_VERSION,
    runId: run.id,
    workers: ((run.workers as unknown as WorkerScope[]) || []).map((scope) => ({
      id: scope.id,
      taskId: scope.taskId,
      dispatchId: scope.dispatchId,
      status: scope.status,
      workerDir: scope.workerDir,
      manifestPath: manifestPath(scope),
      resultPath: scope.resultPath,
      sandboxProfileId: scope.sandboxProfileId,
      backendId: scope.backendId,
      feedbackIds: scope.feedbackIds,
    })),
  });
}

export function writeWorkerManifest(run: WorkflowRun, scope: WorkerScope): Record<string, unknown> {
  const task = run.tasks.find((t) => t.id === scope.taskId);
  const sandboxProfileId = scope.sandboxProfileId;
  const manifest: Record<string, unknown> = {
    schemaVersion: WORKER_ISOLATION_SCHEMA_VERSION,
    id: scope.id,
    runId: scope.runId,
    taskId: scope.taskId,
    dispatchId: scope.dispatchId,
    createdAt: scope.createdAt,
    updatedAt: scope.updatedAt,
    status: scope.status,
    workerDir: scope.workerDir,
    scopePath: scopePath(scope),
    manifestPath: manifestPath(scope),
    inputPath: scope.inputPath,
    resultPath: scope.resultPath,
    artifactsDir: scope.artifactsDir,
    logsDir: scope.logsDir,
    allowedPaths: scope.allowedPaths,
    sandboxProfileId,
    sandboxPolicy: scope.sandboxPolicy,
    sandbox: scope.sandboxPolicy
      ? { profileId: scope.sandboxPolicy.id, policy: scope.sandboxPolicy, enforcedByCW: scope.sandboxPolicy.enforcement.enforcedByCW, hostRequired: scope.sandboxPolicy.enforcement.hostRequired }
      : undefined,
    backendId: scope.backendId,
    retryCount: scope.retryCount,
    instructions: [
      "Read input.md before doing work.",
      "Write the final Markdown result to result.md.",
      "Write worker-local artifacts under artifacts/ and logs under logs/.",
      `Sandbox profile: ${sandboxProfileId}.`,
      "CW enforces profile validation and worker result acceptance only.",
      "The agent host must enforce OS file access, process execution, network access, and environment filtering.",
      "Do not edit shared run state files directly; CW records accepted results.",
    ],
    taskPath: task?.taskPath,
    prompt: task?.prompt,
    stateNodeId: scope.stateNodeId,
    resultNodeId: scope.resultNodeId,
    feedbackIds: scope.feedbackIds,
    errors: scope.errors,
    output: scope.output,
    metadata: scope.metadata,
  };
  writeJson(manifestPath(scope), manifest);
  return manifest;
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
    `- Write paths: ${effectiveSandboxWritePaths(scope.sandboxPolicy).join(", ") || "none"}.`,
    "- CW enforces result acceptance. The host is responsible for OS/process/network/environment sandbox enforcement.",
    "- Do not mutate state.json, nodes/, feedback/, dispatches/, or commits/ directly.",
    "",
  ];
  fs.writeFileSync(scope.inputPath, lines.join("\n"), "utf8");
}

export function allocateWorkerScope(run: WorkflowRun, task: RunTask, options: AllocateWorkerScopeOptions = {}): WorkerScope {
  ensureWorkerState(run);
  const existing = task.workerId ? getWorkerScope(run, String(task.workerId)) : undefined;
  if (existing) {
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
  const workerId = createWorkerId(run, task.id);
  const workerDir = path.join(workerRoot(run), safeFileName(workerId));
  const inputPath = path.join(workerDir, "input.md");
  const resultPath = path.join(workerDir, "result.md");
  const artifactsDir = path.join(workerDir, "artifacts");
  const logsDir = path.join(workerDir, "logs");
  const sandboxProfileId = options.sandboxProfileId || DEFAULT_SANDBOX_PROFILE_ID;
  const sandboxPolicy = sandboxPolicyForWorker(sandboxProfileId, {
    cwd: run.cwd,
    runDir: run.paths.runDir,
    workerDir,
    inputPath,
    resultPath,
    artifactsDir,
    logsDir,
    customProfiles: run.customSandboxProfiles as Record<string, import("./execution-backend/types").SandboxProfileDefinition> | undefined,
  });
  const allowedPaths = effectiveSandboxWritePaths(sandboxPolicy);

  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  const scope: WorkerScope = {
    schemaVersion: WORKER_ISOLATION_SCHEMA_VERSION,
    id: workerId,
    runId: run.id,
    taskId: task.id,
    dispatchId: options.dispatchId || (task.dispatchId as string | undefined),
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
    backendId: options.backendId,
    stateNodeId: task.stateNodeId,
    feedbackIds: [],
    errors: [],
    metadata: options.metadata,
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
    metadata: { dispatchId: scope.dispatchId, workerDir: scope.workerDir, allowedPaths },
  });
  task.workerId = scope.id;
  task.workerManifestPath = manifestPath(scope);
  task.sandboxProfileId = sandboxPolicy.id;
  task.sandboxPolicy = sandboxPolicy;
  task.backendId = options.backendId;
  writeWorkerIndex(run);
  return scope;
}

function requireWorkerScope(run: WorkflowRun, workerId: string): WorkerScope {
  const scope = getWorkerScope(run, workerId);
  if (!scope) throw new Error(`Unknown worker for run ${run.id}: ${workerId}`);
  return scope;
}
function requireWorkerTask(run: WorkflowRun, scope: WorkerScope): RunTask {
  const task = run.tasks.find((t) => t.id === scope.taskId);
  if (!task) throw new Error(`Unknown task for worker ${scope.id}: ${scope.taskId}`);
  return task;
}

/** recordWorkerOutput — the accept-path orchestrator. Order: validate ->
 *  attest delegation -> accept -> verify -> completion (byte-exact to the
 *  old build; multi-agent fan-out is a no-op here). */
export function recordWorkerOutput(run: WorkflowRun, workerId: string, resultPath: string, options: RecordWorkerOutputOptions = {}): Record<string, unknown> {
  const scope = requireWorkerScope(run, workerId);
  const task = requireWorkerTask(run, scope);
  const absoluteResultPath = path.resolve(resultPath);

  // Step 1: sandbox boundary + result-file existence + envelope contract.
  const violation = validateSandboxWrite(scope.sandboxPolicy, absoluteResultPath, workerId);
  if (violation) {
    recordSandboxPathDecision(run, { workerId, taskId: task.id, sandboxProfileId: scope.sandboxProfileId, policySnapshot: scope.sandboxPolicy, target: absoluteResultPath, decision: "denied", metadata: { code: violation.code } });
    recordWorkerFailure(run, workerId, violation.message, { code: violation.code, retryable: false });
    throw new Error(violation.message);
  }
  if (!fs.existsSync(absoluteResultPath)) {
    recordWorkerFailure(run, workerId, `Worker result file does not exist: ${absoluteResultPath}`, { code: "worker-result-missing", retryable: true });
    throw new Error(`Worker result file does not exist: ${absoluteResultPath}`);
  }
  const rawResult = fs.readFileSync(absoluteResultPath, "utf8");
  let parsedResult: ResultEnvelope;
  try {
    parsedResult = normalizeResultEnvelope(rawResult);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordWorkerFailure(run, workerId, message, { code: "result-parse-error", retryable: false });
    throw error;
  }
  if (taskRequiresEvidence(task) && !parsedResult.evidence.some((e) => isGroundedEvidence(e))) {
    const message = `Task ${task.id} requires grounded cw:result evidence (a path-like locator, URL, or namespace:value token — not free text)`;
    recordWorkerFailure(run, workerId, message, { code: "missing-required-evidence", retryable: false });
    throw new Error(message);
  }

  // Step 2: attest delegation (the agent-hop provenance). Track 1: verify
  // the agent's signed telemetry BEFORE recording it — CW holds only the
  // operator's PUBLIC key, so this verifies attribution, never measures
  // usage. resultDigest binds the agent's findings into the signature:
  // CW recomputes the digest from the ACCEPTED result bytes so a result
  // edited after signing fails verification; a signer that did not
  // cover the result still verifies (4-field back-compat).
  const delegation = options.agentDelegation;
  const telemetry = delegation
    ? verifyTelemetryAttestation(delegation.reportedUsage, delegation.usageSignature, resolveTrustPublicKey(delegation.usageTrustPublicKey), {
        runId: run.id,
        taskId: task.id,
        promptDigest: delegation.promptDigest,
        resultDigest: sha256(rawResult),
      })
    : undefined;
  // Opt-in fail-closed gate (default off): when the operator requires
  // attested telemetry, a delegated hop whose verdict is not `attested`
  // is REJECTED here — BEFORE any accept-side state mutation — so the
  // drive parks it instead of recording unverifiable usage.
  if (options.requireAttestedTelemetry && telemetry && telemetry.status !== "attested") {
    const message = `Worker ${workerId} telemetry is ${telemetry.status} (${telemetry.reason || "unverified"}) and require-attested-telemetry is enabled — refusing to accept a hop whose usage cannot be cryptographically verified`;
    recordWorkerFailure(run, workerId, message, { code: "telemetry-unattested-blocked", path: absoluteResultPath, retryable: false });
    throw new Error(message);
  }
  const agentDelegationMeta = delegation
    ? {
        schemaVersion: 1 as const,
        backendId: "agent" as const,
        handle: delegation.handle,
        model: delegation.model,
        promptDigest: delegation.promptDigest,
        resultDigest: sha256(rawResult),
        command: delegation.command,
        args: delegation.args,
        exitCode: delegation.exitCode,
        ...(delegation.reportedUsage ? { reportedUsage: delegation.reportedUsage } : {}),
        ...(delegation.usageSignature ? { usageSignature: delegation.usageSignature } : {}),
        ...(telemetry ? { usageAttestation: telemetry.status, usageAttestationReason: telemetry.reason } : {}),
      }
    : undefined;

  // Step 3: accept — the irreversible mutation.
  const pathAudit = recordSandboxPathDecision(run, { workerId, taskId: task.id, sandboxProfileId: scope.sandboxProfileId, policySnapshot: scope.sandboxPolicy, target: absoluteResultPath, decision: "allowed", metadata: { operation: "worker-output-acceptance" } });
  const destination = path.join(run.paths.resultsDir, `${safeFileName(task.id)}.md`);
  fs.mkdirSync(run.paths.resultsDir, { recursive: true });
  fs.copyFileSync(absoluteResultPath, destination);

  task.status = "completed";
  task.completedAt = new Date().toISOString();
  task.resultPath = destination;
  task.loopStage = "observe";
  task.result = parsedResult as unknown as RunTask["result"];

  const evidence: StateEvidence[] = normalizeEvidence(
    run,
    parsedResult.evidence.map((entry, index) => ({ id: `result:${index + 1}`, source: "cw:result", locator: entry, summary: entry })),
    { source: "cw-validated", workerId, taskId: task.id, auditEventIds: [pathAudit.id] }
  );
  let resultNode = createStateNode({
    id: `${run.id}:result:${task.id}`,
    kind: "result",
    status: "completed",
    loopStage: "observe",
    inputs: { taskId: task.id, dispatchId: task.dispatchId, workerId },
    outputs: parsedResult as unknown as Record<string, unknown>,
    artifacts: [
      { id: "result", kind: "markdown", path: destination },
      { id: "worker-result", kind: "markdown", path: absoluteResultPath },
    ],
    evidence,
    parents: task.dispatchId ? [`${run.id}:dispatch:${task.dispatchId}`] : [String(task.stateNodeId || `${run.id}:task:${task.id}`)],
    contractId: DEFAULT_PIPELINE_CONTRACT_ID,
    metadata: {
      taskId: task.id,
      workerId,
      workerDir: scope.workerDir,
      sandboxProfileId: scope.sandboxProfileId,
      auditEventIds: [pathAudit.id],
      ...(isEmptyCapture(parsedResult) ? { captureWarning: "no findings or evidence captured from result.md" } : {}),
      ...(agentDelegationMeta ? { agentDelegation: agentDelegationMeta } : {}),
    },
  });
  const acceptedAudit = recordTrustAuditEvent(run, {
    kind: "worker.output",
    decision: "accepted",
    source: "cw-validated",
    workerId,
    taskId: task.id,
    nodeId: resultNode.id,
    sandboxProfileId: scope.sandboxProfileId,
    policySnapshot: scope.sandboxPolicy,
    normalizedPath: absoluteResultPath,
    evidence,
    parentEventIds: [pathAudit.id],
    metadata: { destination },
  });
  resultNode.evidence = normalizeEvidence(run, resultNode.evidence, { source: "cw-validated", workerId, taskId: task.id, resultNodeId: resultNode.id, auditEventIds: [pathAudit.id, acceptedAudit.id] });
  resultNode = appendRunNode(run, resultNode);
  task.resultNodeId = resultNode.id;

  if (isEmptyCapture(parsedResult)) {
    recordTrustAuditEvent(run, { kind: "worker.capture-warning", decision: "recorded", source: "cw-validated", workerId, taskId: task.id, nodeId: resultNode.id, parentEventIds: [acceptedAudit.id], metadata: { reason: "no findings or evidence captured from result.md", resultPath: destination } });
  }

  if (delegation && agentDelegationMeta) {
    // Track 1 (tamper-evidence): bind this verdict into the append-only,
    // hash-chained telemetry ledger BEFORE the audit event, so the event
    // can cross-link the record hash. Editing the recorded verdict/usage
    // later breaks the chain (verifyTelemetryLedger). Only when a
    // verdict was computed (every agent hop gets one, even "absent").
    const ledgerRecord = agentDelegationMeta.usageAttestation
      ? appendTelemetryAttestation(run, {
          workerId,
          taskId: task.id,
          promptDigest: agentDelegationMeta.promptDigest,
          reportedUsage: agentDelegationMeta.reportedUsage,
          usageSignature: agentDelegationMeta.usageSignature,
          // Store the signed result digest ONLY when the signature
          // actually covered it, so the offline re-verifier can
          // reconstruct the 5-field payload.
          resultDigest: telemetry?.coversResult ? agentDelegationMeta.resultDigest : undefined,
          attestation: agentDelegationMeta.usageAttestation,
          attestationReason: agentDelegationMeta.usageAttestationReason,
        })
      : undefined;
    recordTrustAuditEvent(run, {
      kind: "worker.agent-delegation",
      decision: "recorded",
      source: "host-attested",
      workerId,
      taskId: task.id,
      nodeId: resultNode.id,
      sandboxProfileId: scope.sandboxProfileId,
      policySnapshot: scope.sandboxPolicy,
      parentEventIds: [acceptedAudit.id],
      metadata: {
        backendId: "agent",
        handleKind: delegation.handle.kind,
        handleRef: delegation.handle.ref,
        model: delegation.model,
        promptDigest: delegation.promptDigest,
        resultDigest: agentDelegationMeta.resultDigest,
        command: delegation.command,
        args: delegation.args,
        exitCode: delegation.exitCode,
        ...(agentDelegationMeta.usageAttestation
          ? {
              telemetryAttestation: agentDelegationMeta.usageAttestation,
              ...(agentDelegationMeta.usageAttestationReason ? { telemetryAttestationReason: agentDelegationMeta.usageAttestationReason } : {}),
              ...(agentDelegationMeta.reportedUsage ? { reportedUsage: agentDelegationMeta.reportedUsage } : {}),
              ...(ledgerRecord ? { telemetryRecordId: ledgerRecord.recordId, telemetryRecordHash: ledgerRecord.recordHash, telemetryPrevHash: ledgerRecord.prevHash } : {}),
            }
          : {}),
      },
    });
  }

  // Step 4: verify — drive the pipeline's "verify" stage off the accepted result.
  const verifierResult = runPipelineStage(
    run,
    "verify",
    resultNode.id,
    {
      outputNodeId: `${run.id}:verifier:${task.id}`,
      outputStatus: "verified",
      loopStage: "adjust",
      outputs: { accepted: true, workerId },
      artifacts: [{ id: "result", kind: "markdown", path: destination }],
      evidence: resultNode.evidence.length ? resultNode.evidence : [{ id: "result:summary", source: "summary", summary: parsedResult.summary }],
      metadata: { taskId: task.id, workerId, resultNodeId: resultNode.id, sandboxProfileId: scope.sandboxProfileId },
    },
    { persist: false, persistNode: appendRunNode }
  );
  task.verifierNodeId = verifierResult.outputNodeId;

  // Step 5: completion — persist the worker scope with the verify-derived status.
  const output = { workerId, taskId: task.id, resultPath: absoluteResultPath, recordedAt: new Date().toISOString(), stateNodeId: resultNode.id, verifierNodeId: task.verifierNodeId, auditEventIds: [pathAudit.id, acceptedAudit.id] };
  const reportedModel = agentDelegationMeta && agentDelegationMeta.model && agentDelegationMeta.model !== "unreported" ? agentDelegationMeta.model : undefined;
  const usageRecord = agentDelegationMeta && (reportedModel || agentDelegationMeta.reportedUsage) ? { schemaVersion: 1, source: "host-attested", ...(reportedModel ? { model: reportedModel } : {}), ...(agentDelegationMeta.reportedUsage || {}), attestedAt: new Date().toISOString() } : undefined;
  const updatedScope: WorkerScope = {
    ...scope,
    updatedAt: new Date().toISOString(),
    status: verifierResult.status === "advanced" ? "verified" : "completed",
    resultNodeId: resultNode.id,
    output,
    outputDigest: sha256Local(rawResult),
    outputSizeBytes: Buffer.byteLength(rawResult, "utf8"),
    ...(usageRecord ? { usage: usageRecord } : {}),
  };
  upsertWorkerScope(run, updatedScope);
  writeWorkerManifest(run, updatedScope);
  writeWorkerIndex(run);
  return output;
}

function sha256Local(value: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function recordWorkerFailure(run: WorkflowRun, workerId: string, error: unknown, options: { code?: string; path?: string; retryable?: boolean; retryCount?: number } = {}): WorkerScope {
  const scope = requireWorkerScope(run, workerId);
  const task = requireWorkerTask(run, scope);
  const message = error instanceof Error ? error.message : String(error);
  const structured: StateNodeError = { code: options.code || "worker-runtime-error", message, at: new Date().toISOString(), path: options.path, retryable: options.retryable ?? false };
  const failureNodeId = `${run.id}:worker:${safeFileName(workerId)}:failure:${scope.errors.length + 1}`;
  let failureNode = recordNodeError(
    createStateNode({ id: failureNodeId, kind: "error", status: "pending", loopStage: "adjust", inputs: { workerId, taskId: task.id, dispatchId: scope.dispatchId }, parents: task.stateNodeId ? [String(task.stateNodeId)] : [], contractId: DEFAULT_PIPELINE_CONTRACT_ID, metadata: { workerId, taskId: task.id, dispatchId: scope.dispatchId, workerDir: scope.workerDir, sandboxProfileId: scope.sandboxProfileId } }),
    structured
  );
  if (task.stateNodeId) {
    const parent = (run.nodes || []).find((n) => n.id === task.stateNodeId);
    if (parent) {
      const [linkedParent, linkedChild] = linkStateNodes(parent, failureNode);
      appendRunNode(run, linkedParent);
      failureNode = linkedChild;
    }
  }
  failureNode = appendRunNode(run, failureNode);
  task.status = "failed";
  task.loopStage = "adjust";
  recordTrustAuditEvent(run, { kind: "worker.failure", decision: structured.code === "worker-boundary-violation" || structured.code.startsWith("sandbox-") ? "denied" : "failed", source: structured.code.startsWith("sandbox-") || structured.code === "worker-boundary-violation" ? "cw-validated" : "runtime-derived", workerId, taskId: task.id, nodeId: failureNode.id, sandboxProfileId: scope.sandboxProfileId, policySnapshot: scope.sandboxPolicy, normalizedPath: structured.path, metadata: { code: structured.code, dispatchId: scope.dispatchId } });
  const updated = upsertWorkerScope(run, {
    ...scope,
    updatedAt: new Date().toISOString(),
    status: structured.code === "worker-boundary-violation" || structured.code.startsWith("sandbox-") ? "rejected" : "failed",
    retryCount: typeof options.retryCount === "number" ? options.retryCount : scope.retryCount,
    errors: [...(scope.errors || []), structured],
  });
  writeWorkerIndex(run);
  return updated;
}

export function recordWorkerRetryAttempt(run: WorkflowRun, workerId: string, attempts: number, reason: string): WorkerScope {
  const scope = requireWorkerScope(run, workerId);
  const updated = upsertWorkerScope(run, {
    ...scope,
    updatedAt: new Date().toISOString(),
    retryCount: attempts,
    metadata: { ...(scope.metadata || {}), agentDelegationAttempts: attempts, agentDelegationLastFailure: reason },
  });
  writeWorkerManifest(run, updated);
  return updated;
}

export function showWorkerManifest(run: WorkflowRun, workerId: string): { resultPath: string; inputPath: string; manifestPath: string; workerDir: string; prompt?: string; sandboxPolicy?: ResolvedSandboxPolicy } {
  const scope = requireWorkerScope(run, workerId);
  const task = run.tasks.find((t) => t.id === scope.taskId);
  return { resultPath: scope.resultPath, inputPath: scope.inputPath, manifestPath: manifestPath(scope), workerDir: scope.workerDir, prompt: task?.prompt, sandboxPolicy: scope.sandboxPolicy };
}
