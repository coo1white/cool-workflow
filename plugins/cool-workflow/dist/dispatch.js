"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.nextDispatchTasks = nextDispatchTasks;
exports.createDispatchManifest = createDispatchManifest;
exports.firstRunnablePhase = firstRunnablePhase;
exports.updatePhaseStatuses = updatePhaseStatuses;
exports.formatDispatchTask = formatDispatchTask;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("./state");
const pipeline_contract_1 = require("./pipeline-contract");
const state_node_1 = require("./state-node");
const worker_isolation_1 = require("./worker-isolation");
const sandbox_profile_1 = require("./sandbox-profile");
const execution_backend_1 = require("./execution-backend");
const multi_agent_1 = require("./multi-agent");
function nextDispatchTasks(run, limit) {
    const runnablePhase = firstRunnablePhase(run);
    if (!runnablePhase)
        return [];
    const max = Number(limit || run.workflow.limits.maxConcurrentAgents || 4);
    const runnableTaskIds = new Set(runnablePhase.taskIds);
    return run.tasks
        .filter((task) => task.status === "pending" && runnableTaskIds.has(task.id))
        .slice(0, max)
        .map(formatDispatchTask);
}
function createDispatchManifest(run, limit, options = {}) {
    const requestedSandboxProfileId = options.sandboxProfileId || options.sandbox;
    const sandboxProfileId = String(requestedSandboxProfileId || sandbox_profile_1.DEFAULT_SANDBOX_PROFILE_ID);
    (0, sandbox_profile_1.resolveSandboxProfileById)(sandboxProfileId, (0, sandbox_profile_1.sandboxContextForValidation)(run.cwd));
    // H7: if the requested profile is a CUSTOM profile loaded from a FILE (non-bundled,
    // existing file), persist its DEFINITION on run.customSandboxProfiles keyed by the
    // definition's logical id. This makes the custom profile durable with run state so a
    // worker boundary can re-resolve it by logical id after a scope snapshot is lost
    // (re-resolving against the worker context, not the dispatch-time file path).
    persistCustomSandboxProfile(run, sandboxProfileId);
    // Resolve the execution backend once (mechanism vs policy): the kernel records
    // WHICH backend was selected; it never branches on which one. Defaults to node
    // (behavior-preserving) when no `--backend` flag / CW_BACKEND env is set.
    const backendSelection = (0, execution_backend_1.resolveBackendSelection)(options.backendId);
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
    const manifestPath = node_path_1.default.join(run.paths.dispatchesDir, `${dispatchId}.json`);
    node_fs_1.default.mkdirSync(run.paths.dispatchesDir, { recursive: true });
    const taskIds = new Set(tasks.map((task) => task.id));
    const createdAt = new Date().toISOString();
    const selectedSandboxProfileIds = new Set();
    let sandboxPolicy;
    for (const task of run.tasks) {
        if (taskIds.has(task.id)) {
            const taskSandboxProfileId = String(requestedSandboxProfileId || task.sandboxProfileId || sandbox_profile_1.DEFAULT_SANDBOX_PROFILE_ID);
            selectedSandboxProfileIds.add(taskSandboxProfileId);
            task.status = "running";
            task.loopStage = "act";
            task.dispatchId = dispatchId;
            task.dispatchedAt = createdAt;
            const scope = (0, worker_isolation_1.allocateWorkerScope)(run, task, {
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
    const multiAgentAttachment = (0, multi_agent_1.attachDispatchToMultiAgent)(run, {
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
        const worker = task.workerId ? (0, worker_isolation_1.syncWorkerScopeFromTask)(run, task.workerId) : undefined;
        if (worker)
            (0, worker_isolation_1.writeWorkerManifest)(run, worker);
    }
    const manifest = {
        schemaVersion: 1,
        runId: run.id,
        dispatchId,
        createdAt,
        phase: tasks[0].phase,
        instructions: "Spawn one worker per task when the user explicitly authorized agent/parallel/background work. Save each final summary as Markdown and record it with `cw.js result <run-id> <task-id> <file>`.",
        tasks: selectedRunTasks.map(formatDispatchTask),
        manifestPath,
        workerIndexPath: run.paths.workersDir ? node_path_1.default.join(run.paths.workersDir, "index.json") : undefined,
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
    const dispatchNode = (0, state_node_1.appendRunNode)(run, (0, state_node_1.createStateNode)({
        id: `${run.id}:dispatch:${dispatchId}`,
        kind: "dispatch",
        status: "running",
        loopStage: "act",
        inputs: { taskIds: tasks.map((task) => task.id), phase: manifest.phase, sandboxProfileId: manifest.sandboxProfileId },
        outputs: { dispatchId, sandboxProfileId: manifest.sandboxProfileId },
        artifacts: [{ id: "dispatch", kind: "json", path: manifestPath }],
        parents: tasks.map((task) => `${run.id}:task:${task.id}`),
        contractId: pipeline_contract_1.DEFAULT_PIPELINE_CONTRACT_ID,
        metadata: { sandboxProfileId: manifest.sandboxProfileId, sandboxPolicy: manifest.sandboxPolicy }
    }));
    manifest.stateNodeId = dispatchNode.id;
    for (const task of run.tasks) {
        if (!taskIds.has(task.id) || !task.stateNodeId)
            continue;
        const node = run.nodes?.find((candidate) => candidate.id === task.stateNodeId);
        if (node && node.status === "pending") {
            (0, state_node_1.appendRunNode)(run, (0, state_node_1.transitionStateNode)(node, { status: "running", loopStage: "act" }));
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
    (0, state_1.writeJson)(manifestPath, manifest);
    return manifest;
}
function firstRunnablePhase(run) {
    for (const phase of run.phases) {
        const phaseTasks = run.tasks.filter((task) => phase.taskIds.includes(task.id));
        if (phaseTasks.some((task) => task.status === "running"))
            return phase;
        if (phaseTasks.some((task) => task.status === "pending"))
            return phase;
        if (!phaseTasks.every((task) => task.status === "completed"))
            return null;
    }
    return null;
}
function updatePhaseStatuses(run) {
    for (const phase of run.phases) {
        const phaseTasks = run.tasks.filter((task) => phase.taskIds.includes(task.id));
        if (phaseTasks.every((task) => task.status === "completed")) {
            phase.status = "completed";
        }
        else if (phaseTasks.some((task) => task.status === "running" || task.status === "completed")) {
            phase.status = "running";
        }
        else {
            phase.status = "pending";
        }
    }
}
function formatDispatchTask(task) {
    return {
        id: task.id,
        kind: task.kind,
        phase: task.phase,
        status: task.status,
        taskPath: task.taskPath,
        prompt: task.prompt,
        workerId: task.workerId,
        workerManifestPath: task.workerManifestPath,
        workerDir: task.workerManifestPath ? node_path_1.default.dirname(task.workerManifestPath) : undefined,
        workerResultPath: task.workerId && task.workerManifestPath ? node_path_1.default.join(node_path_1.default.dirname(task.workerManifestPath), "result.md") : undefined,
        sandboxProfileId: task.sandboxProfileId,
        sandboxPolicy: task.sandboxPolicy,
        backendId: task.backendId,
        backendAttestation: task.backendAttestation,
        multiAgent: task.multiAgent
    };
}
// Deterministic dispatch id (replay-determinism self-audit): the wall-clock stamp
// is an edge timestamp (stripped on replay), but the former Math.random() suffix
// made every dispatch mint a non-reproducible id. The suffix is now a per-run
// sequence — the count of dispatches already allocated on this run — so re-running
// the same workflow yields byte-identical dispatch ids while each dispatch within a
// run still gets a distinct, monotonically increasing id. Mirrors the de-clock done
// for worker ids in src/worker-isolation/paths.ts.
function createDispatchId(run) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
    const seq = (run.dispatches?.length || 0) + 1;
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
function persistCustomSandboxProfile(run, requested) {
    if (!requested || (0, sandbox_profile_1.isBundledSandboxProfileId)(requested))
        return;
    const absolute = node_path_1.default.resolve(requested);
    if (!node_fs_1.default.existsSync(absolute) || !node_fs_1.default.statSync(absolute).isFile())
        return;
    const validation = (0, sandbox_profile_1.validateSandboxProfileFile)(requested, (0, sandbox_profile_1.sandboxContextForValidation)(run.cwd));
    if (!validation.valid || !validation.profile)
        return;
    let definition;
    try {
        definition = JSON.parse(node_fs_1.default.readFileSync(absolute, "utf8"));
    }
    catch {
        return;
    }
    if (!definition || typeof definition !== "object" || typeof definition.id !== "string" || !definition.id)
        return;
    run.customSandboxProfiles = run.customSandboxProfiles || {};
    run.customSandboxProfiles[definition.id] = definition;
}
