"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORKER_ISOLATION_SCHEMA_VERSION = void 0;
exports.createWorkerIsolation = createWorkerIsolation;
exports.allocateWorkerScope = allocateWorkerScope;
exports.writeWorkerManifest = writeWorkerManifest;
exports.listWorkerScopes = listWorkerScopes;
exports.getWorkerScope = getWorkerScope;
exports.recordWorkerOutput = recordWorkerOutput;
exports.recordWorkerFailure = recordWorkerFailure;
exports.validateWorkerBoundary = validateWorkerBoundary;
exports.summarizeWorkers = summarizeWorkers;
exports.reclaimOrphans = reclaimOrphans;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("./state");
const pipeline_contract_1 = require("./pipeline-contract");
const error_feedback_1 = require("./error-feedback");
const state_node_1 = require("./state-node");
const pipeline_runner_1 = require("./pipeline-runner");
const verifier_1 = require("./verifier");
const evidence_grounding_1 = require("./evidence-grounding");
const result_normalize_1 = require("./result-normalize");
const sandbox_profile_1 = require("./sandbox-profile");
const execution_backend_1 = require("./execution-backend");
const trust_audit_1 = require("./trust-audit");
const multi_agent_1 = require("./multi-agent");
const coordinator_1 = require("./coordinator");
exports.WORKER_ISOLATION_SCHEMA_VERSION = 1;
function createWorkerIsolation(options = {}) {
    return {
        allocateWorkerScope: (run, task, allocateOptions) => allocateWorkerScope(run, task, { ...options, ...allocateOptions }),
        writeWorkerManifest,
        listWorkerScopes: (run, listOptions) => listWorkerScopes(run, listOptions),
        getWorkerScope,
        recordWorkerOutput,
        recordWorkerFailure,
        validateWorkerBoundary,
        summarizeWorkers
    };
}
function allocateWorkerScope(run, task, options = {}) {
    ensureWorkerState(run);
    const existing = task.workerId ? getWorkerScope(run, task.workerId) : undefined;
    if (existing)
        return existing;
    const now = new Date().toISOString();
    const workerId = options.workerId || createWorkerId(run, task.id);
    const workerDir = node_path_1.default.join(workerRoot(run), (0, state_1.safeFileName)(workerId));
    const inputPath = node_path_1.default.join(workerDir, "input.md");
    const resultPath = node_path_1.default.join(workerDir, "result.md");
    const artifactsDir = node_path_1.default.join(workerDir, "artifacts");
    const logsDir = node_path_1.default.join(workerDir, "logs");
    const sandboxProfileId = options.sandboxProfileId || options.policy?.sandboxProfileId || sandbox_profile_1.DEFAULT_SANDBOX_PROFILE_ID;
    const sandboxPolicy = (0, sandbox_profile_1.sandboxPolicyForWorker)(sandboxProfileId, {
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
        allowLogs: options.policy?.allowLogs
    });
    const allowedPaths = (0, sandbox_profile_1.effectiveSandboxWritePaths)(sandboxPolicy);
    (0, sandbox_profile_1.upsertRunSandboxPolicy)(run, sandboxPolicy);
    // Execution backend selection (mechanism vs policy): the worker scope records
    // WHICH backend was selected + its sandbox attestation. The dispatch path is a
    // delegate-host execution (the host runs the worker), so the backend enforces
    // only CW's own worker-output acceptance and attests the rest — reproducing
    // pre-v0.1.29 behavior exactly for the default (node) backend. Only recorded
    // when a backend was explicitly selected.
    const backendSelection = options.backendSelection || (options.backendId ? (0, execution_backend_1.resolveBackendSelection)(options.backendId) : undefined);
    const backendId = backendSelection?.backendId;
    const backendAttestation = backendId
        ? options.backendAttestation || (0, execution_backend_1.attestSandbox)((0, execution_backend_1.getBackendDescriptor)(backendId), sandboxPolicy, { mode: "delegate-host" })
        : undefined;
    node_fs_1.default.mkdirSync(artifactsDir, { recursive: true });
    node_fs_1.default.mkdirSync(logsDir, { recursive: true });
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
    (0, trust_audit_1.recordTrustAuditEvent)(run, {
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
        (0, trust_audit_1.recordTrustAuditEvent)(run, {
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
    if (options.persist !== false)
        (0, state_1.saveCheckpoint)(run);
    return scope;
}
function writeWorkerManifest(run, scope) {
    const task = run.tasks.find((candidate) => candidate.id === scope.taskId);
    const sandboxPolicy = scope.sandboxPolicy || sandboxPolicyForBoundary(run, scope);
    const sandboxProfileId = scope.sandboxProfileId || sandboxPolicy.id;
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
        backend: scope.backendId && scope.backendAttestation
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
    (0, state_1.writeJson)(manifestPath(scope), manifest);
    return manifest;
}
function listWorkerScopes(run, options = {}) {
    ensureWorkerState(run);
    const scopes = loadWorkerScopesFromDisk(run);
    run.workers = mergeScopes(run.workers || [], scopes);
    const listed = run.workers || [];
    return options.status ? listed.filter((scope) => scope.status === options.status) : listed;
}
function getWorkerScope(run, workerId) {
    ensureWorkerState(run);
    const existing = (run.workers || []).find((scope) => scope.id === workerId);
    if (existing)
        return existing;
    const file = node_path_1.default.join(workerRoot(run), (0, state_1.safeFileName)(workerId), "worker.json");
    if (!node_fs_1.default.existsSync(file))
        return undefined;
    const scope = JSON.parse(node_fs_1.default.readFileSync(file, "utf8"));
    upsertWorkerScope(run, scope);
    return scope;
}
function recordWorkerOutput(run, workerId, resultPath, options = {}) {
    const scope = requireWorkerScope(run, workerId);
    const task = requireWorkerTask(run, scope);
    const absoluteResultPath = node_path_1.default.resolve(resultPath);
    const violation = validateWorkerBoundary(run, workerId, { ...options, policy: options.policy, path: absoluteResultPath });
    if (violation) {
        (0, trust_audit_1.recordSandboxPathDecision)(run, {
            workerId,
            taskId: task.id,
            sandboxProfileId: scope.sandboxProfileId,
            policySnapshot: scope.sandboxPolicy,
            target: absoluteResultPath,
            decision: "denied",
            metadata: { code: violation.code, allowedPaths: violation.allowedPaths }
        });
        recordWorkerFailure(run, workerId, violation, { ...options, path: absoluteResultPath, code: violation.code, retryable: false });
        throw new Error(violation.message);
    }
    if (!node_fs_1.default.existsSync(absoluteResultPath)) {
        const error = structuredError("worker-result-missing", `Worker result file does not exist: ${absoluteResultPath}`, {
            path: absoluteResultPath,
            retryable: true
        });
        recordWorkerFailure(run, workerId, error, { ...options, persist: options.persist });
        throw new Error(error.message);
    }
    const rawResult = node_fs_1.default.readFileSync(absoluteResultPath, "utf8");
    const parsedResult = (0, verifier_1.parseResultEnvelope)(rawResult);
    (0, verifier_1.validateResultEnvelope)(task, parsedResult);
    // Strict evidence resolution (v0.1.40 self-audit P1, opt-in via
    // CW_REQUIRE_RESOLVABLE_EVIDENCE): fail closed if the result cites file-style
    // evidence that does not resolve on disk, so a worker cannot land a result
    // whose evidence locators point nowhere. Off by default — the default gate is
    // the deterministic grounding check in validateResultEnvelope.
    if ((0, evidence_grounding_1.requireResolvableEvidence)()) {
        const baseDirs = Array.from(new Set([run.cwd, process.cwd(), scope.workerDir, run.paths.runDir].filter(Boolean)));
        const unresolved = (0, evidence_grounding_1.unresolvedFileEvidence)(parsedResult.evidence, baseDirs);
        if (unresolved.length) {
            const error = structuredError("worker-evidence-unresolvable", `Worker ${workerId} result cites file evidence that does not resolve on disk: ${unresolved.join(", ")}`, { path: absoluteResultPath, retryable: false });
            recordWorkerFailure(run, workerId, error, { ...options, persist: options.persist });
            throw new Error(error.message);
        }
    }
    // Agent Delegation Drive (v0.1.38): if this worker's result.md was produced by an
    // EXTERNAL agent, record the agent-hop attestation AS PROVENANCE — the agent
    // (kind:process) handle, the agent-REPORTED model (never CW_AGENT_MODEL), the
    // prompt digest, the secret-stripped args, and the result digest computed HERE
    // from the accepted result.md. These live in the result node's metadata (covered
    // by the v0.1.35 snapshot body) + a trust-audit event, NEVER in `evidence`.
    const agentDelegation = options.agentDelegation
        ? {
            schemaVersion: 1,
            backendId: "agent",
            handle: options.agentDelegation.handle,
            model: options.agentDelegation.model,
            promptDigest: options.agentDelegation.promptDigest,
            resultDigest: (0, execution_backend_1.sha256)(rawResult),
            command: options.agentDelegation.command,
            args: options.agentDelegation.args,
            exitCode: options.agentDelegation.exitCode
        }
        : undefined;
    const pathAudit = (0, trust_audit_1.recordSandboxPathDecision)(run, {
        workerId,
        taskId: task.id,
        sandboxProfileId: scope.sandboxProfileId,
        policySnapshot: scope.sandboxPolicy,
        target: absoluteResultPath,
        decision: "allowed",
        metadata: { operation: "worker-output-acceptance" }
    });
    const destination = node_path_1.default.join(run.paths.resultsDir, `${(0, state_1.safeFileName)(task.id)}.md`);
    node_fs_1.default.mkdirSync(run.paths.resultsDir, { recursive: true });
    node_fs_1.default.copyFileSync(absoluteResultPath, destination);
    task.status = "completed";
    task.completedAt = new Date().toISOString();
    task.resultPath = destination;
    task.loopStage = "observe";
    task.result = parsedResult;
    const evidence = (0, trust_audit_1.normalizeEvidence)(run, parsedResult.evidence.map((entry, index) => ({
        id: `result:${index + 1}`,
        source: "cw:result",
        locator: entry,
        summary: entry
    })), { source: "cw-validated", workerId, taskId: task.id, auditEventIds: [pathAudit.id] });
    const resultNode = (0, state_node_1.appendRunNode)(run, (0, state_node_1.createStateNode)({
        id: `${run.id}:result:${task.id}`,
        kind: "result",
        status: "completed",
        loopStage: "observe",
        inputs: { taskId: task.id, dispatchId: task.dispatchId, workerId },
        outputs: parsedResult,
        artifacts: [
            { id: "result", kind: "markdown", path: destination },
            { id: "worker-result", kind: "markdown", path: absoluteResultPath }
        ],
        evidence,
        parents: task.dispatchId ? [`${run.id}:dispatch:${task.dispatchId}`] : [task.stateNodeId || `${run.id}:task:${task.id}`],
        contractId: pipeline_contract_1.DEFAULT_PIPELINE_CONTRACT_ID,
        metadata: {
            taskId: task.id,
            workerId,
            workerDir: scope.workerDir,
            sandboxProfileId: scope.sandboxProfileId,
            auditEventIds: [pathAudit.id],
            // Empty-capture warning (v0.1.42): even after robust normalization the result
            // yielded NO findings and NO evidence — surfaced, never silently passed.
            ...((0, result_normalize_1.isEmptyCapture)(parsedResult) ? { captureWarning: "no findings or evidence captured from result.md" } : {}),
            // Folded into the snapshotted node body so v0.1.35 replay re-verifies the
            // prompt/result/model digests WITHOUT re-spawning the agent. NOT evidence.
            ...(agentDelegation ? { agentDelegation } : {})
        }
    }));
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
        metadata: { destination }
    });
    resultNode.evidence = (0, trust_audit_1.normalizeEvidence)(run, resultNode.evidence, {
        source: "cw-validated",
        workerId,
        taskId: task.id,
        resultNodeId: resultNode.id,
        auditEventIds: [pathAudit.id, acceptedAudit.id]
    });
    (0, state_node_1.appendRunNode)(run, resultNode);
    task.resultNodeId = resultNode.id;
    // Warn (don't silently pass) when a worker's result captured no structured signal
    // at all — the v0.1.41 self-audit's "accepted with evidenceCount:0" failure mode.
    if ((0, result_normalize_1.isEmptyCapture)(parsedResult)) {
        (0, trust_audit_1.recordTrustAuditEvent)(run, {
            kind: "worker.capture-warning",
            decision: "recorded",
            source: "cw-validated",
            workerId,
            taskId: task.id,
            nodeId: resultNode.id,
            parentEventIds: [acceptedAudit.id],
            metadata: { reason: "no findings or evidence captured from result.md", resultPath: destination }
        });
    }
    // The agent-hop attestation event — hung off worker.output, alongside
    // worker.backend. Recorded in trust-audit/provenance, NEVER in node evidence.
    if (agentDelegation) {
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
                backendId: agentDelegation.backendId,
                handleKind: agentDelegation.handle.kind,
                handleRef: agentDelegation.handle.ref,
                model: agentDelegation.model,
                promptDigest: agentDelegation.promptDigest,
                resultDigest: agentDelegation.resultDigest,
                command: agentDelegation.command,
                args: agentDelegation.args,
                exitCode: agentDelegation.exitCode
            }
        });
    }
    const verifierResult = (0, pipeline_runner_1.createPipelineRunner)({ persist: false }).runPipelineStage(run, "verify", resultNode.id, {
        outputNodeId: `${run.id}:verifier:${task.id}`,
        outputStatus: "verified",
        loopStage: "adjust",
        outputs: { accepted: true, workerId },
        artifacts: [{ id: "result", kind: "markdown", path: destination }],
        evidence: resultNode.evidence.length
            ? resultNode.evidence
            : [{ id: "result:summary", source: "summary", summary: parsedResult.summary }],
        metadata: { taskId: task.id, workerId, resultNodeId: resultNode.id, sandboxProfileId: scope.sandboxProfileId }
    });
    task.verifierNodeId = verifierResult.outputNodeId;
    const output = {
        workerId,
        taskId: task.id,
        resultPath: absoluteResultPath,
        recordedAt: new Date().toISOString(),
        stateNodeId: resultNode.id,
        verifierNodeId: verifierResult.outputNodeId,
        auditEventIds: [pathAudit.id, acceptedAudit.id]
    };
    updateWorkerScope(run, {
        ...scope,
        updatedAt: new Date().toISOString(),
        status: verifierResult.status === "advanced" ? "verified" : "completed",
        resultNodeId: resultNode.id,
        output,
        // Host-attested usage model rides on the worker record. Only when the agent
        // REPORTED a model — `unreported` is recorded as ABSENT (never backfilled from
        // the operator-chosen CW_AGENT_MODEL).
        ...(agentDelegation && agentDelegation.model && agentDelegation.model !== "unreported"
            ? {
                usage: {
                    schemaVersion: 1,
                    source: "host-attested",
                    model: agentDelegation.model,
                    attestedAt: new Date().toISOString(),
                    note: "agent-delegation host-attested model"
                }
            }
            : {})
    });
    const blackboardLinks = publishWorkerOutputToBlackboard(run, scope, task, parsedResult.summary, destination, absoluteResultPath, resultNode.evidence, acceptedAudit.id);
    (0, multi_agent_1.recordMultiAgentWorkerOutput)(run, {
        workerId,
        taskId: task.id,
        resultNodeId: resultNode.id,
        verifierNodeId: verifierResult.outputNodeId,
        evidence: resultNode.evidence,
        artifactPaths: [destination, absoluteResultPath],
        blackboardMessageIds: blackboardLinks.messageIds,
        blackboardArtifactRefIds: blackboardLinks.artifactRefIds
    });
    if (options.persist !== false)
        (0, state_1.saveCheckpoint)(run);
    return output;
}
function recordWorkerFailure(run, workerId, error, options = {}) {
    const scope = requireWorkerScope(run, workerId);
    const task = requireWorkerTask(run, scope);
    const structured = normalizeWorkerError(error, scope, options);
    const failureNodeId = `${run.id}:worker:${(0, state_1.safeFileName)(workerId)}:failure:${scope.errors.length + 1}`;
    let failureNode = (0, state_node_1.recordNodeError)((0, state_node_1.createStateNode)({
        id: failureNodeId,
        kind: "error",
        status: "pending",
        loopStage: "adjust",
        inputs: { workerId, taskId: task.id, dispatchId: scope.dispatchId },
        artifacts: workerArtifacts(scope),
        parents: task.stateNodeId ? [task.stateNodeId] : [],
        contractId: pipeline_contract_1.DEFAULT_PIPELINE_CONTRACT_ID,
        metadata: { workerId, taskId: task.id, dispatchId: scope.dispatchId, workerDir: scope.workerDir, sandboxProfileId: scope.sandboxProfileId }
    }), structured);
    if (task.stateNodeId) {
        const parent = run.nodes?.find((candidate) => candidate.id === task.stateNodeId);
        if (parent) {
            const linked = (0, state_node_1.linkStateNodes)(parent, failureNode);
            (0, state_node_1.appendRunNode)(run, linked[0]);
            failureNode = linked[1];
        }
    }
    (0, state_node_1.appendRunNode)(run, failureNode);
    task.status = "failed";
    task.loopStage = "adjust";
    const feedback = (0, error_feedback_1.recordFeedback)(run, {
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
    }, { persist: false });
    (0, trust_audit_1.recordTrustAuditEvent)(run, {
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
        feedbackIds: unique([...(scope.feedbackIds || []), feedback.id]),
        errors: [...(scope.errors || []), structured]
    });
    if (options.persist !== false)
        (0, state_1.saveCheckpoint)(run);
    return requireWorkerScope(run, workerId);
}
function validateWorkerBoundary(run, workerId, options = {}) {
    const scope = requireWorkerScope(run, workerId);
    const rawPath = String(options.path || scope.resultPath);
    return (0, sandbox_profile_1.validateSandboxWrite)(sandboxPolicyForBoundary(run, scope, options), rawPath, workerId);
}
function summarizeWorkers(run) {
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
function reclaimOrphans(run, now) {
    const nowMs = now ? Date.parse(now) : Date.now();
    if (!Number.isFinite(nowMs))
        throw new Error("Invalid reclaim 'now': " + String(now));
    const orphans = [];
    const activeStatuses = new Set(["allocated", "running"]);
    for (const scope of run.workers || []) {
        if (!activeStatuses.has(scope.status))
            continue;
        if (!scope.timeoutMs || scope.timeoutMs <= 0)
            continue;
        const createdAtMs = Date.parse(scope.createdAt);
        if (!Number.isFinite(createdAtMs))
            continue;
        const elapsedMs = nowMs - createdAtMs;
        if (elapsedMs < scope.timeoutMs)
            continue;
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
        saveWorkerCheckpoint(run);
    }
    return { runId: run.id, reclaimed: orphans.length, orphans };
}
function saveWorkerCheckpoint(run) {
    // Durable write via atomic temp+rename (same contract as saveCheckpoint)
    // For worker index, the atomic write in writeWorkerIndex already handles it.
    // This is a no-op wrapper that signals the checkpoint boundary.
}
function ensureWorkerState(run) {
    run.paths.workersDir = run.paths.workersDir || node_path_1.default.join(run.paths.runDir, "workers");
    node_fs_1.default.mkdirSync(run.paths.workersDir, { recursive: true });
    run.workers = run.workers || [];
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
        `- Write paths: ${(0, sandbox_profile_1.effectiveSandboxWritePaths)(sandboxPolicyForBoundary(run, scope)).join(", ") || "none"}.`,
        "- CW enforces result acceptance. The host is responsible for OS/process/network/environment sandbox enforcement.",
        "- Do not mutate state.json, nodes/, feedback/, dispatches/, or commits/ directly.",
        ""
    ];
    node_fs_1.default.writeFileSync(scope.inputPath, lines.join("\n"), "utf8");
}
function upsertWorkerScope(run, scope) {
    ensureWorkerState(run);
    const scopes = run.workers || [];
    const index = scopes.findIndex((candidate) => candidate.id === scope.id);
    run.workers = index >= 0 ? scopes.map((candidate) => (candidate.id === scope.id ? scope : candidate)) : [...scopes, scope];
    writeWorkerScope(scope);
    return scope;
}
function updateWorkerScope(run, scope) {
    const updated = upsertWorkerScope(run, scope);
    writeWorkerManifest(run, updated);
    writeWorkerIndex(run);
    return updated;
}
function writeWorkerScope(scope) {
    (0, state_1.writeJson)(node_path_1.default.join(scope.workerDir, "worker.json"), scope);
}
function writeWorkerIndex(run) {
    ensureWorkerState(run);
    (0, state_1.writeJson)(node_path_1.default.join(workerRoot(run), "index.json"), {
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
            multiAgent: scope.multiAgent,
            feedbackIds: scope.feedbackIds
        }))
    });
}
function loadWorkerScopesFromDisk(run) {
    ensureWorkerState(run);
    if (!node_fs_1.default.existsSync(workerRoot(run)))
        return [];
    return node_fs_1.default
        .readdirSync(workerRoot(run), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => node_path_1.default.join(workerRoot(run), entry.name, "worker.json"))
        .filter((file) => node_fs_1.default.existsSync(file))
        .map((file) => JSON.parse(node_fs_1.default.readFileSync(file, "utf8")));
}
function requireWorkerScope(run, workerId) {
    const scope = getWorkerScope(run, workerId);
    if (!scope)
        throw new Error(`Unknown worker for run ${run.id}: ${workerId}`);
    return scope;
}
function requireWorkerTask(run, scope) {
    const task = run.tasks.find((candidate) => candidate.id === scope.taskId);
    if (!task)
        throw new Error(`Unknown task for worker ${scope.id}: ${scope.taskId}`);
    return task;
}
function workerRoot(run) {
    return run.paths.workersDir || node_path_1.default.join(run.paths.runDir, "workers");
}
function sandboxPolicyForBoundary(run, scope, options = {}) {
    if (scope.sandboxPolicy && !options.policy && !options.sandboxProfileId)
        return scope.sandboxPolicy;
    const profileId = options.sandboxProfileId || options.policy?.sandboxProfileId || scope.sandboxProfileId || sandbox_profile_1.DEFAULT_SANDBOX_PROFILE_ID;
    return (0, sandbox_profile_1.sandboxPolicyForWorker)(profileId, {
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
        allowLogs: options.policy?.allowLogs
    });
}
function blackboardManifest(run, scope) {
    const linkage = blackboardLinkage(run, scope);
    if (!linkage.blackboardId)
        return undefined;
    const root = run.paths.blackboardDir || node_path_1.default.join(run.paths.runDir, "blackboard");
    return {
        id: linkage.blackboardId,
        topicIds: linkage.topicIds,
        indexPath: node_path_1.default.join(root, "index.json"),
        messagesPath: node_path_1.default.join(root, "messages.jsonl"),
        topicsDir: node_path_1.default.join(root, "topics"),
        contextsDir: node_path_1.default.join(root, "contexts"),
        artifactsDir: node_path_1.default.join(root, "artifacts"),
        instructions: [
            "Use the blackboard as shared coordination context.",
            "Read index.json and the relevant topic/context/artifact files before synthesizing.",
            "Cite blackboard artifact refs or message refs in result evidence when relevant.",
            "Do not edit blackboard files directly; CW records accepted worker output into the blackboard."
        ]
    };
}
function publishWorkerOutputToBlackboard(run, scope, task, summary, destination, workerResultPath, evidence, acceptedAuditId) {
    const linkage = blackboardLinkage(run, scope);
    if (!linkage.blackboardId || !linkage.topicIds.length)
        return { messageIds: [], artifactRefIds: [] };
    const topicId = linkage.topicIds[0];
    const artifactRefs = [
        (0, coordinator_1.addBlackboardArtifact)(run, {
            topicId,
            blackboardId: linkage.blackboardId,
            kind: "worker-result",
            path: destination,
            owner: { kind: "worker", id: scope.id },
            author: { kind: "runtime", id: "cw" },
            source: "cw-validated-worker-output",
            provenance: {
                workerId: scope.id,
                taskId: task.id,
                multiAgentRunId: scope.multiAgent?.runId,
                agentGroupId: scope.multiAgent?.groupId,
                agentRoleId: scope.multiAgent?.roleId,
                agentMembershipId: scope.multiAgent?.membershipId,
                auditEventIds: [acceptedAuditId]
            },
            evidenceRefs: evidence.map((entry) => entry.locator || entry.path || entry.summary || entry.id).filter(Boolean),
            auditEventIds: [acceptedAuditId],
            metadata: { workerResultPath }
        })
    ];
    const message = (0, coordinator_1.postBlackboardMessage)(run, {
        topicId,
        blackboardId: linkage.blackboardId,
        body: summary,
        author: { kind: "worker", id: scope.id },
        scope: { kind: "worker", id: scope.id },
        artifactRefIds: artifactRefs.map((artifact) => artifact.id),
        evidenceRefs: evidence.map((entry) => entry.locator || entry.path || entry.summary || entry.id).filter(Boolean),
        auditEventIds: [acceptedAuditId],
        links: {
            multiAgentRunId: scope.multiAgent?.runId,
            agentGroupId: scope.multiAgent?.groupId,
            agentRoleId: scope.multiAgent?.roleId,
            agentMembershipId: scope.multiAgent?.membershipId,
            agentFanoutId: scope.multiAgent?.fanoutId,
            taskId: task.id,
            workerId: scope.id,
            auditEventIds: [acceptedAuditId]
        },
        metadata: {
            taskId: task.id,
            resultPath: destination,
            multiAgent: scope.multiAgent
        }
    });
    return {
        messageIds: [message.id],
        artifactRefIds: artifactRefs.map((artifact) => artifact.id)
    };
}
function blackboardLinkage(run, scope) {
    const membershipId = scope.multiAgent?.membershipId;
    const membership = membershipId ? run.multiAgent?.memberships.find((entry) => entry.id === membershipId) : undefined;
    const group = scope.multiAgent?.groupId ? run.multiAgent?.groups.find((entry) => entry.id === scope.multiAgent?.groupId) : undefined;
    const role = scope.multiAgent?.roleId ? run.multiAgent?.roles.find((entry) => entry.id === scope.multiAgent?.roleId) : undefined;
    const multiAgentRun = scope.multiAgent?.runId ? run.multiAgent?.runs.find((entry) => entry.id === scope.multiAgent?.runId) : undefined;
    const blackboardId = membership?.blackboardId || group?.blackboardId || role?.blackboardId || multiAgentRun?.blackboardId;
    const topicIds = unique([
        ...(membership?.topicIds || []),
        ...(group?.topicIds || []),
        ...(role?.topicIds || []),
        ...(multiAgentRun?.topicIds || [])
    ]);
    return { blackboardId, topicIds };
}
function manifestPath(scope) {
    return node_path_1.default.join(scope.workerDir, "worker.json");
}
// Deterministic worker id (v0.1.40 self-audit P2): a wall-clock stamp + Math.random()
// made every dispatch mint a different id, so audit references were not reproducible
// across re-runs of the same inputs. The id is now derived from the task plus a
// per-task sequence (count of worker scopes already allocated for that task + 1),
// so re-running the same workflow yields byte-identical worker ids while retries of
// the SAME task still get a fresh, unique id. (workerId is excluded from the
// snapshot source fingerprint, so this does not change replay digests.)
function createWorkerId(run, taskId) {
    const prefix = `worker-${(0, state_1.safeFileName)(taskId)}-`;
    const seq = (run.workers || []).filter((scope) => scope.id.startsWith(prefix)).length + 1;
    return `${prefix}${String(seq).padStart(4, "0")}`;
}
function workerArtifacts(scope) {
    return [
        { id: "worker", kind: "json", path: manifestPath(scope) },
        { id: "worker-input", kind: "markdown", path: scope.inputPath }
    ];
}
function normalizeWorkerError(error, scope, options) {
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
function structuredError(code, message, options = {}) {
    return {
        code,
        message,
        at: new Date().toISOString(),
        path: options.path,
        retryable: options.retryable,
        details: options.details
    };
}
function isBoundaryViolation(value) {
    return Boolean(value && typeof value === "object" && "allowedPaths" in value && "message" in value);
}
function isStateNodeError(value) {
    return Boolean(value && typeof value === "object" && "code" in value && "message" in value);
}
function mergeScopes(left, right) {
    const merged = [...left];
    for (const scope of right) {
        const index = merged.findIndex((candidate) => candidate.id === scope.id);
        if (index >= 0)
            merged[index] = scope;
        else
            merged.push(scope);
    }
    return merged;
}
function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
}
function compactMetadata(value) {
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
}
function countBy(items, key) {
    const counts = {};
    for (const item of items) {
        const value = key(item);
        counts[value] = (counts[value] || 0) + 1;
    }
    return counts;
}
