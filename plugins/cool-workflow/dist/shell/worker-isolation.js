"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORKER_ISOLATION_SCHEMA_VERSION = void 0;
exports.getWorkerScope = getWorkerScope;
exports.writeWorkerManifest = writeWorkerManifest;
exports.allocateWorkerScope = allocateWorkerScope;
exports.recordWorkerOutput = recordWorkerOutput;
exports.recordWorkerFailure = recordWorkerFailure;
exports.recordWorkerRetryAttempt = recordWorkerRetryAttempt;
exports.showWorkerManifest = showWorkerManifest;
exports.listWorkerScopes = listWorkerScopes;
exports.summarizeWorkers = summarizeWorkers;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const fs_atomic_1 = require("./fs-atomic");
const node_store_1 = require("./node-store");
const state_node_1 = require("../core/state/state-node");
const contract_1 = require("../core/pipeline/contract");
const result_normalize_1 = require("../core/pipeline/result-normalize");
const evidence_grounding_1 = require("../core/trust/evidence-grounding");
const trust_audit_1 = require("./trust-audit");
const sandbox_profile_1 = require("./sandbox-profile");
const verifier_1 = require("./verifier");
const runner_1 = require("../core/pipeline/runner");
const hash_1 = require("../core/hash");
const telemetry_attestation_1 = require("../core/trust/telemetry-attestation");
const telemetry_ledger_io_1 = require("./telemetry-ledger-io");
exports.WORKER_ISOLATION_SCHEMA_VERSION = 1;
function workerRoot(run) {
    return run.paths.workersDir || path.join(run.paths.runDir, "workers");
}
function ensureWorkerState(run) {
    run.paths.workersDir = run.paths.workersDir || path.join(run.paths.runDir, "workers");
    fs.mkdirSync(run.paths.workersDir, { recursive: true });
    run.workers = run.workers || [];
}
function manifestPath(scope) {
    return path.join(scope.workerDir, "manifest.json");
}
function scopePath(scope) {
    return path.join(scope.workerDir, "worker.json");
}
/** Deterministic worker id: the task plus a PER-TASK sequence (count of
 *  worker scopes already allocated for THIS task + 1) — byte-exact port
 *  of the old build's src/worker-isolation/paths.ts:38-42. Re-running the
 *  same workflow yields byte-identical worker ids while retries of the
 *  SAME task still get a fresh, unique id (workerId is excluded from the
 *  snapshot source fingerprint, so this does not change replay digests). */
function createWorkerId(run, taskId) {
    const prefix = `worker-${(0, fs_atomic_1.safeFileName)(taskId)}-`;
    const seq = (run.workers || []).filter((scope) => scope.id.startsWith(prefix)).length + 1;
    return `${prefix}${String(seq).padStart(4, "0")}`;
}
function getWorkerScope(run, workerId) {
    ensureWorkerState(run);
    const existing = (run.workers || []).find((s) => s.id === workerId);
    if (existing)
        return existing;
    const file = path.join(workerRoot(run), (0, fs_atomic_1.safeFileName)(workerId), "worker.json");
    if (!fs.existsSync(file))
        return undefined;
    const scope = JSON.parse(fs.readFileSync(file, "utf8"));
    upsertWorkerScope(run, scope);
    return scope;
}
function upsertWorkerScope(run, scope) {
    ensureWorkerState(run);
    const scopes = run.workers || [];
    const index = scopes.findIndex((s) => s.id === scope.id);
    run.workers = (index >= 0 ? scopes.map((s) => (s.id === scope.id ? scope : s)) : [...scopes, scope]);
    (0, fs_atomic_1.writeJson)(scopePath(scope), scope);
    return scope;
}
function writeWorkerIndex(run) {
    ensureWorkerState(run);
    (0, fs_atomic_1.writeJson)(path.join(workerRoot(run), "index.json"), {
        schemaVersion: exports.WORKER_ISOLATION_SCHEMA_VERSION,
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
            feedbackIds: scope.feedbackIds,
        })),
    });
}
function writeWorkerManifest(run, scope) {
    const task = run.tasks.find((t) => t.id === scope.taskId);
    const sandboxProfileId = scope.sandboxProfileId;
    const manifest = {
        schemaVersion: exports.WORKER_ISOLATION_SCHEMA_VERSION,
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
    (0, fs_atomic_1.writeJson)(manifestPath(scope), manifest);
    return manifest;
}
function writeWorkerInput(run, task, scope) {
    const lines = [
        `# Worker ${scope.id}`,
        "",
        `- Run: ${run.id}`,
        `- Task: ${task.id}`,
        `- Dispatch: ${scope.dispatchId || ""}`,
        `- Result: ${scope.resultPath}`,
        `- Artifacts: ${scope.artifactsDir}`,
        `- Logs: ${scope.logsDir}`,
        `- Sandbox Profile: ${scope.sandboxProfileId || sandbox_profile_1.DEFAULT_SANDBOX_PROFILE_ID}`,
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
        `- Write paths: ${(0, sandbox_profile_1.effectiveSandboxWritePaths)(scope.sandboxPolicy).join(", ") || "none"}.`,
        "- CW enforces result acceptance. The host is responsible for OS/process/network/environment sandbox enforcement.",
        "- Do not mutate state.json, nodes/, feedback/, dispatches/, or commits/ directly.",
        "",
    ];
    fs.writeFileSync(scope.inputPath, lines.join("\n"), "utf8");
}
function allocateWorkerScope(run, task, options = {}) {
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
    const workerDir = path.join(workerRoot(run), (0, fs_atomic_1.safeFileName)(workerId));
    const inputPath = path.join(workerDir, "input.md");
    const resultPath = path.join(workerDir, "result.md");
    const artifactsDir = path.join(workerDir, "artifacts");
    const logsDir = path.join(workerDir, "logs");
    const sandboxProfileId = options.sandboxProfileId || sandbox_profile_1.DEFAULT_SANDBOX_PROFILE_ID;
    const sandboxPolicy = (0, sandbox_profile_1.sandboxPolicyForWorker)(sandboxProfileId, {
        cwd: run.cwd,
        runDir: run.paths.runDir,
        workerDir,
        inputPath,
        resultPath,
        artifactsDir,
        logsDir,
        customProfiles: run.customSandboxProfiles,
    });
    const allowedPaths = (0, sandbox_profile_1.effectiveSandboxWritePaths)(sandboxPolicy);
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
    const scope = {
        schemaVersion: exports.WORKER_ISOLATION_SCHEMA_VERSION,
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
        backendId: options.backendId,
        stateNodeId: task.stateNodeId,
        feedbackIds: [],
        errors: [],
        metadata: options.metadata,
    };
    writeWorkerInput(run, task, scope);
    writeWorkerManifest(run, scope);
    upsertWorkerScope(run, scope);
    (0, trust_audit_1.recordTrustAuditEvent)(run, {
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
function requireWorkerScope(run, workerId) {
    const scope = getWorkerScope(run, workerId);
    if (!scope)
        throw new Error(`Unknown worker for run ${run.id}: ${workerId}`);
    return scope;
}
function requireWorkerTask(run, scope) {
    const task = run.tasks.find((t) => t.id === scope.taskId);
    if (!task)
        throw new Error(`Unknown task for worker ${scope.id}: ${scope.taskId}`);
    return task;
}
/** recordWorkerOutput — the accept-path orchestrator. Order: validate ->
 *  attest delegation -> accept -> verify -> completion (byte-exact to the
 *  old build; multi-agent fan-out is a no-op here). */
function recordWorkerOutput(run, workerId, resultPath, options = {}) {
    const scope = requireWorkerScope(run, workerId);
    const task = requireWorkerTask(run, scope);
    const absoluteResultPath = path.resolve(resultPath);
    // Step 1: sandbox boundary + result-file existence + envelope contract.
    const violation = (0, sandbox_profile_1.validateSandboxWrite)(scope.sandboxPolicy, absoluteResultPath, workerId);
    if (violation) {
        (0, trust_audit_1.recordSandboxPathDecision)(run, { workerId, taskId: task.id, sandboxProfileId: scope.sandboxProfileId, policySnapshot: scope.sandboxPolicy, target: absoluteResultPath, decision: "denied", metadata: { code: violation.code } });
        recordWorkerFailure(run, workerId, violation.message, { code: violation.code, retryable: false });
        throw new Error(violation.message);
    }
    if (!fs.existsSync(absoluteResultPath)) {
        recordWorkerFailure(run, workerId, `Worker result file does not exist: ${absoluteResultPath}`, { code: "worker-result-missing", retryable: true });
        throw new Error(`Worker result file does not exist: ${absoluteResultPath}`);
    }
    const rawResult = fs.readFileSync(absoluteResultPath, "utf8");
    let parsedResult;
    try {
        parsedResult = (0, result_normalize_1.normalizeResultEnvelope)(rawResult);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        recordWorkerFailure(run, workerId, message, { code: "result-parse-error", retryable: false });
        throw error;
    }
    if ((0, verifier_1.taskRequiresEvidence)(task) && !parsedResult.evidence.some((e) => (0, evidence_grounding_1.isGroundedEvidence)(e))) {
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
        ? (0, telemetry_attestation_1.verifyTelemetryAttestation)(delegation.reportedUsage, delegation.usageSignature, (0, telemetry_attestation_1.resolveTrustPublicKey)(delegation.usageTrustPublicKey), {
            runId: run.id,
            taskId: task.id,
            promptDigest: delegation.promptDigest,
            resultDigest: (0, hash_1.sha256)(rawResult),
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
            schemaVersion: 1,
            backendId: "agent",
            handle: delegation.handle,
            model: delegation.model,
            promptDigest: delegation.promptDigest,
            resultDigest: (0, hash_1.sha256)(rawResult),
            command: delegation.command,
            args: delegation.args,
            exitCode: delegation.exitCode,
            ...(delegation.reportedUsage ? { reportedUsage: delegation.reportedUsage } : {}),
            ...(delegation.usageSignature ? { usageSignature: delegation.usageSignature } : {}),
            ...(telemetry ? { usageAttestation: telemetry.status, usageAttestationReason: telemetry.reason } : {}),
        }
        : undefined;
    // Step 3: accept — the irreversible mutation.
    const pathAudit = (0, trust_audit_1.recordSandboxPathDecision)(run, { workerId, taskId: task.id, sandboxProfileId: scope.sandboxProfileId, policySnapshot: scope.sandboxPolicy, target: absoluteResultPath, decision: "allowed", metadata: { operation: "worker-output-acceptance" } });
    const destination = path.join(run.paths.resultsDir, `${(0, fs_atomic_1.safeFileName)(task.id)}.md`);
    fs.mkdirSync(run.paths.resultsDir, { recursive: true });
    fs.copyFileSync(absoluteResultPath, destination);
    task.status = "completed";
    task.completedAt = new Date().toISOString();
    task.resultPath = destination;
    task.loopStage = "observe";
    task.result = parsedResult;
    const evidence = (0, trust_audit_1.normalizeEvidence)(run, parsedResult.evidence.map((entry, index) => ({ id: `result:${index + 1}`, source: "cw:result", locator: entry, summary: entry })), { source: "cw-validated", workerId, taskId: task.id, auditEventIds: [pathAudit.id] });
    let resultNode = (0, state_node_1.createStateNode)({
        id: `${run.id}:result:${task.id}`,
        kind: "result",
        status: "completed",
        loopStage: "observe",
        inputs: { taskId: task.id, dispatchId: task.dispatchId, workerId },
        outputs: parsedResult,
        artifacts: [
            { id: "result", kind: "markdown", path: destination },
            { id: "worker-result", kind: "markdown", path: absoluteResultPath },
        ],
        evidence,
        parents: task.dispatchId ? [`${run.id}:dispatch:${task.dispatchId}`] : [String(task.stateNodeId || `${run.id}:task:${task.id}`)],
        contractId: contract_1.DEFAULT_PIPELINE_CONTRACT_ID,
        metadata: {
            taskId: task.id,
            workerId,
            workerDir: scope.workerDir,
            sandboxProfileId: scope.sandboxProfileId,
            auditEventIds: [pathAudit.id],
            ...((0, result_normalize_1.isEmptyCapture)(parsedResult) ? { captureWarning: "no findings or evidence captured from result.md" } : {}),
            ...(agentDelegationMeta ? { agentDelegation: agentDelegationMeta } : {}),
        },
    });
    const acceptedAudit = (0, trust_audit_1.recordTrustAuditEvent)(run, {
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
    resultNode.evidence = (0, trust_audit_1.normalizeEvidence)(run, resultNode.evidence, { source: "cw-validated", workerId, taskId: task.id, resultNodeId: resultNode.id, auditEventIds: [pathAudit.id, acceptedAudit.id] });
    resultNode = (0, node_store_1.appendRunNode)(run, resultNode);
    task.resultNodeId = resultNode.id;
    if ((0, result_normalize_1.isEmptyCapture)(parsedResult)) {
        (0, trust_audit_1.recordTrustAuditEvent)(run, { kind: "worker.capture-warning", decision: "recorded", source: "cw-validated", workerId, taskId: task.id, nodeId: resultNode.id, parentEventIds: [acceptedAudit.id], metadata: { reason: "no findings or evidence captured from result.md", resultPath: destination } });
    }
    if (delegation && agentDelegationMeta) {
        // Track 1 (tamper-evidence): bind this verdict into the append-only,
        // hash-chained telemetry ledger BEFORE the audit event, so the event
        // can cross-link the record hash. Editing the recorded verdict/usage
        // later breaks the chain (verifyTelemetryLedger). Only when a
        // verdict was computed (every agent hop gets one, even "absent").
        const ledgerRecord = agentDelegationMeta.usageAttestation
            ? (0, telemetry_ledger_io_1.appendTelemetryAttestation)(run, {
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
        (0, trust_audit_1.recordTrustAuditEvent)(run, {
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
    const verifierResult = (0, runner_1.runPipelineStage)(run, "verify", resultNode.id, {
        outputNodeId: `${run.id}:verifier:${task.id}`,
        outputStatus: "verified",
        loopStage: "adjust",
        outputs: { accepted: true, workerId },
        artifacts: [{ id: "result", kind: "markdown", path: destination }],
        evidence: resultNode.evidence.length ? resultNode.evidence : [{ id: "result:summary", source: "summary", summary: parsedResult.summary }],
        metadata: { taskId: task.id, workerId, resultNodeId: resultNode.id, sandboxProfileId: scope.sandboxProfileId },
    }, { persist: false, persistNode: node_store_1.appendRunNode });
    task.verifierNodeId = verifierResult.outputNodeId;
    // Step 5: completion — persist the worker scope with the verify-derived status.
    const output = { workerId, taskId: task.id, resultPath: absoluteResultPath, recordedAt: new Date().toISOString(), stateNodeId: resultNode.id, verifierNodeId: task.verifierNodeId, auditEventIds: [pathAudit.id, acceptedAudit.id] };
    const reportedModel = agentDelegationMeta && agentDelegationMeta.model && agentDelegationMeta.model !== "unreported" ? agentDelegationMeta.model : undefined;
    const usageRecord = agentDelegationMeta && (reportedModel || agentDelegationMeta.reportedUsage) ? { schemaVersion: 1, source: "host-attested", ...(reportedModel ? { model: reportedModel } : {}), ...(agentDelegationMeta.reportedUsage || {}), attestedAt: new Date().toISOString() } : undefined;
    const updatedScope = {
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
function sha256Local(value) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createHash } = require("node:crypto");
    return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
function recordWorkerFailure(run, workerId, error, options = {}) {
    const scope = requireWorkerScope(run, workerId);
    const task = requireWorkerTask(run, scope);
    const message = error instanceof Error ? error.message : String(error);
    const structured = { code: options.code || "worker-runtime-error", message, at: new Date().toISOString(), path: options.path, retryable: options.retryable ?? false };
    const failureNodeId = `${run.id}:worker:${(0, fs_atomic_1.safeFileName)(workerId)}:failure:${scope.errors.length + 1}`;
    let failureNode = (0, state_node_1.recordNodeError)((0, state_node_1.createStateNode)({ id: failureNodeId, kind: "error", status: "pending", loopStage: "adjust", inputs: { workerId, taskId: task.id, dispatchId: scope.dispatchId }, parents: task.stateNodeId ? [String(task.stateNodeId)] : [], contractId: contract_1.DEFAULT_PIPELINE_CONTRACT_ID, metadata: { workerId, taskId: task.id, dispatchId: scope.dispatchId, workerDir: scope.workerDir, sandboxProfileId: scope.sandboxProfileId } }), structured);
    if (task.stateNodeId) {
        const parent = (run.nodes || []).find((n) => n.id === task.stateNodeId);
        if (parent) {
            const [linkedParent, linkedChild] = (0, state_node_1.linkStateNodes)(parent, failureNode);
            (0, node_store_1.appendRunNode)(run, linkedParent);
            failureNode = linkedChild;
        }
    }
    failureNode = (0, node_store_1.appendRunNode)(run, failureNode);
    task.status = "failed";
    task.loopStage = "adjust";
    (0, trust_audit_1.recordTrustAuditEvent)(run, { kind: "worker.failure", decision: structured.code === "worker-boundary-violation" || structured.code.startsWith("sandbox-") ? "denied" : "failed", source: structured.code.startsWith("sandbox-") || structured.code === "worker-boundary-violation" ? "cw-validated" : "runtime-derived", workerId, taskId: task.id, nodeId: failureNode.id, sandboxProfileId: scope.sandboxProfileId, policySnapshot: scope.sandboxPolicy, normalizedPath: structured.path, metadata: { code: structured.code, dispatchId: scope.dispatchId } });
    const updated = upsertWorkerScope(run, {
        ...scope,
        updatedAt: new Date().toISOString(),
        status: structured.code === "worker-boundary-violation" || structured.code.startsWith("sandbox-") ? "rejected" : "failed",
        retryCount: typeof options.retryCount === "number" ? options.retryCount : scope.retryCount,
        errors: [...(scope.errors || []), structured],
    });
    // Byte-exact to the old build's updateWorkerScope: worker.json (scope)
    // AND manifest.json must both reflect the terminal park state — a bare
    // upsertWorkerScope only rewrites worker.json, leaving manifest.json
    // (what `cw worker manifest`/`cw worker show` and operators read)
    // stale at whatever retryCount/status it had at dispatch time.
    writeWorkerManifest(run, updated);
    writeWorkerIndex(run);
    return updated;
}
function recordWorkerRetryAttempt(run, workerId, attempts, reason) {
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
function showWorkerManifest(run, workerId) {
    const scope = requireWorkerScope(run, workerId);
    const task = run.tasks.find((t) => t.id === scope.taskId);
    return { resultPath: scope.resultPath, inputPath: scope.inputPath, manifestPath: manifestPath(scope), workerDir: scope.workerDir, prompt: task?.prompt, sandboxPolicy: scope.sandboxPolicy };
}
/** MILESTONE 11 (reporting/observability) — `cw worker list [--status]`. */
function listWorkerScopes(run, options = {}) {
    const workers = (run.workers || []).slice().sort((a, b) => a.id.localeCompare(b.id));
    return options.status ? workers.filter((w) => w.status === options.status) : workers;
}
function countByStatus(workers) {
    const counts = {};
    for (const w of workers)
        counts[w.status] = (counts[w.status] || 0) + 1;
    return counts;
}
/** `cw worker summary <run-id>` — the workbench `worker.summary` panel and
 *  report.ts's own worker rollup share this one function. */
function summarizeWorkers(run) {
    const workers = listWorkerScopes(run);
    return {
        total: workers.length,
        byStatus: countByStatus(workers),
        manifestPaths: workers.map((w) => manifestPath(w)),
        failed: workers.filter((w) => w.status === "failed" || w.status === "rejected").map((w) => ({ id: w.id, status: w.status, feedbackIds: w.feedbackIds || [] })),
    };
}
