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
import { validateWorkerScope as validateWorkerScopeShape } from "../core/state/validation";
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
import { ResolvedSandboxPolicy, SandboxAttestation } from "./execution-backend/types";
import { attestSandbox, getBackendDescriptor, resolveBackendSelection } from "./execution-backend/registry";
import { recordFeedback } from "./error-feedback-io";
import { saveCheckpoint } from "./run-store";
import { recordMultiAgentWorkerOutput } from "./multi-agent-io";
import { getAgentMembership } from "../core/multi-agent/runtime";

/** The blackboard coordination block on a worker manifest, derived from the
 *  worker's AgentMembership linkage (undefined for a non-blackboard worker).
 *  Byte-behavior port of the old build's blackboardManifest. */
function workerBlackboardManifest(run: WorkflowRun, task: RunTask | undefined): Record<string, unknown> | undefined {
  const membershipId = (task?.multiAgent as { membershipId?: string } | undefined)?.membershipId;
  const membership = membershipId ? getAgentMembership(run, membershipId) : undefined;
  const blackboardId = membership?.blackboardId;
  if (!blackboardId) return undefined;
  const root = run.paths.blackboardDir || path.join(run.paths.runDir, "blackboard");
  return {
    id: blackboardId,
    topicIds: membership?.topicIds || [],
    indexPath: path.join(root, "index.json"),
    messagesPath: path.join(root, "messages.jsonl"),
    topicsDir: path.join(root, "topics"),
    contextsDir: path.join(root, "contexts"),
    artifactsDir: path.join(root, "artifacts"),
    instructions: [
      "Use the blackboard as shared coordination context.",
      "Read index.json and the relevant topic/context/artifact files before synthesizing.",
      "Cite blackboard artifact refs or message refs in result evidence when relevant.",
      "Do not edit blackboard files directly; CW records accepted worker output into the blackboard.",
    ],
  };
}
import { taskRequiresEvidence } from "./verifier";
import { runPipelineStage } from "../core/pipeline/runner";
import { sha256 } from "../core/hash";
import { normalizeReportedUsage, resolveTrustPublicKey, verifyTelemetryAttestation } from "../core/trust/telemetry-attestation";
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
  backendAttestation?: SandboxAttestation;
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
  /** Operator escape hatch for requireAttestedTelemetry: records the accept
   *  ON THE AUDIT LOG (kind telemetry.gate-override) instead of blocking it.
   *  Never silent -- see the gate below. */
  allowUnattested?: boolean;
}

export interface AllocateWorkerScopeOptions {
  dispatchId?: string;
  sandboxProfileId?: string;
  backendId?: string;
  status?: WorkerScope["status"];
  persist?: boolean;
  metadata?: Record<string, unknown>;
  /** Explicit worker id — honored when given (else auto-minted). Lets a
   *  caller allocate a worker with a known id (byte-behavior port of the old
   *  build's allocateWorkerScope). */
  workerId?: string;
}

function workerRoot(run: WorkflowRun): string {
  return run.paths.workersDir || path.join(run.paths.runDir, "workers");
}

/** Record a resolved sandbox policy into run.sandboxProfiles (upsert by id) so
 *  the run state carries every profile a worker ran under — reports and
 *  operators read it. Byte-exact to the old sandbox-profile.ts helper v2
 *  dropped. */
function upsertRunSandboxProfile(run: WorkflowRun, policy: ResolvedSandboxPolicy): void {
  const profiles = (run.sandboxProfiles as ResolvedSandboxPolicy[] | undefined) || [];
  const index = profiles.findIndex((candidate) => candidate.id === policy.id);
  run.sandboxProfiles = (index >= 0 ? profiles.map((candidate) => (candidate.id === policy.id ? policy : candidate)) : [...profiles, policy]) as unknown as WorkflowRun["sandboxProfiles"];
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

/** Full fail-closed shape guard for a worker.json overlay: delegates to the
 *  core WorkerScope guard (schemaVersion, every required string field, the
 *  status enum, allowedPaths/feedbackIds/errors shapes) and casts the
 *  result to this module's richer WorkerScope, a structural superset of the
 *  core WorkerScopeShape. A syntactically-invalid file throws from
 *  JSON.parse before this runs; a wrong-shape (but parseable) file throws a
 *  RecordValidationError naming the exact broken field. */
function validateWorkerScope(value: unknown): WorkerScope {
  return validateWorkerScopeShape(value) as unknown as WorkerScope;
}

export function getWorkerScope(run: WorkflowRun, workerId: string): WorkerScope | undefined {
  ensureWorkerState(run);
  const existing = (run.workers as unknown as WorkerScope[] | undefined || []).find((s) => s.id === workerId);
  if (existing) return existing;
  const file = path.join(workerRoot(run), safeFileName(workerId), "worker.json");
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

/** Load every worker.json under the run's workers dir, skipping (with a
 *  stderr diagnostic) any one that is corrupt/partially-written so a single
 *  bad file cannot blank the whole listing. Byte-exact to the old build's
 *  loadWorkerScopesFromDisk. */
function loadWorkerScopesFromDisk(run: WorkflowRun): WorkerScope[] {
  const root = workerRoot(run);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, "worker.json"))
    .filter((file) => fs.existsSync(file))
    .map((file) => {
      try {
        return validateWorkerScope(JSON.parse(fs.readFileSync(file, "utf8")));
      } catch (error) {
        process.stderr.write(`cw: skipping unreadable worker scope ${file}: ${error instanceof Error ? error.message : String(error)}\n`);
        return undefined;
      }
    })
    .filter((scope): scope is WorkerScope => scope !== undefined);
}

/** Overlay disk-loaded scopes onto the in-memory list, keyed by id (disk
 *  wins), preserving first-seen order. */
function mergeScopes(existing: WorkerScope[], loaded: WorkerScope[]): WorkerScope[] {
  const byId = new Map<string, WorkerScope>();
  for (const scope of existing) byId.set(scope.id, scope);
  for (const scope of loaded) byId.set(scope.id, scope);
  return [...byId.values()];
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
    backendAttestation: scope.backendAttestation,
    multiAgent: task?.multiAgent,
    blackboard: workerBlackboardManifest(run, task),
    backend:
      scope.backendId && scope.backendAttestation
        ? {
            id: scope.backendId,
            locality: scope.backendAttestation.locality,
            kind: scope.backendAttestation.kind,
            enforces: scope.backendAttestation.enforced,
            attests: scope.backendAttestation.attested,
            attestation: scope.backendAttestation,
          }
        : undefined,
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
  const workerId = options.workerId || createWorkerId(run, task.id);
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
  upsertRunSandboxProfile(run, sandboxPolicy);

  // Execution-backend selection (mechanism vs policy): when a backend was
  // explicitly selected, record its sandbox attestation. The dispatch path is a
  // delegate-host execution (the host runs the worker), so the backend enforces
  // only CW's own worker-output acceptance and attests the rest.
  const backendAttestation = options.backendId
    ? attestSandbox(getBackendDescriptor(options.backendId), sandboxPolicy, { mode: "delegate-host" })
    : undefined;

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
    backendAttestation,
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
  if (options.backendId && backendAttestation) {
    recordTrustAuditEvent(run, {
      kind: "worker.backend",
      decision: backendAttestation.status === "refused" ? "denied" : "recorded",
      source: "runtime-derived",
      workerId: scope.id,
      taskId: task.id,
      sandboxProfileId: sandboxPolicy.id,
      policySnapshot: sandboxPolicy,
      metadata: {
        backendId: options.backendId,
        attestationStatus: backendAttestation.status,
        enforced: backendAttestation.enforced,
        attested: backendAttestation.attested,
        unenforceable: backendAttestation.unenforceable,
        dispatchId: scope.dispatchId,
      },
    });
  }
  task.workerId = scope.id;
  task.workerManifestPath = manifestPath(scope);
  task.sandboxProfileId = sandboxPolicy.id;
  task.sandboxPolicy = sandboxPolicy;
  task.backendId = options.backendId;
  task.backendAttestation = backendAttestation;
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
/** Record the worker.sandbox-boundary trust-audit event: a successful write-path
 *  check documents transparently what CW enforced (write paths) vs what is
 *  delegated to the host (execute/network/env). Byte-exact to the old build's
 *  event emitted inside validateWorkerBoundary. */
function recordSandboxBoundaryEvent(run: WorkflowRun, scope: WorkerScope): void {
  const policy = scope.sandboxPolicy;
  recordTrustAuditEvent(run, {
    kind: "worker.sandbox-boundary",
    decision: "allowed",
    source: "cw-validated",
    workerId: scope.id,
    taskId: scope.taskId,
    sandboxProfileId: policy.id,
    policyRef: `execute=${policy.execute.mode} network=${policy.network.mode} env.inherit=${policy.env.inherit}`,
    command: policy.execute.mode,
    networkTarget: policy.network.mode,
    policySnapshot: policy,
    metadata: {
      enforced_by_cw: ["write-paths"],
      delegated_to_host: ["execute", "network", "env"],
      env_inherit: policy.env.inherit,
    },
  });
}

/** `cw worker validate <run-id> <worker-id> [target-file]` — re-run the
 *  write-path boundary check for a worker (default target = its result file).
 *  Returns the violation, or null when the write path is allowed (also
 *  recording the sandbox-boundary transparency event on success). */
export function validateWorkerBoundary(run: WorkflowRun, workerId: string, options: { path?: string } = {}): ReturnType<typeof validateSandboxWrite> {
  const scope = requireWorkerScope(run, workerId);
  const rawPath = path.resolve(String(options.path || scope.resultPath));
  const violation = validateSandboxWrite(scope.sandboxPolicy, rawPath, workerId);
  if (!violation) recordSandboxBoundaryEvent(run, scope);
  return violation;
}

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
  // Write path enforced by CW; record the enforced-vs-delegated policy split.
  recordSandboxBoundaryEvent(run, scope);
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
  // attested telemetry, an accept whose usage cannot be verified is
  // REJECTED here — BEFORE any accept-side state mutation — so the drive
  // parks it instead of recording unverifiable usage. This fires on BOTH
  // shapes: a delegation present but not attested (telemetry.status !==
  // "attested"), and NO delegation metadata at all. The second shape is
  // the gap a manual `cw worker output` / `cw result` accept used to slip
  // through silently: options.agentDelegation was simply absent, so
  // `telemetry` was undefined and the old `telemetry &&` condition
  // short-circuited false — an unattested result could be laundered
  // through the manual accept path even with the require flag on.
  // --allow-unattested is the operator's explicit way past this: it never
  // skips the gate silently, it records a telemetry.gate-override event.
  if (options.requireAttestedTelemetry && (!telemetry || telemetry.status !== "attested")) {
    if (options.allowUnattested) {
      recordTrustAuditEvent(run, {
        kind: "telemetry.gate-override",
        decision: "allowed",
        source: "operator",
        workerId,
        taskId: task.id,
        metadata: { reason: "--allow-unattested", telemetryStatus: telemetry ? telemetry.status : "absent" },
      });
    } else {
      const code = telemetry ? "telemetry-unattested-blocked" : "telemetry-missing-blocked";
      const message = telemetry
        ? `Worker ${workerId} telemetry is ${telemetry.status} (${telemetry.reason || "unverified"}) and require-attested-telemetry is enabled — refusing to accept a hop whose usage cannot be cryptographically verified`
        : `Worker ${workerId} carries no agent-delegation telemetry at all and require-attested-telemetry is enabled — refusing to accept an unattested manual result (pass --allow-unattested to record an audited override)`;
      recordWorkerFailure(run, workerId, message, { code, path: absoluteResultPath, retryable: false });
      throw new Error(message);
    }
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

  // Multi-agent: if this task belongs to an AgentMembership, sync the membership
  // to "reported" with this result's evidence so a fanin can see it as complete
  // (isMembershipReported). No-op for a non-multi-agent task (no membership
  // matches workerId/taskId). Byte-behavior port of the old accept path.
  if (task.multiAgent) {
    recordMultiAgentWorkerOutput(run, { workerId, taskId: task.id, resultNodeId: resultNode.id, evidence: resultNode.evidence });
  }

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
  // Host-attested usage rides on the worker record. Recorded when the agent
  // REPORTED a model OR token usage — `unreported`/absent stays ABSENT (never
  // backfilled from the operator-chosen CW_AGENT_MODEL, never made up).
  // Track 1: the attestation verdict (`attested`/`unattested`/`absent`) and its
  // reason ride along, and the token buckets come from normalizeReportedUsage
  // (tolerates snake_case/camelCase) — CW still never measures usage, it only
  // records + labels what the agent self-reported. Byte-exact to the old
  // build's src/worker-accept/verifier-completion.ts:58-68.
  const usageRecord = agentDelegationMeta && (reportedModel || agentDelegationMeta.reportedUsage)
    ? {
        schemaVersion: 1,
        source: "host-attested",
        ...(reportedModel ? { model: reportedModel } : {}),
        ...normalizeReportedUsage(agentDelegationMeta.reportedUsage),
        attestedAt: new Date().toISOString(),
        ...(telemetry ? { attestation: telemetry.status, ...(telemetry.reason ? { attestationReason: telemetry.reason } : {}) } : {}),
        note: "agent-delegation host-attested usage",
      }
    : undefined;
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

export function recordWorkerFailure(run: WorkflowRun, workerId: string, error: unknown, options: { code?: string; path?: string; retryable?: boolean; retryCount?: number; persist?: boolean } = {}): WorkerScope {
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
  // Record the failure as append-only operator feedback so worker.feedbackIds
  // and run.feedback carry it (its absence cascaded: failed workers left no
  // feedback trail). Byte-exact to the old build.
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
      metadata: { workerId, dispatchId: scope.dispatchId, workerDir: scope.workerDir, sandboxProfileId: scope.sandboxProfileId, sandboxPolicy: scope.sandboxPolicy, allowedPaths: scope.allowedPaths, details: structured.details },
    },
    { persist: false }
  );
  recordTrustAuditEvent(run, { kind: "worker.failure", decision: structured.code === "worker-boundary-violation" || structured.code.startsWith("sandbox-") ? "denied" : "failed", source: structured.code.startsWith("sandbox-") || structured.code === "worker-boundary-violation" ? "cw-validated" : "runtime-derived", workerId, taskId: task.id, nodeId: failureNode.id, feedbackIds: [feedback.id], sandboxProfileId: scope.sandboxProfileId, policySnapshot: scope.sandboxPolicy, normalizedPath: structured.path, metadata: { code: structured.code, dispatchId: scope.dispatchId } });
  const updated = upsertWorkerScope(run, {
    ...scope,
    updatedAt: new Date().toISOString(),
    status: structured.code === "worker-boundary-violation" || structured.code.startsWith("sandbox-") ? "rejected" : "failed",
    retryCount: typeof options.retryCount === "number" ? options.retryCount : scope.retryCount,
    feedbackIds: [...new Set([...(scope.feedbackIds || []), feedback.id])],
    errors: [...(scope.errors || []), structured],
  });
  // Byte-exact to the old build's updateWorkerScope: worker.json (scope)
  // AND manifest.json must both reflect the terminal park state — a bare
  // upsertWorkerScope only rewrites worker.json, leaving manifest.json
  // (what `cw worker manifest`/`cw worker show` and operators read)
  // stale at whatever retryCount/status it had at dispatch time.
  writeWorkerManifest(run, updated);
  writeWorkerIndex(run);
  if (options.persist !== false) saveCheckpoint(run);
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

/** MILESTONE 11 (reporting/observability) — `cw worker list [--status]`. */
export function listWorkerScopes(run: WorkflowRun, options: { status?: string } = {}): WorkerScope[] {
  ensureWorkerState(run);
  // Reload from disk and merge so a listing reflects the durable truth (and a
  // single corrupt worker.json is skipped, not fatal) — an in-memory-only slice
  // silently drops workers whenever run.workers was reset.
  const merged = mergeScopes((run.workers as unknown as WorkerScope[]) || [], loadWorkerScopesFromDisk(run));
  run.workers = merged as unknown as WorkflowRun["workers"];
  const workers = merged.slice().sort((a, b) => a.id.localeCompare(b.id));
  return options.status ? workers.filter((w) => w.status === options.status) : workers;
}

export interface WorkerSummary {
  total: number;
  byStatus: Record<string, number>;
  manifestPaths: string[];
  failed: Array<{ id: string; status: string; feedbackIds: string[] }>;
}

function countByStatus(workers: WorkerScope[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const w of workers) counts[w.status] = (counts[w.status] || 0) + 1;
  return counts;
}

/** `cw worker summary <run-id>` — the workbench `worker.summary` panel and
 *  report.ts's own worker rollup share this one function. */
export function summarizeWorkers(run: WorkflowRun): WorkerSummary {
  const workers = listWorkerScopes(run);
  return {
    total: workers.length,
    byStatus: countByStatus(workers),
    manifestPaths: workers.map((w) => manifestPath(w)),
    failed: workers.filter((w) => w.status === "failed" || w.status === "rejected").map((w) => ({ id: w.id, status: w.status, feedbackIds: w.feedbackIds || [] })),
  };
}

function countBucket(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function formatCountBucket(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return "none";
  return entries.map(([k, v]) => `${k}=${v}`).join(", ");
}

/** `cw worker summary <run-id>` human text — port of the old build's
 *  formatWorkerPanel (operator-ux/format.ts): a `Workers` rollup with
 *  status/sandbox/backend counts and one line per worker naming its
 *  sandbox profile and manifest path. */
export function formatWorkerSummaryText(run: WorkflowRun): string {
  const workers = listWorkerScopes(run);
  const lines = [
    "Workers",
    `  total=${workers.length}; status=${formatCountBucket(countBucket(workers.map((w) => w.status)))}; sandbox=${formatCountBucket(
      countBucket(workers.map((w) => w.sandboxProfileId || "none"))
    )}; backend=${formatCountBucket(countBucket(workers.map((w) => w.backendId || "none")))}`,
  ];
  for (const worker of workers.slice(0, 8)) {
    lines.push(`  ${worker.id}: ${worker.status}, task=${worker.taskId}, sandbox=${worker.sandboxProfileId || "none"}, backend=${worker.backendId || "none"}`);
    lines.push(`    manifest=${manifestPath(worker)}`);
    lines.push(`    result=${worker.resultPath}`);
    if ((worker.feedbackIds || []).length) lines.push(`    feedback=${worker.feedbackIds.join(", ")}`);
  }
  if (workers.length > 8) lines.push(`  ... ${workers.length - 8} more worker(s)`);
  return lines.join("\n");
}
