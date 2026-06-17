"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORKER_ISOLATION_SCHEMA_VERSION = void 0;
exports.allocateWorkerScope = allocateWorkerScope;
exports.writeWorkerManifest = writeWorkerManifest;
exports.syncWorkerScopeFromTask = syncWorkerScopeFromTask;
exports.listWorkerScopes = listWorkerScopes;
exports.getWorkerScope = getWorkerScope;
exports.recordWorkerOutput = recordWorkerOutput;
exports.recordWorkerFailure = recordWorkerFailure;
exports.recordWorkerRetryAttempt = recordWorkerRetryAttempt;
exports.validateWorkerBoundary = validateWorkerBoundary;
exports.summarizeWorkers = summarizeWorkers;
exports.reclaimOrphans = reclaimOrphans;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("./state");
const pipeline_contract_1 = require("./pipeline-contract");
const error_feedback_1 = require("./error-feedback");
const state_node_1 = require("./state-node");
const sandbox_profile_1 = require("./sandbox-profile");
const execution_backend_1 = require("./execution-backend");
const trust_audit_1 = require("./trust-audit");
const helpers_1 = require("./worker-isolation/helpers");
const paths_1 = require("./worker-isolation/paths");
const validation_1 = require("./validation");
const acceptance_1 = require("./worker-accept/acceptance");
const blackboard_linkage_1 = require("./worker-accept/blackboard-linkage");
const blackboard_fanout_1 = require("./worker-accept/blackboard-fanout");
const telemetry_ledger_1 = require("./worker-accept/telemetry-ledger");
const validation_2 = require("./worker-accept/validation");
const verifier_completion_1 = require("./worker-accept/verifier-completion");
exports.WORKER_ISOLATION_SCHEMA_VERSION = 1;
function allocateWorkerScope(run, task, options = {}) {
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
    const workerId = options.workerId || (0, paths_1.createWorkerId)(run, task.id);
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
        allowLogs: options.policy?.allowLogs,
        // H7: persisted custom profile definitions so a custom logical id resolves
        // against THIS worker's context (worker-specific path tokens bind correctly).
        customProfiles: run.customSandboxProfiles
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
        metadata: (0, helpers_1.compactMetadata)({
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
    task.workerManifestPath = (0, paths_1.manifestPath)(scope);
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
    const scopePath = (0, paths_1.workerScopePath)(scope);
    const workerManifestPath = (0, paths_1.manifestPath)(scope);
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
    (0, state_1.writeJson)(workerManifestPath, manifest);
    return manifest;
}
function syncWorkerScopeFromTask(run, workerId) {
    const scope = getWorkerScope(run, workerId);
    if (!scope)
        return undefined;
    const task = run.tasks.find((candidate) => candidate.id === scope.taskId);
    if (!task?.multiAgent)
        return scope;
    const updated = {
        ...scope,
        updatedAt: new Date().toISOString(),
        multiAgent: task.multiAgent,
        metadata: (0, helpers_1.compactMetadata)({
            ...(scope.metadata || {}),
            multiAgent: task.multiAgent
        })
    };
    return updateWorkerScope(run, updated);
}
function listWorkerScopes(run, options = {}) {
    ensureWorkerState(run);
    const scopes = loadWorkerScopesFromDisk(run);
    run.workers = (0, helpers_1.mergeScopes)(run.workers || [], scopes);
    const listed = run.workers || [];
    return options.status ? listed.filter((scope) => scope.status === options.status) : listed;
}
function getWorkerScope(run, workerId) {
    ensureWorkerState(run);
    const existing = (run.workers || []).find((scope) => scope.id === workerId);
    if (existing)
        return existing;
    const file = node_path_1.default.join(workerRoot(run), (0, state_1.safeFileName)(workerId), paths_1.WORKER_SCOPE_FILE);
    if (!node_fs_1.default.existsSync(file))
        return undefined;
    let scope;
    try {
        scope = (0, validation_1.validateWorkerScope)(JSON.parse(node_fs_1.default.readFileSync(file, "utf8")));
    }
    catch (error) {
        // A present-but-corrupt scope fails closed with context, not a raw
        // SyntaxError/validation throw bubbling up from deep in the call stack.
        throw new Error(`Corrupt worker scope ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    upsertWorkerScope(run, scope);
    return scope;
}
function recordWorkerOutput(run, workerId, resultPath, options = {}) {
    // Accept-path orchestrator. The recorded order + side effects of these ordered
    // steps are load-bearing (replay determinism + the hash-chained audit/telemetry
    // ledgers cross-link by parent event ids), so each helper runs exactly where it
    // did before and mutates the shared `accept` context in place. Do NOT reorder.
    const accept = (0, validation_2.validateWorkerResult)(run, workerId, resultPath, options, {
        requireWorkerScope,
        requireWorkerTask,
        validateWorkerBoundary,
        recordWorkerFailure
    });
    const delegation = (0, telemetry_ledger_1.attestWorkerDelegation)(accept, { recordWorkerFailure });
    (0, acceptance_1.acceptWorkerResult)(accept, delegation);
    (0, telemetry_ledger_1.recordWorkerDelegationLedger)(accept, delegation);
    (0, verifier_completion_1.runWorkerVerify)(accept);
    (0, verifier_completion_1.recordWorkerCompletion)(accept, delegation, { updateWorkerScope });
    (0, blackboard_fanout_1.fanOutWorkerOutput)(accept);
    if (options.persist !== false)
        (0, state_1.saveCheckpoint)(run);
    return accept.output;
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
        artifacts: (0, paths_1.workerArtifacts)(scope),
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
        retryCount: typeof options.retryCount === "number" ? options.retryCount : scope.retryCount,
        feedbackIds: (0, helpers_1.unique)([...(scope.feedbackIds || []), feedback.id]),
        errors: [...(scope.errors || []), structured]
    });
    if (options.persist !== false)
        (0, state_1.saveCheckpoint)(run);
    return requireWorkerScope(run, workerId);
}
function recordWorkerRetryAttempt(run, workerId, attempts, reason, options = {}) {
    const scope = requireWorkerScope(run, workerId);
    const updated = updateWorkerScope(run, {
        ...scope,
        updatedAt: new Date().toISOString(),
        retryCount: attempts,
        metadata: (0, helpers_1.compactMetadata)({
            ...scope.metadata,
            agentDelegationAttempts: attempts,
            agentDelegationLastFailure: reason
        })
    });
    if (options.persist !== false)
        (0, state_1.saveCheckpoint)(run);
    return updated;
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
        byStatus: (0, helpers_1.countBy)(workers, (scope) => scope.status),
        manifestPaths: workers.map(paths_1.manifestPath),
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
    }
    return { runId: run.id, reclaimed: orphans.length, orphans };
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
    (0, state_1.writeJson)((0, paths_1.workerScopePath)(scope), scope);
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
            manifestPath: (0, paths_1.manifestPath)(scope),
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
        .map((entry) => node_path_1.default.join(workerRoot(run), entry.name, paths_1.WORKER_SCOPE_FILE))
        .filter((file) => node_fs_1.default.existsSync(file))
        .map((file) => {
        // One corrupt/partially-written worker.json must not blank the whole
        // listing (summarizeWorkers/listWorkerScopes) — skip it with a diagnostic
        // and surface every worker that IS readable.
        try {
            return (0, validation_1.validateWorkerScope)(JSON.parse(node_fs_1.default.readFileSync(file, "utf8")));
        }
        catch (error) {
            process.stderr.write(`cw: skipping unreadable worker scope ${file}: ${error instanceof Error ? error.message : String(error)}\n`);
            return undefined;
        }
    })
        .filter((scope) => scope !== undefined);
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
    // H7: when the scope.sandboxPolicy snapshot is LOST, this re-resolves the policy
    // by its logical profileId against the WORKER's paths (scope.workerDir etc.). For
    // a CUSTOM profile the bundled lookup would throw not-found; threading
    // run.customSandboxProfiles lets resolveSandboxProfileById re-resolve the persisted
    // DEFINITION here — re-enforcing the same policy with worker-correct path tokens
    // (NOT the dispatch-time paths), so a legitimate worker write is not falsely denied.
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
        allowLogs: options.policy?.allowLogs,
        customProfiles: run.customSandboxProfiles
    });
}
function blackboardManifest(run, scope) {
    const linkage = (0, blackboard_linkage_1.blackboardLinkage)(run, scope);
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
function normalizeWorkerError(error, scope, options) {
    if ((0, helpers_1.isBoundaryViolation)(error)) {
        return (0, helpers_1.structuredError)(error.code, error.message, {
            path: error.path,
            retryable: false,
            details: { allowedPaths: error.allowedPaths, workerId: scope.id, taskId: scope.taskId, sandboxProfileId: scope.sandboxProfileId }
        });
    }
    if ((0, helpers_1.isStateNodeError)(error)) {
        return {
            ...error,
            at: error.at || new Date().toISOString(),
            path: options.path || error.path,
            retryable: options.retryable ?? error.retryable ?? false,
            details: (0, helpers_1.compactMetadata)({ ...(error.details || {}), workerId: scope.id, taskId: scope.taskId })
        };
    }
    const message = error instanceof Error ? error.message : String(error);
    return (0, helpers_1.structuredError)(options.code || "worker-runtime-error", message, {
        path: options.path,
        retryable: options.retryable ?? false,
        details: { workerId: scope.id, taskId: scope.taskId }
    });
}
